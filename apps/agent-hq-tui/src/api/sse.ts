import type { HQState, StreamUpdatePayload } from '@agent-hq/queue/types';
import type { SSEMessage } from './types';

export async function* parseSseStream(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<SSEMessage> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = 'message';
  let currentData = '';

  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          currentData += (currentData ? '\n' : '') + line.slice(5).trim();
        } else if (line.startsWith(':')) {
          // SSE comment or heartbeat, ignore
        } else if (line.trim() === '') {
          if (currentData) {
            yield { event: currentEvent, data: currentData };
            currentEvent = 'message';
            currentData = '';
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export interface SseSubscriptionOptions {
  baseUrl: string;
  fetchFn?: typeof fetch;
  onConnected?: (connected: boolean) => void;
  onInitState?: (state: HQState) => void;
  onUpdate?: (payload: StreamUpdatePayload) => void;
  onLogChunk?: (runId: string, chunk: string) => void;
  onError?: (err: unknown, nextRetryMs: number) => void;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  backoffMultiplier?: number;
}

export function startSseSubscription(
  options: SseSubscriptionOptions,
): () => void {
  const {
    baseUrl,
    fetchFn = fetch,
    onConnected,
    onInitState,
    onUpdate,
    onLogChunk,
    onError,
    initialBackoffMs = 1000,
    maxBackoffMs = 15000,
    backoffMultiplier = 1.5,
  } = options;

  let stopped = false;
  let abortController: AbortController | null = null;
  let currentTimer: ReturnType<typeof setTimeout> | null = null;
  let currentDelay = initialBackoffMs;

  const loop = async () => {
    while (!stopped) {
      abortController = new AbortController();
      const signal = abortController.signal;

      try {
        const streamUrl = `${baseUrl.replace(/\/+$/, '')}/api/stream`;
        const res = await fetchFn(streamUrl, {
          signal,
          headers: { Accept: 'text/event-stream' },
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        currentDelay = initialBackoffMs;
        onConnected?.(true);

        for await (const msg of parseSseStream(res, signal)) {
          if (stopped) break;
          if (msg.event === 'INIT_STATE') {
            try {
              const state = JSON.parse(msg.data) as HQState;
              onInitState?.(state);
            } catch {
              // Ignore corrupted state json
            }
          } else if (msg.event === 'UPDATE') {
            try {
              const payload = JSON.parse(msg.data) as StreamUpdatePayload;
              onUpdate?.(payload);
              const event = payload.event;
              if (
                event &&
                'event' in event &&
                event.event === 'TASK_PROGRESS' &&
                event.runId &&
                typeof event.data?.logChunk === 'string'
              ) {
                onLogChunk?.(event.runId, event.data.logChunk);
              }
            } catch {
              // Ignore corrupted update json
            }
          }
        }
      } catch (err) {
        if (stopped) break;
        onConnected?.(false);
        const retryWait = currentDelay;
        currentDelay = Math.min(
          Math.round(currentDelay * backoffMultiplier),
          maxBackoffMs,
        );
        onError?.(err, retryWait);
        await new Promise<void>((resolve) => {
          currentTimer = setTimeout(resolve, retryWait);
        });
        currentTimer = null;
        continue;
      }

      // Stream closed gracefully (e.g. server restart)
      if (!stopped) {
        onConnected?.(false);
        const retryWait = currentDelay;
        currentDelay = Math.min(
          Math.round(currentDelay * backoffMultiplier),
          maxBackoffMs,
        );
        onError?.(new Error('Verbindung unterbrochen'), retryWait);
        await new Promise<void>((resolve) => {
          currentTimer = setTimeout(resolve, retryWait);
        });
        currentTimer = null;
      }
    }
  };

  void loop();

  return () => {
    stopped = true;
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    if (currentTimer) {
      clearTimeout(currentTimer);
      currentTimer = null;
    }
    onConnected?.(false);
  };
}

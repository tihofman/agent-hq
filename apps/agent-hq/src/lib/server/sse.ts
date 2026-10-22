import { getState, subscribe } from './store';

export function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function formatComment(comment: string): string {
  return `: ${comment}\n\n`;
}

export interface EventStreamOptions {
  heartbeatMs?: number;
}

export function createEventStream(
  request?: Request,
  options: EventStreamOptions = {},
): Response {
  const { heartbeatMs = 30000 } = options;
  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const subscription = {
        isClosed: false,
        unsubscribe: undefined as (() => void) | undefined,
        heartbeatTimer: undefined as ReturnType<typeof setInterval> | undefined,
      };

      const teardown = () => {
        if (subscription.isClosed) return;
        subscription.isClosed = true;
        if (subscription.heartbeatTimer !== undefined) {
          clearInterval(subscription.heartbeatTimer);
        }
        subscription.unsubscribe?.();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const send = (text: string) => {
        if (subscription.isClosed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          teardown();
        }
      };

      cleanup = teardown;

      // 1. Initial event is INIT_STATE with full current state
      send(formatSSE('INIT_STATE', getState()));
      if (subscription.isClosed) return;

      // 2. Subscribe to store for live state changes
      subscription.unsubscribe = subscribe((state, event) => {
        send(formatSSE('UPDATE', { event, state }));
      });

      // 3. Heartbeat comment every 30s (or heartbeatMs)
      subscription.heartbeatTimer = setInterval(() => {
        send(formatComment('heartbeat'));
      }, heartbeatMs);
    },
    cancel() {
      cleanup?.();
    },
  });

  request?.signal?.addEventListener('abort', () => {
    cleanup?.();
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

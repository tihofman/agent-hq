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
      let isClosed = false;

      const send = (text: string) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          teardown();
        }
      };

      // 1. Initial event is INIT_STATE with full current state
      send(formatSSE('INIT_STATE', getState()));

      // 2. Subscribe to store for live state changes
      const unsubscribe = subscribe((_state, event) => {
        const eventType = 'event' in event ? event.event : event.type;
        send(formatSSE(eventType, event));
      });

      // 3. Heartbeat comment every 30s (or heartbeatMs)
      const heartbeatTimer = setInterval(() => {
        send(formatComment('heartbeat'));
      }, heartbeatMs);

      const teardown = () => {
        if (isClosed) return;
        isClosed = true;
        clearInterval(heartbeatTimer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      cleanup = teardown;
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

import { describe, expect, it, vi } from 'vitest';
import { parseSseStream, startSseSubscription } from './api/sse';

function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe('SSE stream parser and subscription', () => {
  it('parses multi-line events, data and comments', async () => {
    const rawSse = [
      ': heartbeat comment\n\n',
      'event: INIT_STATE\n',
      'data: {"agents":{}}\n\n',
      'event: UPDATE\n',
      'data: {"event":{"event":"TASK_START"}}\n\n',
    ];

    const mockResponse = new Response(createMockStream(rawSse));
    const messages: Array<{ event: string; data: string }> = [];

    for await (const msg of parseSseStream(mockResponse)) {
      messages.push(msg);
    }

    expect(messages).toEqual([
      { event: 'INIT_STATE', data: '{"agents":{}}' },
      { event: 'UPDATE', data: '{"event":{"event":"TASK_START"}}' },
    ]);
  });

  it('handles server disconnect and attempts reconnect with backoff', async () => {
    vi.useFakeTimers();

    let attempts = 0;
    const errors: Array<{ err: unknown; nextRetryMs: number }> = [];
    const connectedStates: boolean[] = [];

    const mockFetch = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        // First connection: stream ends immediately (server closed/restart)
        return new Response(createMockStream([': heartbeat\n\n']));
      } else if (attempts === 2) {
        // Second connection fails completely
        throw new Error('Connection refused');
      } else {
        // Third connection succeeds with INIT_STATE
        return new Response(
          createMockStream([
            'event: INIT_STATE\ndata: {"agents":{"claude":{"status":"idle"}}}\n\n',
          ]),
        );
      }
    });

    const initStates: unknown[] = [];

    const stop = startSseSubscription({
      baseUrl: 'http://127.0.0.1:3333',
      fetchFn: mockFetch as unknown as typeof fetch,
      initialBackoffMs: 100,
      maxBackoffMs: 500,
      backoffMultiplier: 2,
      onConnected: (c) => connectedStates.push(c),
      onInitState: (s) => initStates.push(s),
      onError: (err, nextRetryMs) => errors.push({ err, nextRetryMs }),
    });

    // Let the first attempt finish (stream closed)
    await vi.runOnlyPendingTimersAsync();
    expect(attempts).toBeGreaterThanOrEqual(1);

    // Advance timers for the retry
    await vi.advanceTimersByTimeAsync(150);
    expect(attempts).toBeGreaterThanOrEqual(2);

    // Advance timers for the 3rd retry
    await vi.advanceTimersByTimeAsync(250);
    expect(attempts).toBeGreaterThanOrEqual(3);

    expect(initStates.length).toBeGreaterThanOrEqual(1);
    expect(initStates[0]).toEqual({
      agents: { claude: { status: 'idle' } },
    });

    stop();
    vi.useRealTimers();
  });
});

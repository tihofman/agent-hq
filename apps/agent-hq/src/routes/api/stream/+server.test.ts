import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { GET } from './+server';
import { POST } from '../events/+server';
import { getState, resetStore } from '../../../lib/server/store';
import * as storeModule from '../../../lib/server/store';

async function readSSEMessage(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes('\n\n')) {
      break;
    }
  }
  return buffer;
}

describe('GET /api/stream', () => {
  beforeEach(() => {
    resetStore();
    vi.restoreAllMocks();
  });

  it('returns text/event-stream content type and streaming headers', async () => {
    const response = await GET(new Request('http://localhost:3333/api/stream'));
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-cache');
    expect(response.headers.get('connection')).toBe('keep-alive');

    const reader = response.body!.getReader();
    await reader.cancel();
  });

  it('sends INIT_STATE as first event with complete current state', async () => {
    const response = await GET(new Request('http://localhost:3333/api/stream'));
    const reader = response.body!.getReader();

    const firstMsg = await readSSEMessage(reader);
    expect(firstMsg).toContain('event: INIT_STATE');
    expect(firstMsg).toContain(JSON.stringify(getState()));

    await reader.cancel();
  });

  it('sends latest state on reconnect/reload (F5 resilience)', async () => {
    // Dispatch an event first
    await POST(
      new Request('http://localhost:3333/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'TASK_START',
          agent: 'codex',
          runId: 'run-reconnect',
        }),
      }),
    );

    // New connection connects after event
    const response = await GET(new Request('http://localhost:3333/api/stream'));
    const reader = response.body!.getReader();

    const firstMsg = await readSSEMessage(reader);
    expect(firstMsg).toContain('event: INIT_STATE');
    expect(firstMsg).toContain('"status":"coding"');
    expect(firstMsg).toContain('"run-reconnect"');

    await reader.cancel();
  });

  it('supports RequestEvent wrapper argument ({ request })', async () => {
    const request = new Request('http://localhost:3333/api/stream');
    const event = { request } as unknown as RequestEvent;

    const response = await GET(event);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    const firstMsg = await readSSEMessage(reader);
    expect(firstMsg).toContain('event: INIT_STATE');

    await reader.cancel();
  });

  it('distributes events to two connected clients', async () => {
    // 1. Connect Client 1
    const res1 = await GET(new Request('http://localhost:3333/api/stream'));
    const reader1 = res1.body!.getReader();
    const init1 = await readSSEMessage(reader1);
    expect(init1).toContain('event: INIT_STATE');

    // 2. Connect Client 2
    const res2 = await GET(new Request('http://localhost:3333/api/stream'));
    const reader2 = res2.body!.getReader();
    const init2 = await readSSEMessage(reader2);
    expect(init2).toContain('event: INIT_STATE');

    // 3. Post an event
    const postRes = await POST(
      new Request('http://localhost:3333/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'TASK_START',
          agent: 'agy',
          runId: 'run-dual',
        }),
      }),
    );
    expect(postRes.status).toBe(202);

    // 4. Verify both clients receive the event
    const msg1 = await readSSEMessage(reader1);
    const msg2 = await readSSEMessage(reader2);

    expect(msg1).toContain('event: TASK_START');
    expect(msg1).toContain('"runId":"run-dual"');

    expect(msg2).toContain('event: TASK_START');
    expect(msg2).toContain('"runId":"run-dual"');

    await reader1.cancel();
    await reader2.cancel();
  });

  it('cleans up subscription when connection is cancelled (no memory leak)', async () => {
    const unsubSpy = vi.fn();
    const realSubscribe = storeModule.subscribe;
    vi.spyOn(storeModule, 'subscribe').mockImplementation((fn) => {
      const realUnsub = realSubscribe(fn);
      return () => {
        unsubSpy();
        realUnsub();
      };
    });

    const response = await GET(new Request('http://localhost:3333/api/stream'));
    const reader = response.body!.getReader();
    await readSSEMessage(reader);

    expect(unsubSpy).not.toHaveBeenCalled();

    // Client disconnects
    await reader.cancel();

    expect(unsubSpy).toHaveBeenCalledTimes(1);
  });

  it('cleans up subscription when request abort signal fires', async () => {
    const unsubSpy = vi.fn();
    const realSubscribe = storeModule.subscribe;
    vi.spyOn(storeModule, 'subscribe').mockImplementation((fn) => {
      const realUnsub = realSubscribe(fn);
      return () => {
        unsubSpy();
        realUnsub();
      };
    });

    const abortController = new AbortController();
    const request = new Request('http://localhost:3333/api/stream', {
      signal: abortController.signal,
    });
    const response = await GET(request);
    const reader = response.body!.getReader();
    await readSSEMessage(reader);

    expect(unsubSpy).not.toHaveBeenCalled();

    abortController.abort();

    expect(unsubSpy).toHaveBeenCalledTimes(1);
    await reader.cancel();
  });

  it('sends heartbeat comment at least every 30 s', async () => {
    vi.useFakeTimers();

    const response = await GET(new Request('http://localhost:3333/api/stream'));
    const reader = response.body!.getReader();

    // Consume INIT_STATE
    const initMsg = await readSSEMessage(reader);
    expect(initMsg).toContain('event: INIT_STATE');

    // Advance 30 seconds
    vi.advanceTimersByTime(30000);

    const heartbeatMsg = await readSSEMessage(reader);
    expect(heartbeatMsg).toBe(': heartbeat\n\n');

    await reader.cancel();
    vi.useRealTimers();
  });
});

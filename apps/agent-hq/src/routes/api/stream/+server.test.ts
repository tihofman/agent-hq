import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { GET } from './+server';
import { POST } from '../events/+server';
import { getState, resetStore } from '../../../lib/server/store';
import * as storeModule from '../../../lib/server/store';

function createEvent(request: Request): RequestEvent {
  return {
    request,
    url: new URL(request.url),
  } as unknown as RequestEvent;
}

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
  let tempDir: string;
  const originalEnv = process.env.AGENT_HQ_HOME;

  beforeEach(async () => {
    resetStore();
    vi.restoreAllMocks();
    tempDir = await mkdtemp(join(tmpdir(), 'hq-stream-test-'));
    process.env.AGENT_HQ_HOME = tempDir;
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (originalEnv !== undefined) {
      process.env.AGENT_HQ_HOME = originalEnv;
    } else {
      delete process.env.AGENT_HQ_HOME;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns text/event-stream content type and streaming headers', async () => {
    const response = await GET(
      createEvent(new Request('http://localhost:3333/api/stream')),
    );
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-cache');
    expect(response.headers.get('connection')).toBe('keep-alive');

    const reader = response.body!.getReader();
    await reader.cancel();
  });

  it('sends INIT_STATE as first event with complete current state', async () => {
    const response = await GET(
      createEvent(new Request('http://localhost:3333/api/stream')),
    );
    const reader = response.body!.getReader();

    const firstMsg = await readSSEMessage(reader);
    expect(firstMsg).toContain('event: INIT_STATE');
    expect(firstMsg).toContain(JSON.stringify(getState()));

    await reader.cancel();
  });

  it('sends latest state on reconnect/reload (F5 resilience)', async () => {
    // Dispatch an event first
    await POST(
      createEvent(
        new Request('http://localhost:3333/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'TASK_START',
            agent: 'codex',
            runId: 'run-reconnect',
          }),
        }),
      ),
    );

    // New connection connects after event
    const response = await GET(
      createEvent(new Request('http://localhost:3333/api/stream')),
    );
    const reader = response.body!.getReader();

    const firstMsg = await readSSEMessage(reader);
    expect(firstMsg).toContain('event: INIT_STATE');
    expect(firstMsg).toContain('"status":"coding"');
    expect(firstMsg).toContain('"run-reconnect"');

    await reader.cancel();
  });

  it('supports RequestEvent wrapper argument ({ request, url })', async () => {
    const request = new Request('http://localhost:3333/api/stream');
    const event = {
      request,
      url: new URL(request.url),
    } as unknown as RequestEvent;

    const response = await GET(event);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    const firstMsg = await readSSEMessage(reader);
    expect(firstMsg).toContain('event: INIT_STATE');

    await reader.cancel();
  });

  it('distributes events to two connected clients', async () => {
    // 1. Connect Client 1
    const res1 = await GET(
      createEvent(new Request('http://localhost:3333/api/stream')),
    );
    const reader1 = res1.body!.getReader();
    const init1 = await readSSEMessage(reader1);
    expect(init1).toContain('event: INIT_STATE');

    // 2. Connect Client 2
    const res2 = await GET(
      createEvent(new Request('http://localhost:3333/api/stream')),
    );
    const reader2 = res2.body!.getReader();
    const init2 = await readSSEMessage(reader2);
    expect(init2).toContain('event: INIT_STATE');

    // 3. Post an event
    const postRes = await POST(
      createEvent(
        new Request('http://localhost:3333/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'TASK_START',
            agent: 'agy',
            runId: 'run-dual',
          }),
        }),
      ),
    );
    expect(postRes.status).toBe(202);

    // 4. Verify both clients receive the event
    const msg1 = await readSSEMessage(reader1);
    const msg2 = await readSSEMessage(reader2);

    expect(msg1).toContain('event: UPDATE');
    expect(msg1).toContain('"runId":"run-dual"');

    expect(msg2).toContain('event: UPDATE');
    expect(msg2).toContain('"runId":"run-dual"');

    await reader1.cancel();
    await reader2.cancel();
  });

  it('sends { event, state } payload for updates after INIT_STATE', async () => {
    const request = new Request('http://localhost:3333/api/stream');
    const response = await GET(createEvent(request));
    const reader = response.body!.getReader();

    // 1. First event is INIT_STATE
    const initMsg = await readSSEMessage(reader);
    expect(initMsg).toContain('event: INIT_STATE');

    // 2. Dispatch an event via POST
    const postRes = await POST(
      createEvent(
        new Request('http://localhost:3333/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'TASK_START',
            agent: 'codex',
            runId: 'run-update-test',
          }),
        }),
      ),
    );
    expect(postRes.status).toBe(202);

    // 3. Receive update
    const updateMsg = await readSSEMessage(reader);
    expect(updateMsg).toContain('event: UPDATE');

    const dataLine = updateMsg
      .split('\n')
      .find((line) => line.startsWith('data: '));
    expect(dataLine).toBeDefined();

    const payload = JSON.parse(dataLine!.slice(6));
    expect(payload).toHaveProperty('event');
    expect(payload).toHaveProperty('state');
    expect(payload.event).toMatchObject({
      event: 'TASK_START',
      agent: 'codex',
      runId: 'run-update-test',
    });
    expect(payload.state.agents.codex.status).toBe('coding');
    expect(payload.state.runs['run-update-test']).toBeDefined();
    expect(payload.state.runs['run-update-test'].agent).toBe('codex');

    await reader.cancel();
  });

  it('handles enqueue failure during initial send without TDZ reference error', () => {
    const origEncode = TextEncoder.prototype.encode;
    let callCount = 0;
    vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(function (
      this: TextEncoder,
      input?: string,
    ) {
      callCount++;
      if (callCount === 1) {
        throw new Error('Immediate enqueue error');
      }
      return origEncode.call(this, input);
    });

    expect(() => {
      const res = GET(
        createEvent(new Request('http://localhost:3333/api/stream')),
      );
      expect(res).toBeDefined();
    }).not.toThrow();
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

    const response = await GET(
      createEvent(new Request('http://localhost:3333/api/stream')),
    );
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
    const response = await GET(createEvent(request));
    const reader = response.body!.getReader();
    await readSSEMessage(reader);

    expect(unsubSpy).not.toHaveBeenCalled();

    abortController.abort();

    expect(unsubSpy).toHaveBeenCalledTimes(1);
    await reader.cancel();
  });

  it('sends heartbeat comment at least every 30 s', async () => {
    vi.useFakeTimers();

    const response = await GET(
      createEvent(new Request('http://localhost:3333/api/stream')),
    );
    const reader = response.body!.getReader();

    // Consume INIT_STATE
    const initMsg = await readSSEMessage(reader);
    expect(initMsg).toContain('event: INIT_STATE');

    // Advance 30 seconds
    vi.advanceTimersByTime(30000);

    const heartbeatMsg = await readSSEMessage(reader);
    expect(heartbeatMsg).toBe(': heartbeat\n\n');

    await reader.cancel();
  });

  it('broadcasts QUESTION_PENDING immediately and includes open questions in INIT_STATE on reload (#101)', async () => {
    // 1. Connect first client
    const res = await GET(
      createEvent(new Request('http://localhost:3333/api/stream')),
    );
    const reader = res.body!.getReader();
    const init1 = await readSSEMessage(reader);
    expect(init1).toContain('event: INIT_STATE');

    // 2. Dispatch QUESTION_PENDING without agent
    const questionEvent = {
      event: 'QUESTION_PENDING',
      data: {
        questionId: '101-1',
        issueId: 101,
        team: 'frontend',
        question: 'Deploy now?',
      },
    };
    await POST(
      createEvent(
        new Request('http://localhost:3333/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(questionEvent),
        }),
      ),
    );

    // 3. Client 1 receives live UPDATE with QUESTION_PENDING
    const updateMsg = await readSSEMessage(reader);
    expect(updateMsg).toContain('event: UPDATE');
    expect(updateMsg).toContain('"questionId":"101-1"');
    expect(updateMsg).toContain('"question":"Deploy now?"');
    await reader.cancel();

    // 4. Reconnect / reload client: INIT_STATE has the open question
    const reloadRes = await GET(
      createEvent(new Request('http://localhost:3333/api/stream')),
    );
    const reloadReader = reloadRes.body!.getReader();
    const reloadInit = await readSSEMessage(reloadReader);
    expect(reloadInit).toContain('event: INIT_STATE');
    expect(reloadInit).toContain('"101-1"');
    expect(reloadInit).toContain('"Deploy now?"');
    await reloadReader.cancel();
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { POST } from './+server';
import { getState, resetStore } from '../../../lib/server/store';

function createEvent(request: Request): RequestEvent {
  return {
    request,
    url: new URL(request.url),
  } as unknown as RequestEvent;
}

describe('POST /api/events', () => {
  beforeEach(() => {
    resetStore();
  });

  it('accepts valid event and responds with 202', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
        runId: 'run-1',
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(202);
    expect(getState().agents.codex.status).toBe('coding');
  });

  it('accepts RequestEvent with { request, url }', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-2',
      }),
    });

    const event = {
      request,
      url: new URL(request.url),
    } as unknown as RequestEvent;
    const response = await POST(event);
    expect(response.status).toBe(202);
    expect(getState().agents.agy.status).toBe('coding');
  });

  it('rejects broken JSON with 400 and error message', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not json {',
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string };
    expect(body.error).toBeDefined();
    expect(typeof body.error).toBe('string');
  });

  it('rejects invalid event schema with 400 and error message', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'INVALID_EVENT_TYPE',
        agent: 'codex',
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('event must be a supported event type');
  });

  it('allows curl requests without Origin header', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'TASK_HANDOVER',
        agent: 'codex',
      }),
    });

    expect(request.headers.get('origin')).toBeNull();
    const response = await POST(createEvent(request));
    expect(response.status).toBe(202);
  });

  it('allows requests with origin http://127.0.0.1:3333', async () => {
    const request = new Request('http://127.0.0.1:3333/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:3333',
      },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(202);
  });

  it('allows requests with origin http://localhost:3333', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3333',
      },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(202);
  });

  it('allows requests with dev port from url.port (e.g. 5173)', async () => {
    const devRequestLocalhost = new Request(
      'http://localhost:5173/api/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({
          event: 'TASK_START',
          agent: 'codex',
        }),
      },
    );

    const res1 = await POST(createEvent(devRequestLocalhost));
    expect(res1.status).toBe(202);

    const devRequestIp = new Request('http://127.0.0.1:5173/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:5173',
      },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
      }),
    });

    const res2 = await POST(createEvent(devRequestIp));
    expect(res2.status).toBe(202);
  });

  it('rejects requests with foreign host even if port matches url.port', async () => {
    const request = new Request('http://localhost:5173/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://evil-site.com:5173',
      },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Forbidden');
  });

  it('rejects requests where Origin port does not match url.port', async () => {
    const request = new Request('http://localhost:5173/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3333',
      },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Forbidden');
  });

  it('rejects requests with malformed Origin header', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'not-a-valid-url',
      },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(403);
  });

  it('responds in under 50 ms locally', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
      }),
    });

    const start = performance.now();
    const response = await POST(createEvent(request));
    const duration = performance.now() - start;

    expect(response.status).toBe(202);
    expect(duration).toBeLessThan(50);
  });
});

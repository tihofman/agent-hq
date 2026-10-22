import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { POST } from './+server';
import { getState, resetStore } from '../../../lib/server/store';

describe('POST /api/events', () => {
  const originalPort = process.env.PORT;

  beforeEach(() => {
    resetStore();
    delete process.env.PORT;
  });

  afterEach(() => {
    if (originalPort !== undefined) {
      process.env.PORT = originalPort;
    } else {
      delete process.env.PORT;
    }
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

    const response = await POST(request);
    expect(response.status).toBe(202);
    expect(getState().agents.codex.status).toBe('coding');
  });

  it('supports RequestEvent wrapper argument ({ request })', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-2',
      }),
    });

    const event = { request } as unknown as RequestEvent;
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

    const response = await POST(request);
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

    const response = await POST(request);
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
    const response = await POST(request);
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

    const response = await POST(request);
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

    const response = await POST(request);
    expect(response.status).toBe(202);
  });

  it('rejects requests with untrusted Origin with 403', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://evil-site.com',
      },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Forbidden');
  });

  it('respects PORT environment variable for origin check', async () => {
    process.env.PORT = '8080';

    const validRequest = new Request('http://localhost:8080/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:8080',
      },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
      }),
    });

    const validResponse = await POST(validRequest);
    expect(validResponse.status).toBe(202);

    const oldPortRequest = new Request('http://localhost:8080/api/events', {
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

    const oldPortResponse = await POST(oldPortRequest);
    expect(oldPortResponse.status).toBe(403);
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
    const response = await POST(request);
    const duration = performance.now() - start;

    expect(response.status).toBe(202);
    expect(duration).toBeLessThan(50);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { GET } from './+server';
import { appendHistory } from '../../../lib/server/history';
import { parseEvent } from '../../../lib/server/state';
import type { HistoryRunItem } from '../../../lib/history-format';

function createRequest(path = '/api/history', origin?: string): RequestEvent {
  const headers = new Headers();
  if (origin) {
    headers.set('Origin', origin);
  }
  const request = new Request(`http://127.0.0.1:3333${path}`, {
    method: 'GET',
    headers,
  });
  return {
    request,
    url: new URL(request.url),
  } as unknown as RequestEvent;
}

describe('GET /api/history', () => {
  let tempDir: string;
  const originalEnv = process.env.AGENT_HQ_HOME;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'hq-history-route-test-'));
    process.env.AGENT_HQ_HOME = tempDir;
  });

  afterEach(async () => {
    if (originalEnv !== undefined) {
      process.env.AGENT_HQ_HOME = originalEnv;
    } else {
      delete process.env.AGENT_HQ_HOME;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects forbidden origin with 403', async () => {
    const res = await GET(
      createRequest('/api/history', 'http://malicious-site.com:3333'),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Forbidden origin');
  });

  it('returns empty array when history is empty', async () => {
    const res = await GET(createRequest('/api/history'));
    expect(res.status).toBe(200);
    const runs = (await res.json()) as HistoryRunItem[];
    expect(runs).toEqual([]);
  });

  it('returns runs with logExists: false when logFile does not exist', async () => {
    const nonExistentLog = join(tempDir, 'does-not-exist.log');
    await appendHistory(
      parseEvent({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-1',
        ticketId: '18',
        data: { logFile: nonExistentLog },
      }),
    );
    await appendHistory(
      parseEvent({
        event: 'TASK_COMPLETE',
        agent: 'agy',
        runId: 'run-1',
        data: { exitCode: 0, prNumber: 42, repo: 'tihofman/agent-hq' },
      }),
    );

    const res = await GET(createRequest('/api/history'));
    expect(res.status).toBe(200);
    const runs = (await res.json()) as HistoryRunItem[];
    expect(runs).toHaveLength(1);

    const run = runs[0];
    expect(run.runId).toBe('run-1');
    expect(run.agent).toBe('agy');
    expect(run.ticketId).toBe('18');
    expect(run.status).toBe('complete');
    expect(run.exitCode).toBe(0);
    expect(run.logExists).toBe(false);
    expect(run.logFile).toBe(nonExistentLog);
    expect(run.data.prNumber).toBe(42);
    expect(run.data.repo).toBe('tihofman/agent-hq');
    expect(run.events).toHaveLength(2);
  });

  it('returns logExists: true when logFile exists on disk', async () => {
    const realLog = join(tempDir, 'run-2.log');
    await writeFile(realLog, 'some log lines...\n', 'utf8');

    await appendHistory(
      parseEvent({
        event: 'TASK_START',
        agent: 'codex',
        runId: 'run-2',
        ticketId: '20',
        data: { logFile: realLog },
      }),
    );
    await appendHistory(
      parseEvent({
        event: 'TASK_FAILED',
        agent: 'codex',
        runId: 'run-2',
        data: { exitCode: 2 },
      }),
    );

    const res = await GET(createRequest('/api/history'));
    expect(res.status).toBe(200);
    const runs = (await res.json()) as HistoryRunItem[];
    expect(runs).toHaveLength(1);

    const run = runs[0];
    expect(run.runId).toBe('run-2');
    expect(run.agent).toBe('codex');
    expect(run.status).toBe('failed');
    expect(run.exitCode).toBe(2);
    expect(run.logExists).toBe(true);
    expect(run.logFile).toBe(realLog);
  });

  it('returns at most 20 runs sorted descending by startedAt', async () => {
    for (let i = 1; i <= 25; i++) {
      const pad = i.toString().padStart(2, '0');
      await appendHistory(
        parseEvent({
          event: 'TASK_START',
          agent: 'claude',
          runId: `run-${pad}`,
          timestamp: `2026-10-22T10:${pad}:00.000Z`,
        }),
      );
    }

    const res = await GET(createRequest('/api/history'));
    expect(res.status).toBe(200);
    const runs = (await res.json()) as HistoryRunItem[];
    expect(runs).toHaveLength(20);
    expect(runs[0].runId).toBe('run-25');
    expect(runs[19].runId).toBe('run-06');
  });
});

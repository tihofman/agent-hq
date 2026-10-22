import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import {
  getLogDir,
  init,
  startServerTail,
  stopServerTail,
} from './hooks.server';
import { dispatch, getState, resetStore } from './lib/server/store';
import { parseEvent } from './lib/server/state';
import { POST } from './routes/api/events/+server';

function createRequestEvent(request: Request): RequestEvent {
  return {
    request,
    url: new URL(request.url),
  } as unknown as RequestEvent;
}

describe('hooks.server log-tailer wiring', () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    resetStore();
    stopServerTail();
    tempDir = await mkdtemp(join(tmpdir(), 'agent-hq-test-'));
    originalEnv = process.env.AGENT_HQ_LOG_DIR;
    process.env.AGENT_HQ_LOG_DIR = tempDir;
  });

  afterEach(async () => {
    stopServerTail();
    resetStore();
    if (originalEnv === undefined) {
      delete process.env.AGENT_HQ_LOG_DIR;
    } else {
      process.env.AGENT_HQ_LOG_DIR = originalEnv;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('uses AGENT_HQ_LOG_DIR env or defaults to os.tmpdir()/agent-hq', () => {
    expect(getLogDir()).toBe(tempDir);
    delete process.env.AGENT_HQ_LOG_DIR;
    expect(getLogDir()).toBe(join(tmpdir(), 'agent-hq'));
  });

  it('starts tailer via init() and feeds TASK_PROGRESS into store for active run via POST handler', async () => {
    init();

    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-post-1',
      }),
    });
    const res = await POST(createRequestEvent(request));
    expect(res.status).toBe(202);
    expect(getState().runs['run-post-1']?.status).toBe('running');

    const logFile = join(tempDir, 'run-post-1.log');
    await appendFile(logFile, 'build successful\n');

    await expect
      .poll(() => getState().runs['run-post-1']?.data?.logChunk)
      .toBe('build successful\n');
    expect(getState().runs['run-post-1']?.agent).toBe('agy');
  });

  it('feeds TASK_PROGRESS into store for active run via dispatch', async () => {
    startServerTail({ dir: tempDir });

    dispatch(
      parseEvent({
        event: 'TASK_START',
        agent: 'codex',
        runId: 'run-dispatch-1',
      }),
    );
    expect(getState().runs['run-dispatch-1']?.agent).toBe('codex');

    const logFile = join(tempDir, 'run-dispatch-1.log');
    await appendFile(logFile, 'running tests\n');

    await expect
      .poll(() => getState().runs['run-dispatch-1']?.data?.logChunk)
      .toBe('running tests\n');
    expect(getState().runs['run-dispatch-1']?.agent).toBe('codex');
  });

  it('considers runs active with status handover or running, but stops watching completed runs', async () => {
    startServerTail({ dir: tempDir });

    // 1. Handover run should be active and tailed
    dispatch(
      parseEvent({
        event: 'TASK_HANDOVER',
        agent: 'claude',
        runId: 'run-handover-1',
      }),
    );
    expect(getState().runs['run-handover-1']?.status).toBe('handover');

    const handoverLog = join(tempDir, 'run-handover-1.log');
    await appendFile(handoverLog, 'planning task\n');

    await expect
      .poll(() => getState().runs['run-handover-1']?.data?.logChunk)
      .toBe('planning task\n');

    // 2. Transition handover run to complete
    dispatch(
      parseEvent({
        event: 'TASK_COMPLETE',
        agent: 'claude',
        runId: 'run-handover-1',
      }),
    );
    expect(getState().runs['run-handover-1']?.status).toBe('complete');

    // Subsequent writes to completed run must be ignored
    await appendFile(handoverLog, 'extra output after finish\n');

    // Trigger watcher scan by touching an active run
    dispatch(
      parseEvent({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-active-2',
      }),
    );
    const activeLog = join(tempDir, 'run-active-2.log');
    await appendFile(activeLog, 'active line\n');

    await expect
      .poll(() => getState().runs['run-active-2']?.data?.logChunk)
      .toBe('active line\n');

    // Completed run's logChunk should still be the one before completion
    expect(getState().runs['run-handover-1']?.data?.logChunk).toBe(
      'planning task\n',
    );
  });

  it('starts only once and prevents duplicate tailers on HMR / repeated init calls', async () => {
    const stop1 = startServerTail({ dir: tempDir });
    const stop2 = startServerTail({ dir: tempDir });
    init();

    expect(stop1).toBe(stop2);

    dispatch(
      parseEvent({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-dedup',
      }),
    );

    const logFile = join(tempDir, 'run-dedup.log');
    await appendFile(logFile, 'line once\n');

    await expect
      .poll(() => getState().runs['run-dedup']?.data?.logChunk)
      .toBe('line once\n');
  });

  it('creates directory if it does not exist', async () => {
    const nestedDir = join(tempDir, 'nested', 'agent-hq');
    startServerTail({ dir: nestedDir });

    dispatch(
      parseEvent({
        event: 'TASK_START',
        agent: 'codex',
        runId: 'run-nested',
      }),
    );

    await appendFile(join(nestedDir, 'run-nested.log'), 'nested test\n');

    await expect
      .poll(() => getState().runs['run-nested']?.data?.logChunk)
      .toBe('nested test\n');
  });

  it('stops tailing when stopped', async () => {
    startServerTail({ dir: tempDir });

    dispatch(
      parseEvent({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-stop-test',
      }),
    );

    const logFile = join(tempDir, 'run-stop-test.log');
    await appendFile(logFile, 'before stop\n');

    await expect
      .poll(() => getState().runs['run-stop-test']?.data?.logChunk)
      .toBe('before stop\n');

    stopServerTail();

    await appendFile(logFile, 'after stop\n');

    // Give some time to ensure no new event was processed
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getState().runs['run-stop-test']?.data?.logChunk).toBe(
      'before stop\n',
    );
  });
});

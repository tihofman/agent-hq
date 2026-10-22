import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import {
  GLOBAL_TAILER_KEY,
  getLogDir,
  init,
  startServerTail,
  stopServerTail,
} from './hooks.server';
import { dispatch, getState, resetStore, subscribe } from './lib/server/store';
import { parseEvent } from './lib/server/state';
import { POST } from './routes/api/events/+server';

function createRequestEvent(request: Request): RequestEvent {
  return {
    request,
    url: new URL(request.url),
  } as unknown as RequestEvent;
}

// fs.watch polls wait up to 5 s; the test timeout must exceed that under load.
describe('hooks.server log-tailer wiring', { timeout: 15_000 }, () => {
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
      .poll(() => getState().runs['run-post-1']?.data?.logChunk, {
        timeout: 5000,
      })
      .toBe('build successful\n');
    expect(getState().runs['run-post-1']?.agent).toBe('agy');
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
      .poll(() => getState().runs['run-handover-1']?.data?.logChunk, {
        timeout: 5000,
      })
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
      .poll(() => getState().runs['run-active-2']?.data?.logChunk, {
        timeout: 5000,
      })
      .toBe('active line\n');

    // Completed run's logChunk should still be the one before completion
    expect(getState().runs['run-handover-1']?.data?.logChunk).toBe(
      'planning task\n',
    );
  });

  it('replaces old tailer on re-init / HMR and dispatches line exactly once', async () => {
    init();
    const oldStop = (globalThis as Record<string, unknown>)[
      GLOBAL_TAILER_KEY
    ] as () => void;
    const stopSpy = vi.fn(oldStop);
    (globalThis as Record<string, unknown>)[GLOBAL_TAILER_KEY] = stopSpy;

    init();
    expect(stopSpy).toHaveBeenCalledTimes(1);
    const newStop = (globalThis as Record<string, unknown>)[
      GLOBAL_TAILER_KEY
    ] as () => void;
    expect(newStop).toBeTypeOf('function');
    expect(newStop).not.toBe(oldStop);

    const progressEvents: unknown[] = [];
    const unsubscribe = subscribe((_state, event) => {
      if ('event' in event && event.event === 'TASK_PROGRESS') {
        progressEvents.push(event);
      }
    });

    try {
      dispatch(
        parseEvent({
          event: 'TASK_START',
          agent: 'agy',
          runId: 'run-replace',
        }),
      );

      const logFile = join(tempDir, 'run-replace.log');
      await appendFile(logFile, 'line once\n');

      await expect
        .poll(() => getState().runs['run-replace']?.data?.logChunk, {
          timeout: 5000,
        })
        .toBe('line once\n');

      expect(progressEvents).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });
});

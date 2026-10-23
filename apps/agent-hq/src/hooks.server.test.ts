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
  let originalHqHome: string | undefined;

  beforeEach(async () => {
    resetStore();
    stopServerTail();
    tempDir = await mkdtemp(join(tmpdir(), 'agent-hq-test-'));
    originalEnv = process.env.AGENT_HQ_LOG_DIR;
    process.env.AGENT_HQ_LOG_DIR = tempDir;
    originalHqHome = process.env.AGENT_HQ_HOME;
    process.env.AGENT_HQ_HOME = tempDir;
  });

  afterEach(async () => {
    stopServerTail();
    resetStore();
    if (originalEnv === undefined) {
      delete process.env.AGENT_HQ_LOG_DIR;
    } else {
      process.env.AGENT_HQ_LOG_DIR = originalEnv;
    }
    if (originalHqHome === undefined) {
      delete process.env.AGENT_HQ_HOME;
    } else {
      process.env.AGENT_HQ_HOME = originalHqHome;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('ticks every 5 seconds only during cooldown and cleans up on HMR and stop', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
    const ticks: unknown[] = [];
    const unsubscribe = subscribe((_state, event) => {
      if ('type' in event && event.type === 'TICK') ticks.push(event);
    });
    try {
      init();
      vi.advanceTimersByTime(5_000);
      expect(ticks).toEqual([]);
      dispatch(
        parseEvent({
          event: 'RATE_LIMITED',
          agent: 'codex',
          runId: 'cool',
          data: { cooldownUntil: '2026-10-22T12:00:12.000Z' },
        }),
      );
      init();
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(5_000);
      expect(ticks).toEqual([
        { type: 'TICK', timestamp: '2026-10-22T12:00:10.000Z' },
      ]);
      expect(getState().agents.codex.status).toBe('cooldown');
      vi.advanceTimersByTime(5_000);
      expect(getState().agents.codex.status).toBe('idle');
      vi.advanceTimersByTime(5_000);
      expect(ticks).toHaveLength(2);
      dispatch(
        parseEvent({ event: 'RATE_LIMITED', agent: 'agy', runId: 'unknown' }),
      );
      vi.advanceTimersByTime(5_000);
      expect(ticks).toHaveLength(3);
      stopServerTail();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(60_000);
      expect(ticks).toHaveLength(3);
    } finally {
      stopServerTail();
      unsubscribe();
      vi.useRealTimers();
    }
  });

  it('continues tailing cooldown runs so later resets can extend the countdown', async () => {
    dispatch(
      parseEvent({ event: 'TASK_START', agent: 'agy', runId: 'limited' }),
    );
    init();
    const file = join(tempDir, 'limited.log');
    await appendFile(file, 'You have exhausted your quota on this model.\n');
    await expect.poll(() => getState().agents.agy.status).toBe('cooldown');
    await appendFile(
      file,
      'You have exhausted your quota on this model. Retry-After: 60\n',
    );
    await expect.poll(() => getState().agents.agy.cooldownUntil).toBeDefined();
    expect(getState().runs.limited.status).toBe('cooldown');
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

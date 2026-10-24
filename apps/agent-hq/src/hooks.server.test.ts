import { watch } from 'node:fs';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import {
  GLOBAL_TAILER_KEY,
  GLOBAL_WORKER_POOL_KEY,
  getLogDir,
  init,
  startServerTail,
  stopServerTail,
  stopServerWorkers,
  hasTeamStatusesChanged,
  createTeamStatusPoller,
} from './hooks.server';
import { readHistory, recordEvent } from './lib/server/history';
import { dispatch, getState, resetStore, subscribe } from './lib/server/store';
import { parseEvent } from './lib/server/state';
import { POST } from './routes/api/events/+server';

function createRequestEvent(request: Request): RequestEvent {
  return {
    request,
    url: new URL(request.url),
  } as unknown as RequestEvent;
}

// Probe whether fs.watch works on a temp directory (fails e.g. with EMFILE in restricted sandboxes).
const canWatchFs = await (async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-hq-watch-probe-'));
  try {
    return await new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined = undefined;
      let watcher: ReturnType<typeof watch> | undefined;
      let settled = false;
      const finish = (result: boolean) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          try {
            watcher?.close();
          } catch {
            // ignore
          }
          resolve(result);
        }
      };
      try {
        watcher = watch(dir);
        watcher.on('error', () => finish(false));
      } catch {
        return finish(false);
      }
      timer = setTimeout(() => finish(true), 50);
      timer.unref?.();
    });
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
})();

// Under parallel load, macOS FSEvents event delivery and disk flushing can take several seconds.
// A generous 20s poll timeout ensures stability without delaying passing assertions (expect.poll resolves immediately on match).
const POLL_OPTIONS = { timeout: 20_000, interval: 50 };

describe('hooks.server log-tailer wiring', { timeout: 60_000 }, () => {
  let tempDir: string;
  let originalEnv: string | undefined;
  let originalHqHome: string | undefined;

  beforeEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    stopServerTail();
    await stopServerWorkers();
    resetStore();
    tempDir = await mkdtemp(join(tmpdir(), 'agent-hq-hooks-test-'));
    originalEnv = process.env.AGENT_HQ_LOG_DIR;
    process.env.AGENT_HQ_LOG_DIR = tempDir;
    originalHqHome = process.env.AGENT_HQ_HOME;
    process.env.AGENT_HQ_HOME = tempDir;
  });

  afterEach(async () => {
    try {
      stopServerTail();
      await stopServerWorkers();
      delete (globalThis as Record<string, unknown>)[GLOBAL_TAILER_KEY];
      delete (globalThis as Record<string, unknown>)[GLOBAL_WORKER_POOL_KEY];
      resetStore();
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
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
    }
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
      expect(vi.getTimerCount()).toBe(3);
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

  it.skipIf(!canWatchFs)(
    'continues tailing cooldown runs so later resets can extend the countdown',
    async () => {
      dispatch(
        parseEvent({ event: 'TASK_START', agent: 'agy', runId: 'limited' }),
      );
      init();
      const file = join(tempDir, 'limited.log');
      await appendFile(file, 'You have exhausted your quota on this model.\n');
      await expect
        .poll(() => getState().agents.agy.status, POLL_OPTIONS)
        .toBe('cooldown');
      await appendFile(
        file,
        'You have exhausted your quota on this model. Retry-After: 60\n',
      );
      await expect
        .poll(() => getState().agents.agy.cooldownUntil, POLL_OPTIONS)
        .toBeDefined();
      expect(getState().runs.limited.status).toBe('cooldown');
    },
  );

  it('uses AGENT_HQ_LOG_DIR env or defaults to os.tmpdir()/agent-hq', () => {
    expect(getLogDir()).toBe(tempDir);
    delete process.env.AGENT_HQ_LOG_DIR;
    expect(getLogDir()).toBe(join(tmpdir(), 'agent-hq'));
  });

  it.skipIf(!canWatchFs)(
    'starts tailer via init() and feeds TASK_PROGRESS into store for active run via POST handler',
    async () => {
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
        .poll(() => getState().runs['run-post-1']?.data?.logChunk, POLL_OPTIONS)
        .toBe('build successful\n');
      expect(getState().runs['run-post-1']?.agent).toBe('agy');
    },
  );

  it.skipIf(!canWatchFs)(
    'considers runs active with status handover or running, but stops watching completed runs',
    async () => {
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
        .poll(
          () => getState().runs['run-handover-1']?.data?.logChunk,
          POLL_OPTIONS,
        )
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
        .poll(
          () => getState().runs['run-active-2']?.data?.logChunk,
          POLL_OPTIONS,
        )
        .toBe('active line\n');

      // Completed run's logChunk should still be the one before completion
      expect(getState().runs['run-handover-1']?.data?.logChunk).toBe(
        'planning task\n',
      );
    },
  );

  it.skipIf(!canWatchFs)(
    'replaces old tailer on re-init / HMR and dispatches line exactly once',
    async () => {
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
          .poll(
            () => getState().runs['run-replace']?.data?.logChunk,
            POLL_OPTIONS,
          )
          .toBe('line once\n');

        expect(progressEvents).toHaveLength(1);
      } finally {
        unsubscribe();
      }
    },
  );

  it('sweeps stale runs (dead PID, no PID > 15m) while keeping living PIDs active, broadcasting and appending RUN_STALE', async () => {
    const now = Date.parse('2026-10-23T12:00:00.000Z');
    const oldTime = new Date(now - 20 * 60 * 1000).toISOString();
    const veryOldTime = new Date(now - 2 * 60 * 60 * 1000).toISOString();

    await recordEvent(
      parseEvent({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-dead-pid',
        pid: 1001,
        timestamp: new Date(now - 60 * 1000).toISOString(),
      }),
    );
    await recordEvent(
      parseEvent({
        event: 'TASK_HANDOVER',
        agent: 'codex',
        runId: 'run-old-no-pid',
        timestamp: oldTime,
      }),
    );
    await recordEvent(
      parseEvent({
        event: 'TASK_START',
        agent: 'claude',
        runId: 'run-alive-pid',
        pid: 2002,
        timestamp: veryOldTime,
      }),
    );

    const broadcasted: unknown[] = [];
    const unsubscribe = subscribe((_state, event) => {
      if ('event' in event && event.event === 'RUN_STALE') {
        broadcasted.push(event);
      }
    });

    try {
      vi.useFakeTimers();
      startServerTail({
        dir: tempDir,
        now: () => now,
        isAlive: (pid) => pid === 2002,
      });

      vi.advanceTimersByTime(29_000);
      expect(getState().runs['run-dead-pid'].status).toBe('running');
      expect(broadcasted).toHaveLength(0);

      vi.advanceTimersByTime(1_000);

      const state = getState();
      expect(state.runs['run-dead-pid'].status).toBe('stale');
      expect(state.agents.agy).toMatchObject({
        status: 'idle',
        room: 'lounge',
      });
      expect(state.runs['run-old-no-pid'].status).toBe('stale');
      expect(state.agents.codex).toMatchObject({
        status: 'idle',
        room: 'lounge',
      });
      expect(state.runs['run-alive-pid'].status).toBe('running');
      expect(state.agents.claude).toMatchObject({
        status: 'coding',
        room: 'dev',
      });

      expect(broadcasted).toHaveLength(2);

      // Second sweep at 60s is a no-op because stale runs are no longer active
      vi.advanceTimersByTime(30_000);
      expect(broadcasted).toHaveLength(2);

      vi.useRealTimers();
      await expect
        .poll(
          async () => (await readHistory()).map((e) => `${e.event}:${e.runId}`),
          POLL_OPTIONS,
        )
        .toEqual([
          'TASK_START:run-dead-pid',
          'TASK_HANDOVER:run-old-no-pid',
          'TASK_START:run-alive-pid',
          'RUN_STALE:run-dead-pid',
          'RUN_STALE:run-old-no-pid',
        ]);
    } finally {
      stopServerTail();
      unsubscribe();
      vi.useRealTimers();
    }
  });

  describe('Team status polling (#102)', () => {
    it('detects changes in team statuses', () => {
      expect(
        hasTeamStatusesChanged(undefined, {
          frontend: 'idle',
          backend: 'idle',
          qa: 'idle',
        }),
      ).toBe(true);

      const current = {
        frontend: { status: 'idle' as const },
        backend: { status: 'idle' as const },
        qa: { status: 'idle' as const },
      };
      expect(
        hasTeamStatusesChanged(current, {
          frontend: 'idle',
          backend: 'idle',
          qa: 'idle',
        }),
      ).toBe(false);

      expect(
        hasTeamStatusesChanged(current, {
          frontend: 'working',
          backend: 'idle',
          qa: 'idle',
        }),
      ).toBe(true);
    });

    it('only dispatches on actual status changes and skips redundant ticks', async () => {
      let currentTeams = undefined as
        Record<string, { status: string }> | undefined;
      const dispatched: unknown[] = [];
      const mockQueue = {
        getJobs: vi.fn(async () => []),
      };
      const mockQm = {
        getQueue: vi.fn(() => mockQueue as never),
      };

      const poller = createTeamStatusPoller(
        () => mockQm as never,
        () => currentTeams as never,
        (statuses) => {
          dispatched.push(statuses);
          currentTeams = {
            frontend: { status: statuses.frontend },
            backend: { status: statuses.backend },
            qa: { status: statuses.qa },
          };
        },
      );

      // Initial tick dispatches because currentTeams is undefined
      await poller();
      expect(dispatched).toHaveLength(1);

      // Second tick with same statuses does not dispatch
      await poller();
      expect(dispatched).toHaveLength(1);

      // Status changes -> dispatches
      mockQueue.getJobs.mockResolvedValueOnce([
        { state: 'active', data: {} } as never,
      ]);
      await poller();
      expect(dispatched).toHaveLength(2);
      expect((dispatched[1] as Record<string, string>).frontend).toBe(
        'working',
      );
    });

    it('prevents overlapping polling runs when Redis is slow', async () => {
      let resolveJobs: (val: unknown[]) => void;
      const slowPromise = new Promise<unknown[]>((res) => {
        resolveJobs = res;
      });
      const mockQueue = {
        getJobs: vi.fn(() => slowPromise),
      };
      const mockQm = {
        getQueue: vi.fn(() => mockQueue as never),
      };

      const poller = createTeamStatusPoller(
        () => mockQm as never,
        () => undefined,
        () => {},
      );

      // First call starts and awaits slowPromise
      const run1 = poller();
      expect(mockQueue.getJobs).toHaveBeenCalledTimes(1);

      // Second call during in-flight run is dropped by overlap guard
      const run2 = poller();
      expect(mockQueue.getJobs).toHaveBeenCalledTimes(1);

      resolveJobs!([]);
      await Promise.all([run1, run2]);

      // After completion, new poll can proceed
      mockQueue.getJobs.mockResolvedValueOnce([] as never);
      await poller();
      expect(mockQueue.getJobs).toBeCalled();
    });

    it('logs polling errors at most once per error state and recovers', async () => {
      const logs: string[] = [];
      const errorQm = {
        getQueue: vi.fn(() => {
          throw new Error('Redis connection refused');
        }),
      };

      const poller = createTeamStatusPoller(
        () => errorQm as never,
        () => undefined,
        () => {},
        (msg, err) =>
          logs.push(
            `${msg} ${err instanceof Error ? err.message : String(err)}`,
          ),
      );

      await poller();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('Redis connection refused');

      // Subsequent identical errors are not re-logged
      await poller();
      expect(logs).toHaveLength(1);

      // Different error is logged
      errorQm.getQueue.mockImplementationOnce(() => {
        throw new Error('Redis timeout');
      });
      await poller();
      expect(logs).toHaveLength(2);
      expect(logs[1]).toContain('Redis timeout');

      // Success resets error state
      const goodQueue = { getJobs: vi.fn(async () => []) };
      errorQm.getQueue.mockImplementation(() => goodQueue as never);
      await poller();
      expect(logs).toHaveLength(2);

      // New error after recovery is logged again
      errorQm.getQueue.mockImplementationOnce(() => {
        throw new Error('Redis connection refused');
      });
      await poller();
      expect(logs).toHaveLength(3);
    });
  });
});

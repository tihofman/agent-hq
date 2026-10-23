import { describe, expect, it, vi } from 'vitest';
import { isProcessAlive, isRunStale, STALE_THRESHOLD_MS } from './runs';
import type { Run } from './server/state';

describe('runs', () => {
  it('defines default stale threshold as 15 minutes', () => {
    expect(STALE_THRESHOLD_MS).toBe(15 * 60 * 1000);
  });

  describe('isProcessAlive', () => {
    it('returns true for current process.pid', () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    it('returns false for dead PID', () => {
      expect(isProcessAlive(999999999)).toBe(false);
    });

    it('returns true on EPERM error (process exists without permissions)', () => {
      const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
        const err = new Error(
          'operation not permitted',
        ) as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      });
      try {
        expect(isProcessAlive(1234)).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    it('returns false on ESRCH error', () => {
      const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
        const err = new Error('no such process') as NodeJS.ErrnoException;
        err.code = 'ESRCH';
        throw err;
      });
      try {
        expect(isProcessAlive(1234)).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('isRunStale', () => {
    const baseRun: Run = {
      runId: 'r-1',
      agent: 'agy',
      status: 'running',
      timestamp: '2026-10-23T12:00:00Z',
      data: {},
    };

    it('returns true if run status is already stale', () => {
      expect(isRunStale({ ...baseRun, status: 'stale' })).toBe(true);
    });

    it('returns false for non-active finished statuses', () => {
      expect(isRunStale({ ...baseRun, status: 'complete' })).toBe(false);
      expect(isRunStale({ ...baseRun, status: 'failed' })).toBe(false);
      expect(isRunStale({ ...baseRun, status: 'aborted' })).toBe(false);
    });

    it('returns true for active run with dead PID', () => {
      const run: Run = { ...baseRun, pid: 999999999 };
      expect(isRunStale(run)).toBe(true);
    });

    it('returns false for active run with living PID even if timestamp is very old', () => {
      const run: Run = {
        ...baseRun,
        pid: process.pid,
        timestamp: '2020-01-01T00:00:00Z',
      };
      expect(isRunStale(run, { now: Date.parse('2026-10-23T12:00:00Z') })).toBe(
        false,
      );
    });

    it('returns true for active run without PID older than threshold', () => {
      const baseTime = Date.parse('2026-10-23T12:20:00Z');
      const run: Run = {
        ...baseRun,
        status: 'handover',
        pid: undefined,
        timestamp: '2026-10-23T12:00:00Z', // 20m ago (> 15m)
      };
      expect(isRunStale(run, { now: baseTime })).toBe(true);
    });

    it('returns false for active run without PID within threshold', () => {
      const baseTime = Date.parse('2026-10-23T12:10:00Z');
      const run: Run = {
        ...baseRun,
        status: 'handover',
        pid: undefined,
        timestamp: '2026-10-23T12:00:00Z', // 10m ago (< 15m)
      };
      expect(isRunStale(run, { now: baseTime })).toBe(false);
    });

    it('returns true for active run without PID when timestamp is invalid', () => {
      const run: Run = {
        ...baseRun,
        status: 'running',
        pid: undefined,
        timestamp: 'invalid-date',
      };
      expect(isRunStale(run)).toBe(true);
    });

    it('respects custom staleThresholdMs and isPidAlive options', () => {
      const runWithPid: Run = { ...baseRun, pid: 123 };
      expect(isRunStale(runWithPid, { isPidAlive: (pid) => pid === 123 })).toBe(
        false,
      );
      expect(isRunStale(runWithPid, { isPidAlive: (pid) => pid !== 123 })).toBe(
        true,
      );

      const runNoPid: Run = {
        ...baseRun,
        pid: null,
        timestamp: '2026-10-23T12:00:00Z',
      };
      // 5 min elapsed; default threshold 15m -> false, custom threshold 3m -> true
      const now = Date.parse('2026-10-23T12:05:00Z');
      expect(
        isRunStale(runNoPid, { now, staleThresholdMs: 3 * 60 * 1000 }),
      ).toBe(true);
      expect(
        isRunStale(runNoPid, { now, staleThresholdMs: 10 * 60 * 1000 }),
      ).toBe(false);
    });
  });
});

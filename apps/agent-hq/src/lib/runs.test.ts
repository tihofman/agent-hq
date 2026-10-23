import { describe, expect, it } from 'vitest';
import { isRunStale, STALE_THRESHOLD_MS } from './runs';
import type { Run } from './server/state';

describe('runs', () => {
  const baseRun: Run = {
    runId: 'r-1',
    agent: 'agy',
    status: 'running',
    timestamp: '2026-10-23T12:00:00Z',
    data: {},
  };

  it('defines default stale threshold as 15 minutes', () => {
    expect(STALE_THRESHOLD_MS).toBe(15 * 60 * 1000);
  });

  it('returns false for non-active statuses', () => {
    expect(isRunStale({ ...baseRun, status: 'complete' })).toBe(false);
    expect(isRunStale({ ...baseRun, status: 'failed' })).toBe(false);
    expect(isRunStale({ ...baseRun, status: 'aborted' })).toBe(false);
    expect(isRunStale({ ...baseRun, status: 'stale' })).toBe(false);
  });

  it('evaluates active run with PID using injected isAlive', () => {
    const run: Run = {
      ...baseRun,
      pid: 1234,
      timestamp: '2020-01-01T00:00:00Z',
    };
    const now = Date.parse('2026-10-23T12:00:00Z');
    expect(isRunStale(run, { now, isAlive: () => true })).toBe(false);
    expect(isRunStale(run, { now, isAlive: () => false })).toBe(true);
  });

  it('evaluates active run without PID against STALE_THRESHOLD_MS', () => {
    const run: Run = { ...baseRun, status: 'handover', pid: undefined };
    expect(isRunStale(run, { now: Date.parse('2026-10-23T12:10:00Z') })).toBe(
      false,
    );
    expect(isRunStale(run, { now: Date.parse('2026-10-23T12:20:00Z') })).toBe(
      true,
    );
  });
});

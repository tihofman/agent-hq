import { describe, it, expect } from 'vitest';
import { getCurrentRun } from './run';
import type { Run } from '../../server/state';

function createRun(
  runId: string,
  status: Run['status'],
  timestamp: string,
  ticketId?: string,
): Run {
  return {
    runId,
    agent: 'agy',
    status,
    timestamp,
    ticketId,
    data: {},
  };
}

describe('getCurrentRun', () => {
  it('returns undefined when runs is empty', () => {
    expect(getCurrentRun({})).toBeUndefined();
  });

  it('selects active run with status handover or running', () => {
    const runs: Record<string, Run> = {
      'run-1': createRun(
        'run-1',
        'complete',
        '2026-10-22T10:00:00Z',
        'ticket-1',
      ),
      'run-2': createRun(
        'run-2',
        'running',
        '2026-10-22T09:00:00Z',
        'ticket-2',
      ),
    };

    expect(getCurrentRun(runs)?.runId).toBe('run-2');
  });

  it('picks the newest active run when multiple active runs exist', () => {
    const runs: Record<string, Run> = {
      'run-handover': createRun(
        'run-handover',
        'handover',
        '2026-10-22T10:00:00Z',
      ),
      'run-running': createRun(
        'run-running',
        'running',
        '2026-10-22T10:05:00Z',
      ),
    };

    expect(getCurrentRun(runs)?.runId).toBe('run-running');
  });

  it('falls back to the most recent run when no active run exists', () => {
    const runs: Record<string, Run> = {
      'run-old': createRun('run-old', 'complete', '2026-10-22T08:00:00Z'),
      'run-failed': createRun('run-failed', 'failed', '2026-10-22T09:30:00Z'),
      'run-aborted': createRun(
        'run-aborted',
        'aborted',
        '2026-10-22T09:00:00Z',
      ),
    };

    expect(getCurrentRun(runs)?.runId).toBe('run-failed');
  });
});

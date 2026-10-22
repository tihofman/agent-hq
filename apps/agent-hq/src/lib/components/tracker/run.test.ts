import { describe, it, expect } from 'vitest';
import { getCurrentRun, hasReloadEvent, RELOAD_EVENTS } from './run';
import type { Run, HQEvent } from '../../server/state';

function createEvent(
  event: HQEvent['event'],
  timestamp = '2026-10-22T10:00:00Z',
): HQEvent {
  return {
    event,
    agent: 'agy',
    timestamp,
    room: 'dev',
    data: {},
  } as HQEvent;
}

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

describe('hasReloadEvent', () => {
  it('contains expected reload event types', () => {
    expect(RELOAD_EVENTS).toEqual(
      new Set(['TASK_HANDOVER', 'REVIEW_START', 'PR_READY', 'MERGED']),
    );
  });

  it('returns false for empty feed', () => {
    expect(hasReloadEvent([])).toBe(false);
  });

  it('returns false when feed has no reload events', () => {
    const feed = [
      createEvent('TASK_START'),
      createEvent('TASK_PROGRESS'),
      createEvent('TASK_COMPLETE'),
    ];
    expect(hasReloadEvent(feed)).toBe(false);
  });

  it('returns true when a reload event is present after lastSeen', () => {
    const ev1 = createEvent('TASK_START');
    const ev2 = createEvent('TASK_PROGRESS');
    const ev3 = createEvent('PR_READY');

    expect(hasReloadEvent([ev1, ev2, ev3], ev2)).toBe(true);
  });

  it('returns false when reload event occurred before or at lastSeen', () => {
    const ev1 = createEvent('PR_READY');
    const ev2 = createEvent('TASK_PROGRESS');

    expect(hasReloadEvent([ev1, ev2], ev2)).toBe(false);
  });

  it('detects new PR_READY when feed is full (1000 items) and length does not change', () => {
    const feed: HQEvent[] = [];
    for (let i = 0; i < 1000; i++) {
      feed.push(createEvent('TASK_PROGRESS', `2026-10-22T10:00:${i % 60}Z`));
    }
    expect(feed.length).toBe(1000);

    // Initial state: component has seen all 1000 items
    let lastSeen: HQEvent | undefined = feed.at(-1);
    expect(hasReloadEvent(feed, lastSeen)).toBe(false);

    // New event arrives: liveStore.feed.push(event); while (feed.length > 1000) feed.shift();
    const prReadyEvent = createEvent('PR_READY', '2026-10-22T10:01:00Z');
    feed.push(prReadyEvent);
    while (feed.length > 1000) {
      feed.shift();
    }

    // Length is still capped at 1000
    expect(feed.length).toBe(1000);

    // Reload event must be detected even though feed length remained 1000
    expect(hasReloadEvent(feed, lastSeen)).toBe(true);

    // After updating lastSeen, subsequent check without new events returns false
    lastSeen = feed.at(-1);
    expect(hasReloadEvent(feed, lastSeen)).toBe(false);
  });
});

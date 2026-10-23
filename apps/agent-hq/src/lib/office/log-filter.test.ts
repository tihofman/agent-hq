import { describe, it, expect, vi } from 'vitest';
import {
  filterCharacterLog,
  filterRunLogChunks,
  filterAgentFeed,
  getLogFileFallback,
  formatCharacterAriaLabel,
  createInitialModalState,
  openCharacterModal,
  closeCharacterModal,
  handleModalEscape,
  handleBackdropClose,
} from './log-filter';
import type { HQEvent, InternalAction, Run } from '../server/state';

function createLogChunkEvent(
  runId: string,
  chunk: string,
  agent: 'claude' | 'agy' | 'codex' = 'agy',
): HQEvent {
  return {
    event: 'TASK_PROGRESS',
    agent,
    runId,
    room: 'dev',
    timestamp: '2026-10-23T14:00:00.000Z',
    data: { logChunk: chunk },
  };
}

function createGenericEvent(
  event: HQEvent['event'],
  agent: 'claude' | 'agy' | 'codex',
  runId?: string,
  extraData: Record<string, unknown> = {},
): HQEvent {
  return {
    event,
    agent,
    runId,
    room: 'dev',
    timestamp: '2026-10-23T14:00:00.000Z',
    data: extraData,
  };
}

describe('office/log-filter', () => {
  describe('filterCharacterLog with active run', () => {
    it('returns only TASK_PROGRESS logChunks of the specified runId', () => {
      const feed: (HQEvent | InternalAction)[] = [
        createGenericEvent('TASK_START', 'agy', 'run-1', {
          title: 'Start task',
        }),
        createLogChunkEvent('run-1', 'compiling...\n'),
        createLogChunkEvent('run-2', 'other run chunk\n'),
        createLogChunkEvent('run-1', 'tests passing\n'),
        createGenericEvent('TASK_COMPLETE', 'agy', 'run-1', { exitCode: 0 }),
      ];

      const result = filterCharacterLog(feed, { agent: 'agy', runId: 'run-1' });

      expect(result).toHaveLength(2);
      expect((result[0] as HQEvent).data.logChunk).toBe('compiling...\n');
      expect((result[1] as HQEvent).data.logChunk).toBe('tests passing\n');
    });

    it('isolates logs between two parallel runs of the same agent', () => {
      const feed: (HQEvent | InternalAction)[] = [
        createLogChunkEvent('run-parallel-a', 'output A-1\n'),
        createLogChunkEvent('run-parallel-b', 'output B-1\n'),
        createLogChunkEvent('run-parallel-a', 'output A-2\n'),
        createLogChunkEvent('run-parallel-b', 'output B-2\n'),
      ];

      const logsA = filterCharacterLog(feed, {
        agent: 'agy',
        runId: 'run-parallel-a',
      });
      const logsB = filterCharacterLog(feed, {
        agent: 'agy',
        runId: 'run-parallel-b',
      });

      expect(logsA).toHaveLength(2);
      expect((logsA[0] as HQEvent).data.logChunk).toBe('output A-1\n');
      expect((logsA[1] as HQEvent).data.logChunk).toBe('output A-2\n');

      expect(logsB).toHaveLength(2);
      expect((logsB[0] as HQEvent).data.logChunk).toBe('output B-1\n');
      expect((logsB[1] as HQEvent).data.logChunk).toBe('output B-2\n');
    });

    it('ignores TASK_PROGRESS events without non-empty logChunk', () => {
      const feed: (HQEvent | InternalAction)[] = [
        createGenericEvent('TASK_PROGRESS', 'agy', 'run-1', {
          statusText: 'no log chunk',
        }),
        createGenericEvent('TASK_PROGRESS', 'agy', 'run-1', {
          logChunk: '',
        }),
        createLogChunkEvent('run-1', 'real log chunk\n'),
      ];

      const result = filterCharacterLog(feed, { agent: 'agy', runId: 'run-1' });

      expect(result).toHaveLength(1);
      expect((result[0] as HQEvent).data.logChunk).toBe('real log chunk\n');
    });
  });

  describe('filterCharacterLog without run (claude, idle agent)', () => {
    it('returns all feed events matching the agent when runId is undefined', () => {
      const feed: (HQEvent | InternalAction)[] = [
        createGenericEvent('TASK_START', 'claude', undefined, {
          title: 'Architect review',
        }),
        createLogChunkEvent('run-1', 'agy output\n', 'agy'),
        createGenericEvent('DRAFT_PR_CREATED', 'claude', undefined, {
          prNumber: 42,
        }),
        { type: 'TEST_STARTED', agent: 'claude' },
        { type: 'TICK', timestamp: '2026-10-23T14:05:00.000Z' },
        createGenericEvent('TASK_START', 'codex', undefined, {
          title: 'Codex idle',
        }),
      ];

      const claudeFeed = filterCharacterLog(feed, { agent: 'claude' });
      expect(claudeFeed).toHaveLength(3);
      expect((claudeFeed[0] as HQEvent).agent).toBe('claude');
      expect((claudeFeed[1] as HQEvent).agent).toBe('claude');
      const third = claudeFeed[2];
      expect('agent' in third && third.agent).toBe('claude');

      const codexFeed = filterCharacterLog(feed, { agent: 'codex' });
      expect(codexFeed).toHaveLength(1);
      expect((codexFeed[0] as HQEvent).agent).toBe('codex');
    });

    it('returns empty array when feed has no matching events', () => {
      const feed: (HQEvent | InternalAction)[] = [
        createLogChunkEvent('run-1', 'agy chunk\n', 'agy'),
      ];

      const result = filterCharacterLog(feed, { agent: 'claude' });
      expect(result).toEqual([]);
    });
  });

  describe('filterRunLogChunks and filterAgentFeed', () => {
    it('filterRunLogChunks extracts only chunks for the run', () => {
      const feed: (HQEvent | InternalAction)[] = [
        createLogChunkEvent('run-x', 'x1\n'),
        createLogChunkEvent('run-y', 'y1\n'),
        createLogChunkEvent('run-x', 'x2\n'),
      ];

      const chunks = filterRunLogChunks(feed, 'run-x');
      expect(chunks).toHaveLength(2);
      expect(chunks.map((c) => c.data.logChunk)).toEqual(['x1\n', 'x2\n']);
    });

    it('filterAgentFeed extracts all events for the agent', () => {
      const feed: (HQEvent | InternalAction)[] = [
        createGenericEvent('TASK_START', 'agy'),
        createGenericEvent('TASK_START', 'codex'),
      ];

      const agyEvents = filterAgentFeed(feed, 'agy');
      expect(agyEvents).toHaveLength(1);
      expect((agyEvents[0] as HQEvent).agent).toBe('agy');
    });
  });

  describe('getLogFileFallback', () => {
    it('returns run.logFile when available', () => {
      const run: Run = {
        runId: 'run-1',
        agent: 'agy',
        status: 'running',
        timestamp: '2026-10-23T14:00:00.000Z',
        logFile: '/tmp/agent-hq/runs/run-1.log',
        data: {},
      };

      expect(getLogFileFallback(run)).toBe('/tmp/agent-hq/runs/run-1.log');
    });

    it('falls back to run.data.logFile if run.logFile is not set', () => {
      const run: Run = {
        runId: 'run-1',
        agent: 'agy',
        status: 'running',
        timestamp: '2026-10-23T14:00:00.000Z',
        data: { logFile: '/fallback/path.log' },
      };

      expect(getLogFileFallback(run)).toBe('/fallback/path.log');
    });

    it('returns undefined when run has no logFile', () => {
      const run: Run = {
        runId: 'run-1',
        agent: 'agy',
        status: 'running',
        timestamp: '2026-10-23T14:00:00.000Z',
        data: {},
      };

      expect(getLogFileFallback(run)).toBeUndefined();
      expect(getLogFileFallback(null)).toBeUndefined();
      expect(getLogFileFallback(undefined)).toBeUndefined();
    });
  });

  describe('formatCharacterAriaLabel', () => {
    it('formats label with agent and ticket when ticketId is provided without leading #', () => {
      expect(formatCharacterAriaLabel('Agy', '79')).toBe('Agy - Ticket #79');
    });

    it('formats label with agent and ticket when ticketId already has leading #', () => {
      expect(formatCharacterAriaLabel('Claude', '#12')).toBe(
        'Claude - Ticket #12',
      );
    });

    it('formats label with agent only when ticketId is missing or empty', () => {
      expect(formatCharacterAriaLabel('Codex')).toBe('Codex');
      expect(formatCharacterAriaLabel('Claude', '')).toBe('Claude');
      expect(formatCharacterAriaLabel('Agy', '   ')).toBe('Agy');
    });
  });

  describe('modal open / close lifecycle and focus return', () => {
    it('initial state is closed', () => {
      const state = createInitialModalState();
      expect(state.isOpen).toBe(false);
      expect(state.target).toBeNull();
      expect(state.triggerElement).toBeNull();
    });

    it('opens modal with target and stores triggerElement', () => {
      const fakeBtn = { focus: vi.fn() };
      const state = openCharacterModal(
        { agent: 'agy', runId: 'run-1' },
        fakeBtn,
      );

      expect(state.isOpen).toBe(true);
      expect(state.target).toEqual({ agent: 'agy', runId: 'run-1' });
      expect(state.triggerElement).toBe(fakeBtn);
    });

    it('closes modal and restores focus to triggerElement', () => {
      const fakeBtn = { focus: vi.fn() };
      const openState = openCharacterModal({ agent: 'claude' }, fakeBtn);

      const closedState = closeCharacterModal(openState);

      expect(closedState.isOpen).toBe(false);
      expect(closedState.target).toBeNull();
      expect(closedState.triggerElement).toBeNull();
      expect(fakeBtn.focus).toHaveBeenCalledTimes(1);
    });

    it('handleModalEscape closes modal on Escape and restores focus', () => {
      const fakeBtn = { focus: vi.fn() };
      const openState = openCharacterModal(
        { agent: 'agy', runId: 'run-79' },
        fakeBtn,
      );

      const preventDefault = vi.fn();
      const nextState = handleModalEscape(
        { key: 'Escape', preventDefault },
        openState,
      );

      expect(preventDefault).toHaveBeenCalled();
      expect(nextState.isOpen).toBe(false);
      expect(fakeBtn.focus).toHaveBeenCalledTimes(1);
    });

    it('handleModalEscape ignores other keys', () => {
      const fakeBtn = { focus: vi.fn() };
      const openState = openCharacterModal(
        { agent: 'agy', runId: 'run-79' },
        fakeBtn,
      );

      const preventDefault = vi.fn();
      const nextState = handleModalEscape(
        { key: 'Enter', preventDefault },
        openState,
      );

      expect(preventDefault).not.toHaveBeenCalled();
      expect(nextState.isOpen).toBe(true);
      expect(fakeBtn.focus).not.toHaveBeenCalled();
    });

    it('handleBackdropClose closes modal only when backdrop was clicked', () => {
      const fakeBtn = { focus: vi.fn() };
      const openState = openCharacterModal({ agent: 'codex' }, fakeBtn);

      // Click inside modal (isBackdropTarget = false)
      const unchangedState = handleBackdropClose(false, openState);
      expect(unchangedState.isOpen).toBe(true);
      expect(fakeBtn.focus).not.toHaveBeenCalled();

      // Click backdrop (isBackdropTarget = true)
      const closedState = handleBackdropClose(true, openState);
      expect(closedState.isOpen).toBe(false);
      expect(fakeBtn.focus).toHaveBeenCalledTimes(1);
    });
  });
});

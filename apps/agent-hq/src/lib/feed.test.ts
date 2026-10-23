import { describe, it, expect } from 'vitest';
import {
  isTestOutput,
  isGitEvent,
  getFeedBadges,
  filterFeed,
  parseSimpleMarkdown,
  isPromptLine,
  detectPendingInput,
  getFeedMessageText,
  stripAnsi,
  formatFeedTimestamp,
} from './feed';
import type { HQEvent, InternalAction, Run } from './server/state';

describe('feed logic (lib/feed.ts)', () => {
  describe('stripAnsi', () => {
    it('removes ANSI color codes from terminal output', () => {
      const raw = '\x1b[32mPASS\x1b[0m \x1b[1mtest.spec.ts\x1b[0m';
      expect(stripAnsi(raw)).toBe('PASS test.spec.ts');
    });

    it('leaves plain text untouched', () => {
      expect(stripAnsi('Hello world')).toBe('Hello world');
    });
  });

  describe('isTestOutput', () => {
    it('identifies test commands', () => {
      expect(isTestOutput('> vitest run')).toBe(true);
      expect(isTestOutput('nx test agent-hq')).toBe(true);
      expect(isTestOutput('$ pytest -v')).toBe(true);
      expect(isTestOutput('npx jest')).toBe(true);
    });

    it('identifies test results', () => {
      expect(isTestOutput('PASS libs/auth/src/login.spec.ts')).toBe(true);
      expect(isTestOutput('FAIL apps/agent-hq/src/lib/live.test.ts')).toBe(
        true,
      );
      expect(isTestOutput('RUNS apps/agent-hq/src/lib/live.test.ts')).toBe(
        true,
      );
      expect(isTestOutput('✓ should connect to SSE')).toBe(true);
      expect(isTestOutput('✗ should fail gracefully')).toBe(true);
      expect(isTestOutput('Test Files 3 passed (3)')).toBe(true);
      expect(isTestOutput('Tests: 12 passed, 12 total')).toBe(true);
      expect(isTestOutput('=== 5 passed in 0.23s ===')).toBe(true);
    });

    it('rejects regular logs', () => {
      expect(isTestOutput('Compiling source files...')).toBe(false);
      expect(isTestOutput('Running git status')).toBe(false);
      expect(isTestOutput('')).toBe(false);
    });
  });

  describe('isGitEvent', () => {
    it('returns true for Git and PR events', () => {
      expect(isGitEvent('DRAFT_PR_CREATED')).toBe(true);
      expect(isGitEvent('REVIEW_START')).toBe(true);
      expect(isGitEvent('PR_READY')).toBe(true);
      expect(isGitEvent('CI_CHECK_PASS')).toBe(true);
      expect(isGitEvent('CI_CHECK_FAIL')).toBe(true);
      expect(isGitEvent('MERGED')).toBe(true);
      expect(isGitEvent('PR_CLOSED')).toBe(true);
    });

    it('returns false for other events', () => {
      expect(isGitEvent('TASK_START')).toBe(false);
      expect(isGitEvent('TASK_PROGRESS')).toBe(false);
      expect(isGitEvent('TASK_COMPLETE')).toBe(false);
      expect(isGitEvent('RATE_LIMITED')).toBe(false);
    });
  });

  describe('getFeedBadges', () => {
    it('assigns agent badges', () => {
      const claudeEvent: HQEvent = {
        event: 'TASK_START',
        agent: 'claude',
        room: 'ceo',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: {},
      };
      expect(getFeedBadges(claudeEvent)).toEqual(['CLAUDE']);

      const agyEvent: HQEvent = {
        event: 'TASK_START',
        agent: 'agy',
        room: 'dev',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: {},
      };
      expect(getFeedBadges(agyEvent)).toEqual(['AGY']);

      const codexEvent: HQEvent = {
        event: 'TASK_START',
        agent: 'codex',
        room: 'dev',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: {},
      };
      expect(getFeedBadges(codexEvent)).toEqual(['CODEX']);
    });

    it('assigns [TEST] badge for TASK_PROGRESS with test output', () => {
      const event: HQEvent = {
        event: 'TASK_PROGRESS',
        agent: 'agy',
        room: 'dev',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: { logChunk: '> vitest run\n' },
      };
      expect(getFeedBadges(event)).toEqual(['AGY', 'TEST']);
    });

    it('assigns [TEST] badge for TEST_STARTED and TEST_FINISHED InternalActions', () => {
      const startAction: InternalAction = {
        type: 'TEST_STARTED',
        agent: 'codex',
      };
      expect(getFeedBadges(startAction)).toEqual(['CODEX', 'TEST']);

      const finishAction: InternalAction = {
        type: 'TEST_FINISHED',
        agent: 'agy',
      };
      expect(getFeedBadges(finishAction)).toEqual(['AGY', 'TEST']);
    });

    it('assigns [GIT] badge for Git lifecycle events', () => {
      const prCreated: HQEvent = {
        event: 'DRAFT_PR_CREATED',
        agent: 'agy',
        room: 'qa',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: { prNumber: 15 },
      };
      expect(getFeedBadges(prCreated)).toEqual(['AGY', 'GIT']);

      const reviewStart: HQEvent = {
        event: 'REVIEW_START',
        agent: 'claude',
        room: 'qa',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: { prNumber: 15 },
      };
      expect(getFeedBadges(reviewStart)).toEqual(['CLAUDE', 'GIT']);

      const ciCheckPass: HQEvent = {
        event: 'CI_CHECK_PASS',
        agent: 'claude',
        room: 'qa',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: {},
      };
      expect(getFeedBadges(ciCheckPass)).toEqual(['CLAUDE', 'GIT']);

      const merged: HQEvent = {
        event: 'MERGED',
        agent: 'claude',
        room: 'ceo',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: { prNumber: 15 },
      };
      expect(getFeedBadges(merged)).toEqual(['CLAUDE', 'GIT']);
    });
  });

  describe('filterFeed', () => {
    const feed: (HQEvent | InternalAction)[] = [
      {
        event: 'TASK_START',
        agent: 'claude',
        room: 'ceo',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: { title: 'Claude plan' },
      },
      {
        event: 'TASK_PROGRESS',
        agent: 'agy',
        room: 'dev',
        timestamp: '2026-10-22T20:01:00.000Z',
        data: { logChunk: '> vitest run\n' },
      },
      {
        event: 'DRAFT_PR_CREATED',
        agent: 'codex',
        room: 'qa',
        timestamp: '2026-10-22T20:02:00.000Z',
        data: { prNumber: 22 },
      },
    ];

    it('returns all items when filter is ALL', () => {
      expect(filterFeed(feed, 'ALL')).toHaveLength(3);
    });

    it('filters by CLAUDE', () => {
      const res = filterFeed(feed, 'CLAUDE');
      expect(res).toHaveLength(1);
      expect((res[0] as HQEvent).agent).toBe('claude');
    });

    it('filters by AGY', () => {
      const res = filterFeed(feed, 'AGY');
      expect(res).toHaveLength(1);
      expect((res[0] as HQEvent).agent).toBe('agy');
    });

    it('filters by CODEX', () => {
      const res = filterFeed(feed, 'CODEX');
      expect(res).toHaveLength(1);
      expect((res[0] as HQEvent).agent).toBe('codex');
    });

    it('filters by TEST', () => {
      const res = filterFeed(feed, 'TEST');
      expect(res).toHaveLength(1);
      expect((res[0] as HQEvent).agent).toBe('agy');
    });

    it('filters by GIT', () => {
      const res = filterFeed(feed, 'GIT');
      expect(res).toHaveLength(1);
      expect((res[0] as HQEvent).agent).toBe('codex');
    });
  });

  describe('parseSimpleMarkdown', () => {
    it('returns empty array for empty string', () => {
      expect(parseSimpleMarkdown('')).toEqual([]);
    });

    it('parses plain text', () => {
      expect(parseSimpleMarkdown('Hello world')).toEqual([
        { type: 'text', content: 'Hello world' },
      ]);
    });

    it('parses inline code', () => {
      expect(parseSimpleMarkdown('Run `vitest run` now')).toEqual([
        { type: 'text', content: 'Run ' },
        { type: 'code', content: 'vitest run' },
        { type: 'text', content: ' now' },
      ]);
    });

    it('parses bold text', () => {
      expect(parseSimpleMarkdown('Ticket **#14** done')).toEqual([
        { type: 'text', content: 'Ticket ' },
        { type: 'bold', content: '#14' },
        { type: 'text', content: ' done' },
      ]);
    });

    it('handles mixed formatting and preserves HTML as plain text', () => {
      const input = '`<code>` and **<bold>** with <script>alert(1)</script>';
      const result = parseSimpleMarkdown(input);
      expect(result).toEqual([
        { type: 'code', content: '<code>' },
        { type: 'text', content: ' and ' },
        { type: 'bold', content: '<bold>' },
        { type: 'text', content: ' with <script>alert(1)</script>' },
      ]);
    });

    it('treats unclosed tags as plain text', () => {
      expect(parseSimpleMarkdown('Unclosed `backtick')).toEqual([
        { type: 'text', content: 'Unclosed `backtick' },
      ]);
      expect(parseSimpleMarkdown('Unclosed **bold')).toEqual([
        { type: 'text', content: 'Unclosed **bold' },
      ]);
    });
  });

  describe('isPromptLine', () => {
    it('detects lines ending with ?', () => {
      expect(isPromptLine('Soll ich fortfahren?')).toBe(true);
      expect(isPromptLine('Overwrite existing file?  \n')).toBe(true);
      expect(isPromptLine('Are you sure?')).toBe(true);
    });

    it('detects [y/n] and (y/n) prompts with case-insensitivity', () => {
      expect(isPromptLine('Soll ich fortfahren? [y/n]')).toBe(true);
      expect(isPromptLine('Continue? (Y/N)')).toBe(true);
      expect(isPromptLine('Delete file [y/N]?')).toBe(true);
      expect(isPromptLine('Please confirm (y/n):')).toBe(true);
    });

    it('strips ANSI codes before matching prompt', () => {
      expect(isPromptLine('\x1b[33mSoll ich fortfahren? [y/n]\x1b[0m')).toBe(
        true,
      );
    });

    it('returns false for normal output lines', () => {
      expect(isTestOutput('Starting compilation...')).toBe(false);
      expect(isPromptLine('vitest run')).toBe(false);
      expect(isPromptLine('')).toBe(false);
      expect(isPromptLine('   ')).toBe(false);
    });
  });

  describe('detectPendingInput', () => {
    const baseRun: Run = {
      runId: 'v-14',
      agent: 'agy',
      status: 'running',
      timestamp: '2026-10-22T20:00:00.000Z',
      data: {},
    };

    it('returns isPending=false if there are no running runs', () => {
      const runs = { 'v-14': { ...baseRun, status: 'complete' as const } };
      const feed: HQEvent[] = [
        {
          event: 'TASK_PROGRESS',
          agent: 'agy',
          runId: 'v-14',
          room: 'dev',
          timestamp: '2026-10-22T20:00:00.000Z',
          data: { logChunk: 'Soll ich fortfahren? [y/n]\n' },
        },
      ];
      expect(detectPendingInput(feed, runs, Date.now())).toEqual({
        isPending: false,
      });
    });

    it('returns isPending=false and remainingMs > 0 when prompt appeared < 10s ago', () => {
      const now = Date.parse('2026-10-22T20:00:05.000Z');
      const runs = { 'v-14': baseRun };
      const feed: HQEvent[] = [
        {
          event: 'TASK_PROGRESS',
          agent: 'agy',
          runId: 'v-14',
          room: 'dev',
          timestamp: '2026-10-22T20:00:00.000Z',
          data: { logChunk: 'Soll ich fortfahren? [y/n]\n' },
        },
      ];
      const result = detectPendingInput(feed, runs, now);
      expect(result.isPending).toBe(false);
      expect(result.remainingMs).toBe(5000);
      expect(result.promptText).toBe('Soll ich fortfahren? [y/n]');
      expect(result.runId).toBe('v-14');
    });

    it('returns isPending=true when prompt appeared >= 10s ago without further output', () => {
      const now = Date.parse('2026-10-22T20:00:12.000Z');
      const runs = { 'v-14': baseRun };
      const feed: HQEvent[] = [
        {
          event: 'TASK_PROGRESS',
          agent: 'agy',
          runId: 'v-14',
          room: 'dev',
          timestamp: '2026-10-22T20:00:00.000Z',
          data: { logChunk: 'Soll ich fortfahren? [y/n]\n' },
        },
      ];
      const result = detectPendingInput(feed, runs, now);
      expect(result.isPending).toBe(true);
      expect(result.remainingMs).toBe(0);
      expect(result.runId).toBe('v-14');
      expect(result.agent).toBe('agy');
    });

    it('returns isPending=false if a non-prompt output followed after the prompt', () => {
      const now = Date.parse('2026-10-22T20:00:15.000Z');
      const runs = { 'v-14': baseRun };
      const feed: HQEvent[] = [
        {
          event: 'TASK_PROGRESS',
          agent: 'agy',
          runId: 'v-14',
          room: 'dev',
          timestamp: '2026-10-22T20:00:00.000Z',
          data: { logChunk: 'Soll ich fortfahren? [y/n]\n' },
        },
        {
          event: 'TASK_PROGRESS',
          agent: 'agy',
          runId: 'v-14',
          room: 'dev',
          timestamp: '2026-10-22T20:00:02.000Z',
          data: { logChunk: 'Continuing execution...\n' },
        },
      ];
      const result = detectPendingInput(feed, runs, now);
      expect(result.isPending).toBe(false);
    });
  });

  describe('getFeedMessageText', () => {
    it('formats various event types', () => {
      expect(
        getFeedMessageText({
          event: 'TASK_START',
          agent: 'agy',
          room: 'dev',
          timestamp: '2026-10-22T20:00:00.000Z',
          data: { title: 'Implement feature #14' },
        }),
      ).toBe('Implement feature #14');

      expect(
        getFeedMessageText({
          event: 'TASK_COMPLETE',
          agent: 'agy',
          room: 'dev',
          timestamp: '2026-10-22T20:00:00.000Z',
          data: { exitCode: 0 },
        }),
      ).toBe('Task abgeschlossen (Exit 0)');

      expect(
        getFeedMessageText({
          event: 'DRAFT_PR_CREATED',
          agent: 'agy',
          room: 'qa',
          timestamp: '2026-10-22T20:00:00.000Z',
          data: { prNumber: 42 },
        }),
      ).toBe('Draft PR #42 erstellt');

      expect(
        getFeedMessageText({
          event: 'PR_CLOSED',
          agent: 'claude',
          room: 'lounge',
          timestamp: '2026-10-22T20:00:00.000Z',
          data: { prNumber: 74 },
        }),
      ).toBe('PR #74 geschlossen');

      expect(
        getFeedMessageText({
          event: 'PR_CLOSED',
          agent: 'claude',
          room: 'lounge',
          timestamp: '2026-10-22T20:00:00.000Z',
          data: {},
        }),
      ).toBe('PR geschlossen');

      expect(
        getFeedMessageText({
          type: 'TEST_STARTED',
          agent: 'agy',
        }),
      ).toBe('Testlauf gestartet');
    });
  });

  describe('formatFeedTimestamp', () => {
    it('formats ISO string to time', () => {
      expect(formatFeedTimestamp('')).toBe('');
      const formatted = formatFeedTimestamp('2026-10-22T20:15:30.000Z');
      expect(formatted).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });
  });
});

import { describe, it, expect, vi } from 'vitest';
import type { QuestionPayload, Team } from '@agent-hq/queue';
import type { Character } from './sprites';
import type { HQEvent, Run } from '../server/state';
import {
  getOldestPendingQuestionForTeam,
  getGitHubIssueUrl,
  resolveCharacterClickTarget,
  sendQuestionAnswer,
} from './question-modal';

function createQuestion(
  id: string,
  issueId: number,
  team: Team,
  status: 'PENDING' | 'ANSWERED' = 'PENDING',
  question = 'Test question?',
  options?: string[],
): QuestionPayload {
  return {
    id,
    issueId,
    team,
    status,
    question,
    ...(options ? { options } : {}),
  };
}

function createPendingEvent(
  questionId: string,
  issueId: number,
  team: Team,
  timestamp = '2026-10-24T10:00:00.000Z',
): HQEvent {
  return {
    event: 'QUESTION_PENDING',
    timestamp,
    room: 'dev',
    data: {
      questionId,
      issueId,
      team,
      question: 'Test question',
    },
  };
}

describe('office/question-modal', () => {
  describe('getOldestPendingQuestionForTeam', () => {
    it('returns undefined when questions record is undefined or empty', () => {
      expect(
        getOldestPendingQuestionForTeam(undefined, 'frontend'),
      ).toBeUndefined();
      expect(getOldestPendingQuestionForTeam({}, 'frontend')).toBeUndefined();
    });

    it('returns undefined when no pending questions exist for the team', () => {
      const questions: Record<string, QuestionPayload> = {
        '101-1': createQuestion('101-1', 101, 'frontend', 'ANSWERED'),
        '102-1': createQuestion('102-1', 102, 'backend', 'PENDING'),
      };
      expect(
        getOldestPendingQuestionForTeam(questions, 'frontend'),
      ).toBeUndefined();
    });

    it('returns the single pending question for the team', () => {
      const q = createQuestion('101-1', 101, 'frontend', 'PENDING');
      const questions: Record<string, QuestionPayload> = {
        '101-1': q,
        '102-1': createQuestion('102-1', 102, 'backend', 'PENDING'),
      };
      expect(getOldestPendingQuestionForTeam(questions, 'frontend')).toEqual(q);
    });

    it('selects the oldest question based on chronological feed order', () => {
      const q1 = createQuestion('101-1', 101, 'frontend', 'PENDING');
      const q2 = createQuestion('105-1', 105, 'frontend', 'PENDING');
      const questions: Record<string, QuestionPayload> = {
        '105-1': q2,
        '101-1': q1,
      };

      const feed: HQEvent[] = [
        createPendingEvent(
          '101-1',
          101,
          'frontend',
          '2026-10-24T10:00:00.000Z',
        ),
        createPendingEvent(
          '105-1',
          105,
          'frontend',
          '2026-10-24T10:05:00.000Z',
        ),
      ];

      expect(
        getOldestPendingQuestionForTeam(questions, 'frontend', feed),
      ).toEqual(q1);
    });

    it('falls back to numeric question id order when feed is not provided', () => {
      const q1 = createQuestion('101-1', 101, 'frontend', 'PENDING');
      const q2 = createQuestion('101-2', 101, 'frontend', 'PENDING');
      const questions: Record<string, QuestionPayload> = {
        '101-2': q2,
        '101-1': q1,
      };

      expect(getOldestPendingQuestionForTeam(questions, 'frontend')).toEqual(
        q1,
      );
    });
  });

  describe('getGitHubIssueUrl', () => {
    it('generates standard GitHub issue URL with default repo tihofman/agent-hq', () => {
      expect(getGitHubIssueUrl(103)).toBe(
        'https://github.com/tihofman/agent-hq/issues/103',
      );
    });

    it('uses custom repository when provided with owner/name', () => {
      expect(getGitHubIssueUrl(42, 'acme/my-repo')).toBe(
        'https://github.com/acme/my-repo/issues/42',
      );
    });

    it('falls back to default repo if repo string lacks an owner slash', () => {
      expect(getGitHubIssueUrl(103, 'agent-hq')).toBe(
        'https://github.com/tihofman/agent-hq/issues/103',
      );
    });
  });

  describe('resolveCharacterClickTarget', () => {
    const regularChar: Character = {
      id: 'agy-run-1',
      agent: 'agy',
      runId: 'run-1',
      instanceIndex: 0,
    };

    const teamLeadChar: Character = {
      id: 'team-lead-frontend',
      agent: 'agy',
      team: 'frontend',
      isTeamLead: true,
      instanceIndex: 0,
    };

    it('routes regular characters to log modal with runId', () => {
      const target = resolveCharacterClickTarget(regularChar);
      expect(target).toEqual({
        type: 'log',
        agent: 'agy',
        runId: 'run-1',
      });
    });

    it('routes TeamLead without open questions to log modal (#79)', () => {
      const runs: Record<string, Run> = {
        'run-old': {
          runId: 'run-old',
          agent: 'agy',
          status: 'complete',
          timestamp: '2026-10-24T09:00:00Z',
          data: { team: 'frontend' },
        },
        'run-new': {
          runId: 'run-new',
          agent: 'agy',
          status: 'running',
          timestamp: '2026-10-24T10:00:00Z',
          data: { team: 'frontend' },
        },
      };

      const target = resolveCharacterClickTarget(teamLeadChar, {}, runs);
      expect(target).toEqual({
        type: 'log',
        agent: 'agy',
        runId: 'run-new',
      });
    });

    it('routes TeamLead with open question to question modal', () => {
      const q = createQuestion('103-1', 103, 'frontend', 'PENDING');
      const questions: Record<string, QuestionPayload> = {
        '103-1': q,
      };

      const target = resolveCharacterClickTarget(teamLeadChar, questions);
      expect(target).toEqual({
        type: 'question',
        question: q,
      });
    });

    it('routes TeamLead to log modal if all questions are ANSWERED', () => {
      const q = createQuestion('103-1', 103, 'frontend', 'ANSWERED');
      const questions: Record<string, QuestionPayload> = {
        '103-1': q,
      };

      const target = resolveCharacterClickTarget(teamLeadChar, questions);
      expect(target).toEqual({
        type: 'log',
        agent: 'agy',
        runId: undefined,
      });
    });
  });

  describe('sendQuestionAnswer', () => {
    it('returns error if answer is empty or whitespace-only', async () => {
      const mockFetch = vi.fn();
      const res = await sendQuestionAnswer(
        '103-1',
        '   ',
        mockFetch as unknown as typeof fetch,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Antwort darf nicht leer sein');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('posts answer to /api/questions/:id/answer and returns ok on 200', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      });

      const res = await sendQuestionAnswer(
        '103-1',
        'Use Tailwind',
        mockFetch as unknown as typeof fetch,
      );
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);

      expect(mockFetch).toHaveBeenCalledWith('/api/questions/103-1/answer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ answer: 'Use Tailwind' }),
      });
    });

    it('handles 404 QuestionNotFoundError', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Question not found' }),
      });

      const res = await sendQuestionAnswer(
        '999-1',
        'Test',
        mockFetch as unknown as typeof fetch,
      );
      expect(res.ok).toBe(false);
      expect(res.status).toBe(404);
      expect(res.error).toBe('Question not found');
    });

    it('handles 409 QuestionConflictError (already answered)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: 'Question 103-1 already answered' }),
      });

      const res = await sendQuestionAnswer(
        '103-1',
        'Test',
        mockFetch as unknown as typeof fetch,
      );
      expect(res.ok).toBe(false);
      expect(res.status).toBe(409);
      expect(res.error).toBe('Question 103-1 already answered');
    });

    it('handles network error when fetch rejects', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));

      const res = await sendQuestionAnswer(
        '103-1',
        'Test',
        mockFetch as unknown as typeof fetch,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Netzwerkfehler beim Absenden der Antwort');
    });
  });
});

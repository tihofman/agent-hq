import type { QuestionPayload, Team } from '@agent-hq/queue';
import type { Agent, HQEvent, InternalAction, Run } from '../server/state';
import type { Character } from './sprites';

export interface QuestionAnswerResult {
  ok: boolean;
  error?: string;
  status?: number;
}

export type CharacterClickTarget =
  | { type: 'question'; question: QuestionPayload }
  | { type: 'log'; agent: Agent; runId?: string };

/**
 * Returns the oldest open (PENDING) question for the given team.
 * Compares creation timestamp if available, then feed order, then question id.
 */
export function getOldestPendingQuestionForTeam(
  questions: Record<string, QuestionPayload> | undefined,
  team: Team,
  feed?: readonly (HQEvent | InternalAction)[],
): QuestionPayload | undefined {
  if (!questions) return undefined;

  const pending = Object.values(questions).filter(
    (q) => q.team === team && q.status === 'PENDING',
  );

  if (pending.length === 0) return undefined;
  if (pending.length === 1) return pending[0];

  return pending.sort((a, b) => {
    if (feed && feed.length > 0) {
      const indexA = feed.findIndex(
        (e) => 'data' in e && e.data?.questionId === a.id,
      );
      const indexB = feed.findIndex(
        (e) => 'data' in e && e.data?.questionId === b.id,
      );
      if (indexA !== -1 && indexB !== -1 && indexA !== indexB) {
        return indexA - indexB;
      }
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
    }

    // Fallback: parse numeric suffixes like "101-1" vs "101-2"
    const matchA = a.id.match(/^(\d+)-(\d+)$/);
    const matchB = b.id.match(/^(\d+)-(\d+)$/);
    if (matchA && matchB && matchA[1] === matchB[1]) {
      return Number(matchA[2]) - Number(matchB[2]);
    }

    return a.id.localeCompare(b.id);
  })[0];
}

export const GITHUB_REPO = 'tihofman/agent-hq';

/**
 * Derives GitHub issue URL for the fixed repository tihofman/agent-hq.
 * Ignores any custom repo and returns undefined if issueId is not a positive integer.
 */
export function getGitHubIssueUrl(
  issueId: number,
  _repo?: string,
): string | undefined {
  void _repo;
  if (
    typeof issueId !== 'number' ||
    !Number.isSafeInteger(issueId) ||
    issueId <= 0
  ) {
    return undefined;
  }
  return `https://github.com/${GITHUB_REPO}/issues/${issueId}`;
}

/**
 * Determines whether clicking a character opens the QuestionModal or CharacterLogModal.
 */
export function resolveCharacterClickTarget(
  char: Character,
  questions?: Record<string, QuestionPayload>,
  runs?: Record<string, Run>,
  feed?: readonly (HQEvent | InternalAction)[],
): CharacterClickTarget {
  if (char.isTeamLead && char.team) {
    const question = getOldestPendingQuestionForTeam(
      questions,
      char.team,
      feed,
    );
    if (question) {
      return {
        type: 'question',
        question,
      };
    }
  }

  let targetRunId = char.runId;
  if (!targetRunId && char.team) {
    const teamRuns = Object.values(runs ?? {})
      .filter((r) => r.data?.team === char.team)
      .sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''));
    targetRunId = teamRuns[0]?.runId;
  }

  return {
    type: 'log',
    agent: char.agent,
    runId: targetRunId,
  };
}

/**
 * Sends an answer to POST /api/questions/:id/answer with proper error handling.
 */
export async function sendQuestionAnswer(
  questionId: string,
  answer: string,
  fetchFn: typeof fetch = fetch,
): Promise<QuestionAnswerResult> {
  const trimmed = answer.trim();
  if (!trimmed) {
    return { ok: false, error: 'Antwort darf nicht leer sein' };
  }

  try {
    const res = await fetchFn(
      `/api/questions/${encodeURIComponent(questionId)}/answer`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ answer: trimmed }),
      },
    );

    if (res.ok) {
      return { ok: true, status: res.status };
    }

    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const errorMsg =
      body.error ||
      (res.status === 404
        ? 'Frage nicht gefunden (404)'
        : res.status === 409
          ? 'Frage bereits beantwortet (409)'
          : res.status === 403
            ? 'Zugriff verweigert (403)'
            : `Fehler beim Absenden (${res.status})`);

    return {
      ok: false,
      error: errorMsg,
      status: res.status,
    };
  } catch {
    return {
      ok: false,
      error: 'Netzwerkfehler beim Absenden der Antwort',
    };
  }
}

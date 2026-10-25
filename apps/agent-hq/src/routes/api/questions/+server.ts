import { json, type RequestHandler } from '@sveltejs/kit';
import { isOriginAllowed } from '../../../lib/server/origin';
import {
  askQuestion,
  getOpenQuestions,
  MAX_OPTION_LENGTH,
  MAX_OPTIONS_COUNT,
  MAX_QUESTION_LENGTH,
  QuestionConflictError,
  QuestionNotFoundError,
} from '../../../lib/server/questions';
import { isValidRepoName } from '../../../lib/server/repos';
import type { QuestionPayload, Team } from '@agent-hq/queue/types';

const VALID_TEAMS: readonly string[] = ['frontend', 'backend', 'qa'];

export const GET: RequestHandler = async ({ request, url }) => {
  if (!isOriginAllowed(request, url)) {
    return json({ error: 'Forbidden origin' }, { status: 403 });
  }

  const questions = await getOpenQuestions();
  return json(questions satisfies QuestionPayload[]);
};

export const POST: RequestHandler = async ({ request, url }) => {
  if (!isOriginAllowed(request, url)) {
    return json({ error: 'Forbidden origin' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid JSON';
    return json({ error: message }, { status: 400 });
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Request body must be an object' }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const issueId = record.issueId;
  const team = record.team;
  const question = record.question;
  const options = record.options;
  const repo = record.repo;
  const jobId = record.jobId;

  // Both optional: calls without repo belong to the home repo.
  if (repo !== undefined && !isValidRepoName(repo)) {
    return json({ error: 'repo must be owner/name' }, { status: 400 });
  }
  if (
    jobId !== undefined &&
    (typeof jobId !== 'string' || !jobId.trim() || jobId.length > 300)
  ) {
    return json({ error: 'jobId must be a non-empty string' }, { status: 400 });
  }

  if (
    typeof issueId !== 'number' ||
    !Number.isSafeInteger(issueId) ||
    issueId <= 0
  ) {
    return json(
      { error: 'issueId must be a positive integer' },
      { status: 400 },
    );
  }

  if (typeof team !== 'string' || !VALID_TEAMS.includes(team)) {
    return json(
      { error: 'team must be frontend, backend or qa' },
      { status: 400 },
    );
  }

  if (
    typeof question !== 'string' ||
    !question.trim() ||
    question.trim().length > MAX_QUESTION_LENGTH
  ) {
    return json(
      {
        error: `question must be a non-empty string up to ${MAX_QUESTION_LENGTH} characters`,
      },
      { status: 400 },
    );
  }

  if (options !== undefined) {
    if (
      !Array.isArray(options) ||
      options.length > MAX_OPTIONS_COUNT ||
      options.some(
        (o) =>
          typeof o !== 'string' ||
          !o.trim() ||
          o.trim().length > MAX_OPTION_LENGTH,
      )
    ) {
      return json(
        {
          error: `options must be an array of at most ${MAX_OPTIONS_COUNT} non-empty strings up to ${MAX_OPTION_LENGTH} characters each`,
        },
        { status: 400 },
      );
    }
  }

  try {
    const result = await askQuestion({
      issueId,
      team: team as Team,
      question: question.trim(),
      options: options as string[] | undefined,
      repo,
      jobId,
    });
    return json(
      { ok: true, question: result satisfies QuestionPayload },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof QuestionConflictError) {
      return json({ error: err.message }, { status: 409 });
    }
    if (err instanceof QuestionNotFoundError) {
      return json({ error: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    return json({ error: message }, { status: 500 });
  }
};

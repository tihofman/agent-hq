import { json, type RequestHandler } from '@sveltejs/kit';
import { isOriginAllowed } from '../../../lib/server/origin';
import {
  askQuestion,
  getOpenQuestions,
  QuestionConflictError,
  QuestionNotFoundError,
} from '../../../lib/server/questions';
import type { Team } from '@agent-hq/queue';

const VALID_TEAMS: readonly string[] = ['frontend', 'backend', 'qa'];

export const GET: RequestHandler = async ({ request, url }) => {
  if (!isOriginAllowed(request, url)) {
    return json({ error: 'Forbidden origin' }, { status: 403 });
  }

  const questions = await getOpenQuestions();
  return json(questions);
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

  if (typeof question !== 'string' || !question.trim()) {
    return json(
      { error: 'question must be a non-empty string' },
      { status: 400 },
    );
  }

  if (options !== undefined) {
    if (
      !Array.isArray(options) ||
      options.some((o) => typeof o !== 'string' || !o.trim())
    ) {
      return json(
        { error: 'options must be an array of non-empty strings' },
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
    });
    return json({ ok: true, question: result }, { status: 201 });
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

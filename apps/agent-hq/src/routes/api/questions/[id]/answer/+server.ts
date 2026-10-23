import { json, type RequestHandler } from '@sveltejs/kit';
import { isOriginAllowed } from '../../../../../lib/server/origin';
import {
  answerQuestion,
  QuestionConflictError,
  QuestionNotFoundError,
} from '../../../../../lib/server/questions';

export const POST: RequestHandler = async ({ request, url, params }) => {
  if (!isOriginAllowed(request, url)) {
    return json({ error: 'Forbidden origin' }, { status: 403 });
  }

  const questionId = params.id;
  if (!questionId) {
    return json({ error: 'Question not found' }, { status: 404 });
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
  const answer = record.answer;

  if (typeof answer !== 'string' || !answer.trim()) {
    return json(
      { error: 'answer must be a non-empty string' },
      { status: 400 },
    );
  }

  try {
    await answerQuestion(questionId, answer.trim());
    return json({ ok: true });
  } catch (err) {
    if (err instanceof QuestionNotFoundError) {
      return json({ error: err.message }, { status: 404 });
    }
    if (err instanceof QuestionConflictError) {
      return json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    return json({ error: message }, { status: 500 });
  }
};

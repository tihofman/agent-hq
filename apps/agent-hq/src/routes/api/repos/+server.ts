import { json, type RequestHandler } from '@sveltejs/kit';
import { isOriginAllowed } from '../../../lib/server/origin';
import {
  loadRepos,
  registerRepo,
  RepoValidationError,
} from '../../../lib/server/repos';

export const GET: RequestHandler = async ({ request, url }) => {
  if (!isOriginAllowed(request, url)) {
    return json({ error: 'Forbidden origin' }, { status: 403 });
  }
  try {
    return json(loadRepos());
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return json({ error: message }, { status: 500 });
  }
};

// Registering grants workers wide rights in that repo: explicit user action only (ADR 0007).
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

  const { repo, path, enabled } = body as Record<string, unknown>;
  try {
    const entry = await registerRepo({ repo, path, enabled });
    return json(entry, { status: 201 });
  } catch (err) {
    if (err instanceof RepoValidationError) {
      return json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    return json({ error: message }, { status: 500 });
  }
};

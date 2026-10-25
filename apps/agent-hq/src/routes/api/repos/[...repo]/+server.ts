import { json, type RequestHandler } from '@sveltejs/kit';
import { isOriginAllowed } from '../../../../lib/server/origin';
import {
  isValidRepoName,
  removeRepo,
  setRepoEnabled,
} from '../../../../lib/server/repos';

// Rest parameter: `owner/name` contains a slash.
export const DELETE: RequestHandler = async ({ request, url, params }) => {
  if (!isOriginAllowed(request, url)) {
    return json({ error: 'Forbidden origin' }, { status: 403 });
  }
  const repo = params.repo;
  if (!isValidRepoName(repo)) {
    return json({ error: 'repo must be owner/name' }, { status: 400 });
  }
  try {
    if (!(await removeRepo(repo))) {
      return json({ error: `Repo ${repo} is not registered` }, { status: 404 });
    }
    return json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return json({ error: message }, { status: 500 });
  }
};

export const PATCH: RequestHandler = async ({ request, url, params }) => {
  if (!isOriginAllowed(request, url)) {
    return json({ error: 'Forbidden origin' }, { status: 403 });
  }
  const repo = params.repo;
  if (!isValidRepoName(repo)) {
    return json({ error: 'repo must be owner/name' }, { status: 400 });
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

  const { enabled } = body as Record<string, unknown>;
  if (typeof enabled !== 'boolean') {
    return json({ error: 'enabled must be a boolean' }, { status: 400 });
  }

  try {
    const updated = await setRepoEnabled(repo, enabled);
    if (!updated) {
      return json({ error: `Repo ${repo} is not registered` }, { status: 404 });
    }
    return json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return json({ error: message }, { status: 500 });
  }
};

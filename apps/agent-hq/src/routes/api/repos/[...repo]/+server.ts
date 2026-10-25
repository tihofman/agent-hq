import { json, type RequestHandler } from '@sveltejs/kit';
import { isOriginAllowed } from '../../../../lib/server/origin';
import { isValidRepoName, removeRepo } from '../../../../lib/server/repos';

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

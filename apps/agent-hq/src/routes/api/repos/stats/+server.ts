import { json, type RequestHandler } from '@sveltejs/kit';
import type { RepoStatsResponse } from '@agent-hq/queue/types';
import { isOriginAllowed } from '../../../../lib/server/origin';
import { getRepoStats } from '../../../../lib/server/repo-stats';

export const GET: RequestHandler = async ({ request, url }) => {
  if (!isOriginAllowed(request, url)) {
    return json({ error: 'Forbidden origin' }, { status: 403 });
  }
  try {
    return json((await getRepoStats()) satisfies RepoStatsResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return json({ error: message }, { status: 500 });
  }
};

import { json, type RequestHandler } from '@sveltejs/kit';
import { resolveRepo } from '../../../lib/server/git';
import { recordEvent } from '../../../lib/server/history';
import { parseEvent } from '../../../lib/server/state';

import { isOriginAllowed } from '../../../lib/server/origin';

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

  let event;
  try {
    event = parseEvent(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid event';
    return json({ error: message }, { status: 400 });
  }

  if (event.cwd && (!event.data.repo || !event.data.branch)) {
    const gitInfo = await resolveRepo(event.cwd);
    if (gitInfo) {
      if (!event.data.repo) event.data.repo = gitInfo.repo;
      if (!event.data.branch) event.data.branch = gitInfo.branch;
    }
  }

  void recordEvent(event);

  return json({ ok: true }, { status: 202 });
};

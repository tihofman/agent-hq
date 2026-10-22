import { json, type RequestHandler } from '@sveltejs/kit';
import { parseEvent } from '../../../lib/server/state';
import { dispatch } from '../../../lib/server/store';

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

  dispatch(event);

  return json({ ok: true }, { status: 202 });
};

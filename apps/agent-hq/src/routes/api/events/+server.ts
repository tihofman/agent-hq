import { json, type RequestHandler } from '@sveltejs/kit';
import { appendHistory } from '../../../lib/server/history';
import { parseEvent } from '../../../lib/server/state';
import { dispatch } from '../../../lib/server/store';

function isOriginAllowed(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const isAllowedHost =
      originUrl.hostname === '127.0.0.1' || originUrl.hostname === 'localhost';
    const isSamePort = originUrl.port === url.port;
    return isAllowedHost && isSamePort;
  } catch {
    return false;
  }
}

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
  try {
    await appendHistory(event);
  } catch (err) {
    console.error('Failed to append event to history:', err);
  }

  return json({ ok: true }, { status: 202 });
};

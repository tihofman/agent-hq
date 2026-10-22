import { json, type RequestEvent } from '@sveltejs/kit';
import { parseEvent } from '../../../lib/server/state';
import { dispatch } from '../../../lib/server/store';

function isOriginAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const port = process.env.PORT || '3333';
  return (
    origin === `http://127.0.0.1:${port}` ||
    origin === `http://localhost:${port}`
  );
}

export const POST = async (
  eventOrRequest: RequestEvent | Request,
): Promise<Response> => {
  const request: Request =
    eventOrRequest instanceof Request ? eventOrRequest : eventOrRequest.request;

  if (!isOriginAllowed(request)) {
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

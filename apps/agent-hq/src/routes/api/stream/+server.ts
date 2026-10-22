import type { RequestHandler } from '@sveltejs/kit';
import { createEventStream } from '../../../lib/server/sse';

export const GET: RequestHandler = ({ request }) => {
  return createEventStream(request);
};

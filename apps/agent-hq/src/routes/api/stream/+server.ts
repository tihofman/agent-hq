import type { RequestEvent } from '@sveltejs/kit';
import { createEventStream } from '../../../lib/server/sse';

export const GET = (eventOrRequest?: RequestEvent | Request): Response => {
  const request: Request | undefined =
    eventOrRequest instanceof Request
      ? eventOrRequest
      : eventOrRequest?.request;

  return createEventStream(request);
};

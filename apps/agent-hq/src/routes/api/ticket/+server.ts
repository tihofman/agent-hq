import { json, type RequestHandler } from '@sveltejs/kit';
import { isOriginAllowed } from '../../../lib/server/origin';
import { getState } from '../../../lib/server/store';
import {
  fetchTicket,
  parseCriteria,
  TicketNotFoundError,
} from '../../../lib/server/ticket';

export const GET: RequestHandler = async ({ request, url }) => {
  if (!isOriginAllowed(request, url)) {
    return json({ error: 'Forbidden origin' }, { status: 403 });
  }

  const runId = url.searchParams.get('runId');
  if (!runId) {
    return json({ error: 'Run or ticket not found' }, { status: 404 });
  }

  const state = getState();
  const run = state.runs[runId];
  if (!run || !run.ticketId) {
    return json({ error: 'Run or ticket not found' }, { status: 404 });
  }

  try {
    const cwd = run.cwd || process.cwd();
    const ticket = await fetchTicket(run.ticketId, cwd);
    const criteria = parseCriteria(ticket.body);

    return json({
      number: ticket.number,
      title: ticket.title,
      criteria,
    });
  } catch (err: unknown) {
    if (err instanceof TicketNotFoundError) {
      return json({ error: err.message }, { status: 404 });
    }
    const message =
      err instanceof Error ? err.message : 'GitHub CLI (gh) execution failed';
    return json({ error: message }, { status: 503 });
  }
};

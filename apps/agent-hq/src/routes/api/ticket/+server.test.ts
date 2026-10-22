import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { GET } from './+server';
import { dispatch, resetStore } from '../../../lib/server/store';
import { parseEvent } from '../../../lib/server/state';
import * as ticketModule from '../../../lib/server/ticket';

vi.mock('../../../lib/server/ticket', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../lib/server/ticket')>();
  return {
    ...actual,
    fetchTicket: vi.fn(),
  };
});

function createRequest(path: string, origin?: string): RequestEvent {
  const headers = new Headers();
  if (origin) {
    headers.set('Origin', origin);
  }
  const request = new Request(`http://127.0.0.1:3333${path}`, {
    method: 'GET',
    headers,
  });
  return {
    request,
    url: new URL(request.url),
  } as unknown as RequestEvent;
}

describe('GET /api/ticket', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects forbidden origins with 403', async () => {
    const res = await GET(
      createRequest('/api/ticket?runId=run-1', 'http://evil.com:3333'),
    );
    expect(res.status).toBe(403);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('Forbidden origin');
  });

  it('returns 404 when runId query param is missing', async () => {
    const res = await GET(createRequest('/api/ticket'));
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('Run or ticket not found');
  });

  it('returns 404 when run does not exist in store', async () => {
    const res = await GET(createRequest('/api/ticket?runId=non-existent-run'));
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('Run or ticket not found');
  });

  it('returns 404 when run exists but has no ticketId', async () => {
    dispatch(
      parseEvent({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-without-ticket',
      }),
    );

    const res = await GET(
      createRequest('/api/ticket?runId=run-without-ticket'),
    );
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('Run or ticket not found');
  });

  it('returns 404 when ticket is not found on GitHub', async () => {
    dispatch(
      parseEvent({
        event: 'TASK_HANDOVER',
        agent: 'agy',
        runId: 'run-not-found',
        ticketId: '999999',
        cwd: '/worktree/path',
      }),
    );

    vi.mocked(ticketModule.fetchTicket).mockRejectedValue(
      new ticketModule.TicketNotFoundError('Ticket #999999 not found'),
    );

    const res = await GET(createRequest('/api/ticket?runId=run-not-found'));
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('Ticket #999999 not found');
  });

  it('returns 404 when ticketId is invalid (e.g. URL or flag)', async () => {
    dispatch(
      parseEvent({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-invalid-url',
        ticketId: 'https://github.com/cli/cli/issues/1',
        cwd: '/worktree/path',
      }),
    );

    vi.mocked(ticketModule.fetchTicket).mockRejectedValue(
      new ticketModule.TicketNotFoundError('Invalid ticket ID'),
    );

    const res = await GET(createRequest('/api/ticket?runId=run-invalid-url'));
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('Invalid ticket ID');
  });

  it('returns 503 with understandable message when gh is missing or fails', async () => {
    dispatch(
      parseEvent({
        event: 'TASK_HANDOVER',
        agent: 'agy',
        runId: 'run-gh-missing',
        ticketId: '15',
        cwd: '/worktree/path',
      }),
    );

    vi.mocked(ticketModule.fetchTicket).mockRejectedValue(
      new ticketModule.GitHubCliError(
        'GitHub CLI (gh) is not installed or not in PATH',
      ),
    );

    const res = await GET(createRequest('/api/ticket?runId=run-gh-missing'));
    expect(res.status).toBe(503);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('GitHub CLI (gh) is not installed or not in PATH');
  });

  it('returns 200 with ticket number, title and criteria on success', async () => {
    dispatch(
      parseEvent({
        event: 'TASK_HANDOVER',
        agent: 'agy',
        runId: 'run-success',
        ticketId: '15',
        cwd: '/worktree/path',
      }),
    );

    vi.mocked(ticketModule.fetchTicket).mockResolvedValue({
      number: 15,
      title: 'Ticket- & Akzeptanzkriterien-Tracker mit PR-Status',
      body: `## Akzeptanzkriterien\n- [ ] First criterion\n- [x] Second criterion done`,
    });

    const res = await GET(createRequest('/api/ticket?runId=run-success'));
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      number: number;
      title: string;
      criteria: Array<{ text: string; done: boolean }>;
    };

    expect(data).toEqual({
      number: 15,
      title: 'Ticket- & Akzeptanzkriterien-Tracker mit PR-Status',
      criteria: [
        { text: 'First criterion', done: false },
        { text: 'Second criterion done', done: true },
      ],
    });

    // Verify ticketId and cwd were passed from store-run
    expect(ticketModule.fetchTicket).toHaveBeenCalledWith(
      '15',
      '/worktree/path',
    );
  });

  it('ignores ticketId and cwd from query params and reads only from store', async () => {
    dispatch(
      parseEvent({
        event: 'TASK_HANDOVER',
        agent: 'agy',
        runId: 'secure-run',
        ticketId: '15',
        cwd: '/real/worktree',
      }),
    );

    vi.mocked(ticketModule.fetchTicket).mockResolvedValue({
      number: 15,
      title: 'Real Ticket',
      body: '',
    });

    // Malicious query params trying to override ticketId and cwd
    const res = await GET(
      createRequest(
        '/api/ticket?runId=secure-run&ticketId=999&cwd=%2Fetc%2Fpasswd',
      ),
    );
    expect(res.status).toBe(200);

    expect(ticketModule.fetchTicket).toHaveBeenCalledWith(
      '15',
      '/real/worktree',
    );
    expect(ticketModule.fetchTicket).not.toHaveBeenCalledWith(
      '999',
      expect.anything(),
    );
    expect(ticketModule.fetchTicket).not.toHaveBeenCalledWith(
      expect.anything(),
      '/etc/passwd',
    );
  });
});

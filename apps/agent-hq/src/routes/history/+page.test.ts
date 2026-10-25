import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import HistoryPage from './+page.svelte';
import type { HistoryRunItem } from '../../lib/history-format';

describe('History +page.svelte repo display', () => {
  it('renders repo in table column and expanded details when repo is present', () => {
    const mockRun: HistoryRunItem = {
      runId: 'run-custom-123',
      agent: 'agy',
      ticketId: '149',
      status: 'complete',
      timestamp: '2026-10-25T10:00:00.000Z',
      startedAt: '2026-10-25T09:55:00.000Z',
      durationMs: 300000,
      logExists: true,
      repo: 'acme/webapp',
      data: {
        title: 'Project view',
        team: 'frontend',
        repo: 'acme/webapp',
      },
      events: [],
    };

    const { html } = render(HistoryPage, {
      props: {
        data: {
          initialRuns: [mockRun],
          initialExpandedRunIds: ['run-custom-123'],
        },
      },
    });

    // 1. Table header contains Repo
    expect(html).toContain('Repo</th>');

    // 2. Row data renders repo
    expect(html).toContain('data-testid="run-repo"');
    expect(html).toContain('acme/webapp');

    // 3. Expanded detail has repo
    expect(html).toContain('data-testid="detail-repo"');
  });

  it('renders fallback dash when run has no repo (home repo)', () => {
    const homeRun: HistoryRunItem = {
      runId: 'run-home-456',
      agent: 'claude',
      ticketId: '148',
      status: 'complete',
      timestamp: '2026-10-25T10:00:00.000Z',
      startedAt: '2026-10-25T09:50:00.000Z',
      durationMs: 600000,
      logExists: false,
      data: {
        title: 'Backend multi-repo',
        team: 'backend',
      },
      events: [],
    };

    const { html } = render(HistoryPage, {
      props: {
        data: {
          initialRuns: [homeRun],
        },
      },
    });

    expect(html).toContain('data-testid="run-repo"');
    expect(html).toContain('—');
  });
});

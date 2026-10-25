import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'svelte/server';
import ProjectsView from './ProjectsView.svelte';
import { liveStore, resetLiveStore } from '../../live.svelte';
import { loadProjectOverview, type ProjectRepoItem } from '../../projects';
import type { RepoStats, RepoStatsResponse } from '../../server/repo-stats';

const zero = { waiting: 0, active: 0, delayed: 0, failed: 0 };
const stats = (
  repo: string | null,
  overrides: Partial<RepoStats> = {},
): RepoStats => ({
  repo,
  home: false,
  queues: { frontend: zero, backend: zero, qa: zero },
  draftPRs: [],
  ...overrides,
});

/** Mock fetch that answers `/api/repos` and `/api/repos/stats`. */
function mockFetch(registry: unknown[], statsBody: RepoStatsResponse) {
  return vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => (url === '/api/repos/stats' ? statsBody : registry),
  })) as unknown as typeof fetch;
}

/** Text content of the element carrying `data-testid`. */
function cell(html: string, testId: string): string | undefined {
  const match = new RegExp(`data-testid="${testId}"[^>]*>([^<]*)<`).exec(html);
  return match?.[1].trim();
}

describe('ProjectsView.svelte', () => {
  beforeEach(() => {
    resetLiveStore();
  });

  afterEach(() => {
    resetLiveStore();
  });

  it('shows real queue counts per team and state plus draft PRs from the stats endpoint', async () => {
    const fetchFn = mockFetch(
      [
        {
          repo: 'acme/frontend',
          path: '/workspace/acme/frontend',
          enabled: true,
        },
        {
          repo: 'acme/backend',
          path: '/workspace/acme/backend',
          enabled: false,
        },
      ],
      {
        homeRepo: 'acme/home',
        repos: [
          stats('acme/frontend', {
            queues: {
              frontend: { waiting: 3, active: 1, delayed: 0, failed: 0 },
              backend: zero,
              qa: { ...zero, failed: 2 },
            },
            draftPRs: [
              {
                number: 42,
                title: 'Add login',
                url: 'https://github.com/acme/frontend/pull/42',
              },
            ],
          }),
          stats('acme/backend', {
            queues: {
              frontend: zero,
              backend: { ...zero, delayed: 4 },
              qa: zero,
            },
          }),
        ],
      },
    );
    const res = await loadProjectOverview(fetchFn);
    expect(res.ok).toBe(true);

    const { html } = render(ProjectsView, {
      props: { initialRepos: res.data },
    });

    expect(html).toContain('data-testid="repo-card-acme-frontend"');
    expect(html).toContain('data-testid="repo-card-acme-backend"');
    expect(html).toContain('/workspace/acme/frontend');
    expect(html).toContain('>Aktiv<');
    expect(html).toContain('>Inaktiv<');

    for (const label of ['wartend', 'laufend', 'pausiert', 'fehlgeschlagen'])
      expect(html).toContain(label);
    expect(html).toContain('Queue: Frontend');
    expect(cell(html, 'queue-frontend-waiting-acme-frontend')).toBe('3');
    expect(cell(html, 'queue-frontend-active-acme-frontend')).toBe('1');
    expect(cell(html, 'queue-qa-failed-acme-frontend')).toBe('2');
    expect(cell(html, 'queue-backend-delayed-acme-frontend')).toBe('0');
    expect(cell(html, 'queue-backend-delayed-acme-backend')).toBe('4');

    expect(html).toContain('Draft-PRs: 1');
    expect(html).toContain('href="https://github.com/acme/frontend/pull/42"');
    expect(html).toMatch(/#42\s+Add login/);
    expect(html).toContain('Draft-PRs: 0');
    expect(html).not.toContain('PRs aus Läufen');
    expect(html).not.toContain('home-badge');

    expect(html).toContain('data-testid="toggle-repo-acme-frontend"');
    expect(html).toContain('data-testid="remove-repo-acme-backend"');
    expect(html).toContain('data-testid="refresh-button"');
    expect(html).toContain('data-testid="repo-notice"');
  });

  it('empty registry: shows the home repo under the name from the stats endpoint', async () => {
    liveStore.state = {
      ...liveStore.state,
      runs: {
        'run-x': {
          runId: 'run-x',
          agent: 'agy',
          status: 'running',
          repo: 'other/guess',
          timestamp: '2026-10-25T12:00:00Z',
          data: { team: 'frontend' },
        },
      },
    };
    const fetchFn = mockFetch([], {
      homeRepo: 'tihofman/agent-hq',
      repos: [
        stats('tihofman/agent-hq', {
          home: true,
          queues: { frontend: { ...zero, active: 1 }, backend: zero, qa: zero },
        }),
      ],
    });
    const res = await loadProjectOverview(fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('/api/repos');
    expect(fetchFn).toHaveBeenCalledWith('/api/repos/stats');

    const { html } = render(ProjectsView, {
      props: { initialRepos: res.data },
    });
    expect(cell(html, 'repo-name-tihofman-agent-hq')).toBe('tihofman/agent-hq');
    expect(html).toContain('data-testid="home-badge"');
    expect(html).not.toContain('other/guess');
    expect(html).not.toContain('data-testid="remove-repo-tihofman-agent-hq"');
    expect(cell(html, 'queue-frontend-active-tihofman-agent-hq')).toBe('1');
  });

  it('empty registry without a resolvable name falls back to "Home-Repository"', async () => {
    const res = await loadProjectOverview(
      mockFetch([], {
        homeRepo: null,
        repos: [stats(null, { home: true })],
      }),
    );
    const { html } = render(ProjectsView, {
      props: { initialRepos: res.data },
    });
    expect(cell(html, 'repo-name-Home-Repository')).toBe('Home-Repository');
    expect(html).toContain('data-testid="home-badge"');
  });

  it('keeps the registry visible with zero counts when stats fail', async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url === '/api/repos/stats'
        ? { ok: false, status: 500, json: async () => ({ error: 'boom' }) }
        : {
            ok: true,
            status: 200,
            json: async () => [{ repo: 'org/a', path: '/w/a', enabled: true }],
          },
    ) as unknown as typeof fetch;
    const res = await loadProjectOverview(fetchFn);
    expect(res.ok).toBe(true);
    const { html } = render(ProjectsView, {
      props: { initialRepos: res.data },
    });
    expect(cell(html, 'queue-frontend-waiting-org-a')).toBe('0');
    expect(html).toContain('Draft-PRs: 0');
    expect(html).not.toContain('Home-Repository');
  });

  it('counts open questions per repo from the live store', () => {
    liveStore.state = {
      ...liveStore.state,
      questions: {
        'q-1': {
          id: 'q-1',
          issueId: 10,
          repo: 'acme/webapp',
          team: 'frontend',
          question: 'Choice?',
          status: 'PENDING',
        },
      },
    };
    const repos: ProjectRepoItem[] = [
      { repo: 'acme/webapp', enabled: true },
      { repo: 'acme/api', enabled: true },
    ];
    const { html } = render(ProjectsView, { props: { initialRepos: repos } });
    expect(cell(html, 'open-questions-acme-webapp')).toBe('Rückfragen: 1');
    expect(cell(html, 'open-questions-acme-api')).toBe('Rückfragen: 0');
  });

  it('contains the registration form with label notice and required fields', () => {
    const { html } = render(ProjectsView, {
      props: { initialRepos: [] },
    });

    expect(html).toContain('data-testid="add-repo-form"');
    expect(html).toContain('data-testid="repo-input"');
    expect(html).toContain('data-testid="path-input"');
    expect(html).toContain('data-testid="enabled-checkbox"');
    expect(html).toContain('data-testid="add-repo-button"');
    expect(html).toContain('data-testid="repo-notice"');
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'svelte/server';
import ProjectsView, { type ProjectRepoItem } from './ProjectsView.svelte';
import { resetLiveStore } from '../../live.svelte';

describe('ProjectsView.svelte', () => {
  beforeEach(() => {
    resetLiveStore();
  });

  afterEach(() => {
    resetLiveStore();
  });

  it('renders two repos with all specified metrics (running per team, open questions, runs PRs)', () => {
    const mockRepos: ProjectRepoItem[] = [
      {
        repo: 'acme/frontend',
        path: '/workspace/acme/frontend',
        enabled: true,
        metrics: {
          running: { frontend: 3, backend: 0, qa: 1 },
          openQuestions: 2,
          runsPrs: 1,
        },
      },
      {
        repo: 'acme/backend',
        path: '/workspace/acme/backend',
        enabled: false,
        metrics: {
          running: { frontend: 0, backend: 4, qa: 2 },
          openQuestions: 0,
          runsPrs: 3,
        },
      },
    ];

    const { html } = render(ProjectsView, {
      props: { initialRepos: mockRepos },
    });

    // Both repos listed
    expect(html).toContain('data-testid="repo-card-acme-frontend"');
    expect(html).toContain('data-testid="repo-card-acme-backend"');
    expect(html).toContain('acme/frontend');
    expect(html).toContain('acme/backend');
    expect(html).toContain('/workspace/acme/frontend');
    expect(html).toContain('/workspace/acme/backend');

    // Status badges
    expect(html).toContain('data-testid="repo-status-acme-frontend"');
    expect(html).toContain('>Aktiv<');
    expect(html).toContain('data-testid="repo-status-acme-backend"');
    expect(html).toContain('>Inaktiv<');

    // Repo 1 Kennzahlen
    expect(html).toContain('data-testid="running-frontend-acme-frontend"');
    expect(html).toContain('Laufend: Frontend');
    expect(html).toContain('Frontend: 3');
    expect(html).toContain('data-testid="running-backend-acme-frontend"');
    expect(html).toContain('Backend: 0');
    expect(html).toContain('data-testid="running-qa-acme-frontend"');
    expect(html).toContain('QA: 1');
    expect(html).toContain('data-testid="open-questions-acme-frontend"');
    expect(html).toContain('Rückfragen: 2');
    expect(html).toContain('data-testid="runs-prs-acme-frontend"');
    expect(html).toContain('PRs aus Läufen: 1');

    // Repo 2 Kennzahlen
    expect(html).toContain('data-testid="running-frontend-acme-backend"');
    expect(html).toContain('Frontend: 0');
    expect(html).toContain('data-testid="running-backend-acme-backend"');
    expect(html).toContain('Backend: 4');
    expect(html).toContain('data-testid="running-qa-acme-backend"');
    expect(html).toContain('QA: 2');
    expect(html).toContain('data-testid="open-questions-acme-backend"');
    expect(html).toContain('Rückfragen: 0');
    expect(html).toContain('data-testid="runs-prs-acme-backend"');
    expect(html).toContain('PRs aus Läufen: 3');

    // No "queue" or "wartend" in UI labels
    expect(html).not.toContain('Queue:');
    expect(html).not.toContain('Draft-PRs:');

    // Action buttons rendered
    expect(html).toContain('data-testid="toggle-repo-acme-frontend"');
    expect(html).toContain('Deaktivieren');
    expect(html).toContain('data-testid="toggle-repo-acme-backend"');
    expect(html).toContain('Aktivieren');
    expect(html).toContain('data-testid="remove-repo-acme-frontend"');
    expect(html).toContain('data-testid="remove-repo-acme-backend"');

    // Refresh button is present, navigation header is removed from ProjectsView
    expect(html).toContain('data-testid="refresh-button"');
    expect(html).not.toContain('data-testid="dashboard-link"');
    expect(html).not.toContain('data-testid="history-link"');

    // GitHub label creation notice
    expect(html).toContain('data-testid="repo-notice"');
    expect(html).toContain('team:*');
    expect(html).toContain('status:*');
  });

  it('renders neutral Home-Repository label when repo name is unknown', () => {
    const singleRepo: ProjectRepoItem[] = [
      {
        repo: 'Home-Repository',
        path: '(Home-Repository)',
        enabled: true,
        isHome: true,
        metrics: {
          running: { frontend: 1, backend: 0, qa: 0 },
          openQuestions: 0,
          runsPrs: 0,
        },
      },
    ];

    const { html } = render(ProjectsView, {
      props: { initialRepos: singleRepo },
    });

    expect(html).toContain('data-testid="repo-card-Home-Repository"');
    expect(html).toContain('data-testid="home-badge"');
    expect(html).toContain('Home');
    expect(html).toContain('(Home-Repository)');
    expect(html).not.toContain('tihofman/agent-hq');
    expect(html).not.toContain('data-testid="remove-repo-Home-Repository"');
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

  it('derives metrics from liveStore: running per team, open questions and unique runs PRs', async () => {
    const { liveStore } = await import('../../live.svelte');
    liveStore.state = {
      ...liveStore.state,
      runs: {
        'run-fe': {
          runId: 'run-fe',
          agent: 'agy',
          status: 'running',
          repo: 'acme/webapp',
          timestamp: '2026-10-25T12:00:00Z',
          data: { team: 'frontend', prNumber: 42 },
        },
        'run-be': {
          runId: 'run-be',
          agent: 'claude',
          status: 'running',
          repo: 'acme/api',
          timestamp: '2026-10-25T12:00:00Z',
          data: { team: 'backend' },
        },
      },
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

    const { html } = render(ProjectsView, {
      props: { initialRepos: repos },
    });

    // webapp metrics: 1 frontend running, 1 open question, 1 runs PR
    expect(html).toContain('data-testid="running-frontend-acme-webapp"');
    expect(html).toContain('Frontend: 1');
    expect(html).toContain('data-testid="open-questions-acme-webapp"');
    expect(html).toContain('Rückfragen: 1');
    expect(html).toContain('data-testid="runs-prs-acme-webapp"');
    expect(html).toContain('PRs aus Läufen: 1');

    // api metrics: 1 backend running, 0 open questions, 0 runs PRs
    expect(html).toContain('data-testid="running-backend-acme-api"');
    expect(html).toContain('Backend: 1');
    expect(html).toContain('data-testid="open-questions-acme-api"');
    expect(html).toContain('Rückfragen: 0');
    expect(html).toContain('data-testid="runs-prs-acme-api"');
    expect(html).toContain('PRs aus Läufen: 0');
  });

  it('deduplicates runs with identical prNumber and counts matching activePR only once (resulting in 1)', async () => {
    const { liveStore } = await import('../../live.svelte');
    liveStore.state = {
      ...liveStore.state,
      runs: {
        'run-1': {
          runId: 'run-1',
          agent: 'agy',
          status: 'running',
          repo: 'acme/service',
          timestamp: '2026-10-25T10:00:00Z',
          data: { team: 'frontend', prNumber: 42 },
        },
        'run-2': {
          runId: 'run-2',
          agent: 'claude',
          status: 'running',
          repo: 'acme/service',
          timestamp: '2026-10-25T11:00:00Z',
          data: { team: 'backend', prNumber: 42 },
        },
      },
      activePR: {
        repo: 'acme/service',
        prNumber: 42,
        status: 'draft',
      },
    };

    const repos: ProjectRepoItem[] = [{ repo: 'acme/service', enabled: true }];

    const { html } = render(ProjectsView, {
      props: { initialRepos: repos },
    });

    // Zwei Runs mit derselben prNumber plus ein matching activePR ergeben 1
    expect(html).toContain('data-testid="runs-prs-acme-service"');
    expect(html).toContain('PRs aus Läufen: 1');
  });

  it('handles empty registry with neutral Home-Repository fallback when repo is unknown', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });

    const { html } = render(ProjectsView, {
      props: { fetchFn: mockFetch as unknown as typeof fetch },
    });

    // Initial render / fallback behavior
    expect(html).toContain('data-testid="projects-page"');
    expect(html).not.toContain('tihofman/agent-hq');
  });

  it('handles populated registry correctly without home fallback', () => {
    const populatedRepos: ProjectRepoItem[] = [
      { repo: 'org/repo-a', path: '/workspace/a', enabled: true },
      { repo: 'org/repo-b', path: '/workspace/b', enabled: false },
    ];

    const { html } = render(ProjectsView, {
      props: { initialRepos: populatedRepos },
    });

    expect(html).toContain('org/repo-a');
    expect(html).toContain('org/repo-b');
    expect(html).not.toContain('Home-Repository');
    expect(html).not.toContain('tihofman/agent-hq');
  });
});

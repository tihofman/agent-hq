import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

  it('renders two repos with all specified metrics (queue counters per team, open questions, draft PRs)', () => {
    const mockRepos: ProjectRepoItem[] = [
      {
        repo: 'acme/frontend',
        path: '/workspace/acme/frontend',
        enabled: true,
        metrics: {
          queue: { frontend: 3, backend: 0, qa: 1 },
          openQuestions: 2,
          openDraftPrs: 1,
        },
      },
      {
        repo: 'acme/backend',
        path: '/workspace/acme/backend',
        enabled: false,
        metrics: {
          queue: { frontend: 0, backend: 4, qa: 2 },
          openQuestions: 0,
          openDraftPrs: 3,
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
    expect(html).toContain('data-testid="queue-frontend-acme-frontend"');
    expect(html).toContain('Frontend: 3');
    expect(html).toContain('data-testid="queue-backend-acme-frontend"');
    expect(html).toContain('Backend: 0');
    expect(html).toContain('data-testid="queue-qa-acme-frontend"');
    expect(html).toContain('QA: 1');
    expect(html).toContain('data-testid="open-questions-acme-frontend"');
    expect(html).toContain('Rückfragen: 2');
    expect(html).toContain('data-testid="open-prs-acme-frontend"');
    expect(html).toContain('Draft-PRs: 1');

    // Repo 2 Kennzahlen
    expect(html).toContain('data-testid="queue-frontend-acme-backend"');
    expect(html).toContain('Frontend: 0');
    expect(html).toContain('data-testid="queue-backend-acme-backend"');
    expect(html).toContain('Backend: 4');
    expect(html).toContain('data-testid="queue-qa-acme-backend"');
    expect(html).toContain('QA: 2');
    expect(html).toContain('data-testid="open-questions-acme-backend"');
    expect(html).toContain('Rückfragen: 0');
    expect(html).toContain('data-testid="open-prs-acme-backend"');
    expect(html).toContain('Draft-PRs: 3');

    // Action buttons rendered
    expect(html).toContain('data-testid="toggle-repo-acme-frontend"');
    expect(html).toContain('Deaktivieren');
    expect(html).toContain('data-testid="toggle-repo-acme-backend"');
    expect(html).toContain('Aktivieren');
    expect(html).toContain('data-testid="remove-repo-acme-frontend"');
    expect(html).toContain('data-testid="remove-repo-acme-backend"');

    // GitHub label creation notice
    expect(html).toContain('data-testid="repo-notice"');
    expect(html).toContain('team:*');
    expect(html).toContain('status:*');
  });

  it('renders exactly one entry for single / home repo', () => {
    const singleRepo: ProjectRepoItem[] = [
      {
        repo: 'tihofman/agent-hq',
        path: '/Users/timm/agent-hq',
        enabled: true,
        isHome: true,
        metrics: {
          queue: { frontend: 1, backend: 0, qa: 0 },
          openQuestions: 0,
          openDraftPrs: 0,
        },
      },
    ];

    const { html } = render(ProjectsView, {
      props: { initialRepos: singleRepo },
    });

    expect(html).toContain('data-testid="repo-card-tihofman-agent-hq"');
    expect(html).toContain('data-testid="home-badge"');
    expect(html).toContain('Home');
    expect(html).not.toContain('data-testid="remove-repo-tihofman-agent-hq"');
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

  it('derives metrics from liveStore when not pre-provided on repo item', async () => {
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

    // webapp metrics: 1 frontend queue, 1 open question, 1 draft PR
    expect(html).toContain('data-testid="queue-frontend-acme-webapp"');
    expect(html).toContain('Frontend: 1');
    expect(html).toContain('data-testid="open-questions-acme-webapp"');
    expect(html).toContain('Rückfragen: 1');
    expect(html).toContain('data-testid="open-prs-acme-webapp"');
    expect(html).toContain('Draft-PRs: 1');

    // api metrics: 1 backend queue, 0 open questions, 0 draft PRs
    expect(html).toContain('data-testid="queue-backend-acme-api"');
    expect(html).toContain('Backend: 1');
    expect(html).toContain('data-testid="open-questions-acme-api"');
    expect(html).toContain('Rückfragen: 0');
    expect(html).toContain('data-testid="open-prs-acme-api"');
    expect(html).toContain('Draft-PRs: 0');
  });
});

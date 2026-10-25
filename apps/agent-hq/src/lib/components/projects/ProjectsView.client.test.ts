import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ProjectsView from './ProjectsView.svelte';
import { liveStore, resetLiveStore } from '../../live.svelte';
import type { RepoStats, RepoStatsResponse } from '@agent-hq/queue/types';

const zero = { waiting: 0, active: 0, delayed: 0, failed: 0 };
const home = (
  repo: string | null,
  overrides: Partial<RepoStats> = {},
): RepoStats => ({
  repo,
  home: true,
  queues: { frontend: zero, backend: zero, qa: zero },
  draftPRs: [],
  ...overrides,
});

/** Empty registry; `/api/repos/stats` answers with `statsBody`. */
function mockFetch(statsBody: RepoStatsResponse) {
  return vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => (url === '/api/repos/stats' ? statsBody : []),
  })) as unknown as typeof fetch;
}

const byTestId = (testId: string) =>
  document.querySelector(`[data-testid="${testId}"]`);

/** Mounts without `initialRepos`, so `onMount` has to run `loadRepos`. */
async function mountAndLoad(fetchFn: typeof fetch, nameTestId: string) {
  const target = document.createElement('div');
  document.body.append(target);
  const component = mount(ProjectsView, {
    target,
    props: { fetchFn, refreshMs: 60_000 },
  });
  flushSync();
  await vi.waitFor(() => expect(byTestId(nameTestId)).not.toBeNull());
  return component;
}

describe('ProjectsView.svelte (client)', () => {
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    resetLiveStore();
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    document.body.innerHTML = '';
    resetLiveStore();
  });

  it('empty registry: loads the home repo under its real name', async () => {
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
    const fetchFn = mockFetch({
      homeRepo: 'tihofman/agent-hq',
      repos: [
        home('tihofman/agent-hq', {
          queues: { frontend: { ...zero, active: 1 }, backend: zero, qa: zero },
        }),
      ],
    });

    component = await mountAndLoad(fetchFn, 'repo-name-tihofman-agent-hq');

    expect(fetchFn).toHaveBeenCalledWith('/api/repos');
    expect(fetchFn).toHaveBeenCalledWith('/api/repos/stats');
    expect(byTestId('repo-name-tihofman-agent-hq')?.textContent?.trim()).toBe(
      'tihofman/agent-hq',
    );
    expect(byTestId('home-badge')).not.toBeNull();
    expect(byTestId('loading-state')).toBeNull();
    expect(document.body.textContent).not.toContain('other/guess');
    expect(byTestId('remove-repo-tihofman-agent-hq')).toBeNull();
    expect(
      byTestId('queue-frontend-active-tihofman-agent-hq')?.textContent?.trim(),
    ).toBe('1');
  });

  it('empty registry without a resolvable name falls back to "Home-Repository"', async () => {
    const fetchFn = mockFetch({ homeRepo: null, repos: [home(null)] });

    component = await mountAndLoad(fetchFn, 'repo-name-Home-Repository');

    expect(fetchFn).toHaveBeenCalledWith('/api/repos');
    expect(byTestId('repo-name-Home-Repository')?.textContent?.trim()).toBe(
      'Home-Repository',
    );
    expect(byTestId('home-badge')).not.toBeNull();
  });
});

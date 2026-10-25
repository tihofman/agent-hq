import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import type { QueueManagerLike, TaskPayload, Team } from '@agent-hq/queue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetQuestionsState,
  setQueueManager,
} from '../../../../lib/server/questions';
import {
  GH_CACHE_TTL_MS,
  resetRepoStatsCache,
  type RepoStatsResponse,
} from '../../../../lib/server/repo-stats';
import {
  getReposPath,
  setRepoGhRunner,
  type RepoCommandRunner,
} from '../../../../lib/server/repos';
import { GET } from './+server';

const URL_BASE = 'http://127.0.0.1:3333/api/repos/stats';
const get = (origin?: string) => {
  const request = new Request(URL_BASE, {
    headers: origin ? { Origin: origin } : {},
  });
  return GET({ request, url: new URL(request.url) } as unknown as RequestEvent);
};

type State = 'waiting' | 'active' | 'delayed' | 'failed' | 'completed';
function mockManager(
  jobs: { team: Team; state: State; repo?: string }[],
): QueueManagerLike {
  return {
    getQueue: (team: Team) => ({
      getJobs: async ([state]: State[]) =>
        jobs
          .filter((j) => j.team === team && j.state === state)
          .map((j, i) => ({
            data: { issueId: i + 1, team, repo: j.repo } as TaskPayload,
          })),
    }),
  } as unknown as QueueManagerLike;
}

const zero = { waiting: 0, active: 0, delayed: 0, failed: 0 };

describe('/api/repos/stats', () => {
  let home: string;
  let gh: ReturnType<typeof vi.fn<RepoCommandRunner>>;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'hq-repo-stats-'));
    vi.stubEnv('AGENT_HQ_HOME', home);
    gh = vi.fn<RepoCommandRunner>(async (args) => {
      if (args[1] === 'view') return 'acme/home\n';
      const repo = args[args.indexOf('--repo') + 1];
      return JSON.stringify([
        {
          number: 7,
          title: `Draft in ${repo}`,
          url: `https://github.com/${repo}/pull/7`,
          headRefName: 'feat/7-x',
        },
      ]);
    });
    setRepoGhRunner(gh);
  });

  afterEach(async () => {
    vi.useRealTimers();
    setRepoGhRunner(undefined);
    resetQuestionsState();
    resetRepoStatsCache();
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  async function register(...repos: string[]) {
    const file = getReposPath();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify(
        repos.map((repo) => ({
          repo,
          path: join(home, repo),
          enabled: true,
        })),
      ),
    );
  }

  it('rejects foreign origins', async () => {
    expect((await get('http://evil.example')).status).toBe(403);
    expect((await get('http://127.0.0.1:3333')).status).toBe(200);
  });

  it('counts jobs per repo, team and state; legacy jobs go to the home repo', async () => {
    await register('acme/alpha', 'acme/beta');
    setQueueManager(
      mockManager([
        { team: 'frontend', state: 'waiting', repo: 'acme/alpha' },
        { team: 'frontend', state: 'waiting', repo: 'acme/alpha' },
        { team: 'backend', state: 'active', repo: 'acme/alpha' },
        { team: 'qa', state: 'failed', repo: 'acme/beta' },
        { team: 'backend', state: 'delayed', repo: 'acme/beta' },
        { team: 'backend', state: 'completed', repo: 'acme/beta' },
        { team: 'frontend', state: 'active' },
      ]),
    );

    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as RepoStatsResponse;
    expect(body.homeRepo).toBe('acme/home');
    expect(body.repos).toEqual([
      {
        repo: 'acme/alpha',
        home: false,
        queues: {
          frontend: { ...zero, waiting: 2 },
          backend: { ...zero, active: 1 },
          qa: zero,
        },
        draftPRs: [
          {
            number: 7,
            title: 'Draft in acme/alpha',
            url: 'https://github.com/acme/alpha/pull/7',
          },
        ],
      },
      {
        repo: 'acme/beta',
        home: false,
        queues: {
          frontend: zero,
          backend: { ...zero, delayed: 1 },
          qa: { ...zero, failed: 1 },
        },
        draftPRs: [
          {
            number: 7,
            title: 'Draft in acme/beta',
            url: 'https://github.com/acme/beta/pull/7',
          },
        ],
      },
      {
        repo: 'acme/home',
        home: true,
        queues: {
          frontend: { ...zero, active: 1 },
          backend: zero,
          qa: zero,
        },
        draftPRs: [
          {
            number: 7,
            title: 'Draft in acme/home',
            url: 'https://github.com/acme/home/pull/7',
          },
        ],
      },
    ]);
  });

  it('caches draft PRs and the home name per TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await register('acme/alpha');
    const prCalls = () =>
      gh.mock.calls.filter(([args]) => args[0] === 'pr').length;

    await get();
    expect(prCalls()).toBe(1);
    expect(gh).toHaveBeenCalledWith(
      expect.arrayContaining(['pr', 'list', '--repo', 'acme/alpha', '--draft']),
      expect.any(String),
    );
    const viewCalls = gh.mock.calls.length - prCalls();

    await get();
    expect(prCalls()).toBe(1);
    expect(gh.mock.calls.length - prCalls()).toBe(viewCalls);

    vi.advanceTimersByTime(GH_CACHE_TTL_MS + 1);
    await get();
    expect(prCalls()).toBe(2);
  });

  it('answers 200 with empty counts without Redis and an empty registry', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      homeRepo: 'acme/home',
      repos: [
        {
          repo: 'acme/home',
          home: true,
          queues: { frontend: zero, backend: zero, qa: zero },
          draftPRs: [expect.objectContaining({ number: 7 })],
        },
      ],
    });
  });

  it('keeps answering 200 when the queue read fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setQueueManager({
      getQueue: () => ({
        getJobs: async () => {
          throw new Error('Connection is closed');
        },
      }),
    } as unknown as QueueManagerLike);
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as RepoStatsResponse;
    expect(body.repos[0].queues.frontend).toEqual(zero);
  });
});

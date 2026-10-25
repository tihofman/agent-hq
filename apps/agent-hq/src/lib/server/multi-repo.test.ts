import { execFileSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DelayedError, type Job, type Processor } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueEvents } from 'bullmq';
import type { TaskPayload, Team } from '@agent-hq/queue';
import { finalizeWorktree, prepareWorktree } from './git-worktree';
import { startIssueIngest } from './issue-ingest';
import {
  answerQuestion,
  askQuestion,
  setGhRunner,
  setQueueManager,
} from './questions';
import type { RepoEntry } from './repos';
import { resetStore } from './store';
import {
  DEFAULT_ATTEMPTS,
  WorkerPool,
  buildTaskPrompt,
  type QueueManagerLike,
  type SubscriptionPoolLike,
  type WorkerTaskPayload,
} from './worker-pool';

type State = 'waiting' | 'active' | 'delayed' | 'completed' | 'failed';
interface MockJob {
  id: string;
  team: Team;
  data: WorkerTaskPayload;
  state: State;
  attemptsMade: number;
  opts: { attempts: number };
  getState: () => Promise<State>;
  updateData: (data: WorkerTaskPayload) => Promise<void>;
  moveToDelayed: (until: number) => Promise<void>;
  promote: ReturnType<typeof vi.fn>;
}

/** BullMQ stand-in that dedupes by job ID like the real queue. */
class Queues implements QueueManagerLike {
  readonly jobs = new Map<string, MockJob>();
  readonly hashes = new Map<string, Record<string, string>>();
  private readonly procs: Partial<Record<Team, Processor<TaskPayload>>> = {};
  connection = {
    hgetall: async (key: string) => ({ ...this.hashes.get(key) }),
    hset: async (key: string, ...args: string[]) => {
      const hash = { ...this.hashes.get(key) };
      for (let i = 0; i < args.length; i += 2) hash[args[i]] = args[i + 1];
      this.hashes.set(key, hash);
      return 1;
    },
    del: async (...keys: string[]) =>
      keys.filter((key) => this.hashes.delete(key)).length,
    expire: async () => 1,
  };

  add(team: Team, data: TaskPayload, id: string): MockJob {
    const existing = this.jobs.get(id);
    if (existing) return existing;
    const job: MockJob = {
      id,
      team,
      data: structuredClone(data),
      state: 'waiting',
      attemptsMade: 0,
      opts: { attempts: DEFAULT_ATTEMPTS },
      getState: async () => job.state,
      updateData: async (next) => void (job.data = next),
      moveToDelayed: async () => void (job.state = 'delayed'),
      promote: vi.fn(async () => void (job.state = 'waiting')),
    };
    this.jobs.set(id, job);
    return job;
  }

  getQueue(team: Team) {
    const inTeam = (job?: MockJob) => (job?.team === team ? job : undefined);
    return {
      add: async (_name: string, data: TaskPayload, o: { jobId: string }) =>
        this.add(team, data, o.jobId),
      getJob: async (id: string) => inTeam(this.jobs.get(id)),
      getJobs: async (states: string[]) =>
        [...this.jobs.values()].filter(
          (j) => j.team === team && states.includes(j.state),
        ),
    } as never;
  }

  createWorker(team: Team, proc: Processor<TaskPayload>) {
    this.procs[team] = proc;
    return { close: async () => undefined } as never;
  }

  async close() {}

  /** Drives one job through the worker like BullMQ would. */
  async run(id: string): Promise<MockJob> {
    const job = this.jobs.get(id)!;
    const proc = this.procs[job.team]!;
    while (job.state === 'waiting') {
      job.state = 'active';
      try {
        await proc(job as unknown as Job<TaskPayload>, 'token');
        if (job.state === 'active') job.state = 'completed';
      } catch (err) {
        if (err instanceof DelayedError) continue;
        job.state =
          ++job.attemptsMade < DEFAULT_ATTEMPTS ? 'waiting' : 'failed';
      }
    }
    return job;
  }
}

const subscriptions: SubscriptionPoolLike = {
  pick: async () => ({ provider: 'claude' }),
  reportOutput: async () => false,
  on: vi.fn(),
  off: vi.fn(),
  close: vi.fn(),
};

async function script(path: string, body: string): Promise<string> {
  await writeFile(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

describe('multiple repos in one instance (ADR 0007)', () => {
  let dir: string;
  let ghCalls: string[][];
  let queues: Queues;
  const listeners = new Map<string, (data: { jobId: string }) => void>();
  const writeRegistry = (entries: RepoEntry[]) =>
    writeFile(join(dir, 'repos.json'), JSON.stringify(entries));
  const edits = (repo?: string) =>
    ghCalls.filter(
      (args) =>
        args[1] === 'edit' &&
        (repo ? args.at(-1) === repo : !args.includes('--repo')),
    );

  beforeEach(async () => {
    resetStore();
    dir = await realpath(await mkdtemp(join(tmpdir(), 'hq-multi-')));
    vi.stubEnv('AGENT_HQ_HOME', dir);
    vi.stubEnv('AGENT_HQ_LOG_DIR', join(dir, 'logs'));
    for (const name of ['alpha', 'beta', 'home'])
      await mkdir(join(dir, name), { recursive: true });
    queues = new Queues();
    ghCalls = [];
    setGhRunner(gh);
    listeners.clear();
  });

  afterEach(async () => {
    setGhRunner(undefined);
    vi.unstubAllEnvs();
    resetStore();
    await rm(dir, { recursive: true, force: true });
  });

  // gh mock: both repos report issue #12 for team:backend.
  const gh = async (args: string[]) => {
    ghCalls.push(args);
    if (args[1] === 'list')
      return JSON.stringify(
        args[5] === 'team:backend'
          ? [{ number: 12, title: 'Same number', body: '', labels: [] }]
          : [],
      );
    return args[1] === 'view' ? JSON.stringify({ labels: [] }) : '';
  };
  const startIngest = () =>
    startIssueIngest({
      queueManager: queues,
      runGh: gh,
      intervalMs: 60_000,
      queueEvents: (team) =>
        ({
          on: (name: string, fn: (data: { jobId: string }) => void) =>
            void listeners.set(`${team}:${name}`, fn),
          close: async () => undefined,
        }) as unknown as Pick<QueueEvents, 'on' | 'close'>,
    });

  it('enqueues the same issue number from two repos, labels per --repo and round-trips a question to the right job', async () => {
    await writeRegistry([
      { repo: 'acme/alpha', path: join(dir, 'alpha'), enabled: true },
      { repo: 'acme/beta', path: join(dir, 'beta'), enabled: true },
    ]);
    const stop = startIngest();
    try {
      await vi.waitFor(() => expect(edits('acme/beta')).toHaveLength(1));
      expect([...queues.jobs.keys()]).toEqual([
        'acme/alpha#12',
        'acme/beta#12',
      ]);
      expect(queues.jobs.get('acme/beta#12')!.data).toMatchObject({
        issueId: 12,
        repo: 'acme/beta',
      });
      expect(edits('acme/alpha')).toEqual([
        [
          'issue',
          'edit',
          '12',
          '--add-label',
          'status:queued',
          '--repo',
          'acme/alpha',
        ],
      ]);
      // Registered repos got their labels at registration, not per poll.
      expect(ghCalls.some((args) => args[0] === 'label')).toBe(false);

      listeners.get('backend:active')!({ jobId: 'acme/beta#12' });
      await vi.waitFor(() =>
        expect(edits('acme/beta').at(-1)).toContain('status:in-progress'),
      );
      expect(edits('acme/alpha')).toHaveLength(1);
    } finally {
      stop();
    }

    // Worker run: ask (as hq-ask.sh would) -> pause -> answer -> promote -> resume.
    const calls = join(dir, 'calls.txt');
    const delegate = await script(
      join(dir, 'delegate.sh'),
      `printf '%s|%s|%s|%s\\n' "$HQ_REPO" "$HQ_JOB_ID" "\${HQ_SESSION_ID:-}" "$PWD" >> "${calls}"
       echo "session id: 11111111-2222-3333-4444-555555555555"`,
    );
    const contexts: { repoRoot: string; repo?: string }[] = [];
    let asked = false;
    const pool = new WorkerPool({
      enabled: true,
      queueManager: queues,
      subscriptionPool: subscriptions,
      repoRoot: join(dir, 'home'),
      delegateScript: delegate,
      logDir: join(dir, 'logs'),
      prepareWorktree: async (ctx, payload) => {
        contexts.push({ repoRoot: ctx.repoRoot, repo: ctx.repo });
        const worktreePath = join(
          ctx.repoRoot,
          '.worktrees',
          `feat-${payload.issueId}`,
        );
        await mkdir(worktreePath, { recursive: true });
        return { worktreePath, branch: 'feat/12-x', slug: 'x' };
      },
      finalizeWorktree: async () => ({
        prUrl: 'https://github.com/acme/alpha/pull/1',
      }),
      afterProcessExit: async (job) => {
        if (asked || job.data.repo !== 'acme/alpha') return;
        asked = true;
        await askQuestion({
          issueId: 12,
          team: 'backend',
          question: 'Welche DB?',
          repo: 'acme/alpha',
          jobId: 'acme/alpha#12',
        });
      },
    });
    await pool.start();
    try {
      const alpha = await queues.run('acme/alpha#12');
      const beta = queues.jobs.get('acme/beta#12')!;
      expect(alpha.state).toBe('delayed');
      expect(alpha.data.question).toMatchObject({
        id: 'acme.alpha.12-1',
        repo: 'acme/alpha',
        status: 'PENDING',
      });
      expect(beta.data.question).toBeUndefined();
      expect(edits('acme/alpha').at(-1)).toContain('status:blocked');
      expect(
        queues.hashes.get('agent-hq:session:acme/alpha#12')?.sessionId,
      ).toBe('11111111-2222-3333-4444-555555555555');

      await answerQuestion('acme.alpha.12-1', 'Postgres');
      expect(alpha.promote).toHaveBeenCalledOnce();
      expect(beta.promote).not.toHaveBeenCalled();
      expect(alpha.state).toBe('waiting');
      expect(beta.state).toBe('waiting');
      expect(edits('acme/alpha').at(-1)).toContain('status:queued');

      expect((await queues.run('acme/alpha#12')).state).toBe('completed');
      expect(queues.hashes.has('agent-hq:session:acme/alpha#12')).toBe(false);
      expect((await queues.run('acme/beta#12')).state).toBe('completed');

      const lines = (await readFile(calls, 'utf8')).trim().split('\n');
      expect(lines).toEqual([
        `acme/alpha|acme/alpha#12||${join(dir, 'alpha/.worktrees/feat-12')}`,
        `acme/alpha|acme/alpha#12|11111111-2222-3333-4444-555555555555|${join(dir, 'alpha/.worktrees/feat-12')}`,
        `acme/beta|acme/beta#12||${join(dir, 'beta/.worktrees/feat-12')}`,
      ]);
      expect(contexts.map((c) => c.repo)).toEqual([
        'acme/alpha',
        'acme/alpha',
        'acme/beta',
      ]);
    } finally {
      await pool.close();
    }
  });

  it('keeps processing a legacy issue-<n> job and its session hash as home repo', async () => {
    await writeRegistry([
      { repo: 'acme/alpha', path: join(dir, 'alpha'), enabled: true },
    ]);
    const legacy = queues.add(
      'backend',
      { issueId: 7, title: 'Old', team: 'backend', body: '', labels: [] },
      'issue-7',
    );
    legacy.state = 'active';
    setQueueManager(queues);
    await askQuestion({ issueId: 7, team: 'backend', question: 'Alt?' });
    expect(legacy.data.question?.id).toBe('7-1');
    expect(edits().at(-1)).toEqual([
      'issue',
      'edit',
      '7',
      '--add-label',
      'status:blocked',
    ]);
    legacy.state = 'delayed';
    queues.hashes.set('agent-hq:session:issue-7', {
      sessionId: 'legacy-session',
      provider: 'claude',
    });
    await answerQuestion('7-1', 'Ja');
    expect(legacy.state).toBe('waiting');

    const calls = join(dir, 'legacy.txt');
    const contexts: { repoRoot: string; repo?: string }[] = [];
    const pool = new WorkerPool({
      enabled: true,
      queueManager: queues,
      subscriptionPool: subscriptions,
      repoRoot: join(dir, 'home'),
      env: { ...process.env, HQ_REPO: 'stale/value' },
      delegateScript: await script(
        join(dir, 'legacy.sh'),
        `printf '%s|%s|%s|%s\\n' "\${HQ_REPO:-}" "$HQ_JOB_ID" "$HQ_SESSION_ID" "$2" > "${calls}"`,
      ),
      logDir: join(dir, 'logs'),
      prepareWorktree: async (ctx) => {
        contexts.push({ repoRoot: ctx.repoRoot, repo: ctx.repo });
        return {
          worktreePath: ctx.repoRoot,
          branch: 'feat/7-old',
          slug: 'old',
        };
      },
      finalizeWorktree: async () => ({
        prUrl: 'https://github.com/x/y/pull/7',
      }),
    });
    await pool.start();
    try {
      expect((await queues.run('issue-7')).state).toBe('completed');
    } finally {
      await pool.close();
    }
    expect(contexts).toEqual([
      { repoRoot: join(dir, 'home'), repo: undefined },
    ]);
    expect((await readFile(calls, 'utf8')).trim()).toBe(
      '|issue-7|legacy-session|Ja',
    );
    expect(queues.hashes.has('agent-hq:session:issue-7')).toBe(false);

    const stop = startIngest();
    try {
      listeners.get('backend:completed')!({ jobId: 'issue-7' });
      await vi.waitFor(() =>
        expect(edits().at(-1)).toEqual([
          'issue',
          'edit',
          '7',
          '--add-label',
          'status:done',
        ]),
      );
    } finally {
      stop();
    }
  });

  it('creates worktree and runs the worker inside the target repo; gh pr uses --repo', async () => {
    const remote = join(dir, 'remote.git');
    const repo = join(dir, 'alpha');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', remote]);
    await writeFile(join(repo, 'README.md'), '# alpha\n');
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
        {
          stdio: 'ignore',
        },
      );
    git('add', '.');
    git('commit', '-qm', 'init');
    git('push', '-q', 'origin', 'main');
    await writeRegistry([{ repo: 'acme/alpha', path: repo, enabled: true }]);

    const ghLog = join(dir, 'gh.log');
    const fakeGh = await script(
      join(dir, 'gh.sh'),
      `echo "$*" >> "${ghLog}"
       if [ "$1 $2" = "pr view" ]; then exit 1; fi
       echo "https://github.com/acme/alpha/pull/5"`,
    );
    const cwdFile = join(dir, 'cwd.txt');
    queues.add(
      'backend',
      {
        issueId: 12,
        repo: 'acme/alpha',
        title: 'Add thing',
        team: 'backend',
        body: '',
        labels: [],
      },
      'acme/alpha#12',
    );
    const pool = new WorkerPool({
      enabled: true,
      queueManager: queues,
      subscriptionPool: subscriptions,
      repoRoot: join(dir, 'home'),
      ghBinary: fakeGh,
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t' },
      delegateScript: await script(
        join(dir, 'wt.sh'),
        `pwd -P > "${cwdFile}"; echo change > change.txt`,
      ),
      logDir: join(dir, 'logs'),
      prepareWorktree,
      finalizeWorktree,
    });
    await pool.start();
    try {
      const job = await queues.run('acme/alpha#12');
      expect(job.state).toBe('completed');
      expect(job.data.prUrl).toBe('https://github.com/acme/alpha/pull/5');
    } finally {
      await pool.close();
    }
    expect((await readFile(cwdFile, 'utf8')).trim()).toBe(
      join(repo, '.worktrees', 'feat-12-add-thing'),
    );
    const gh = (await readFile(ghLog, 'utf8')).trim().split('\n');
    expect(gh).toEqual([
      'pr view feat/12-add-thing --json url -q .url --repo acme/alpha',
      'pr create --draft --title feat(#12): Add thing --body Closes #12 --repo acme/alpha --head feat/12-add-thing --base main',
    ]);
  });

  it('keeps nx and agent-hq app paths out of the worker prompt', () => {
    const prompt = buildTaskPrompt({
      issueId: 12,
      repo: 'acme/alpha',
      title: 'Add thing',
      team: 'backend',
      body: 'Body',
      labels: [],
    });
    expect(prompt).not.toMatch(/\bnx\b/);
    expect(prompt).not.toContain('apps/agent-hq');
    // The only agent-hq path is the absolute hq-ask.sh (required for the sandbox exclusion).
    expect(prompt).toMatch(/ \/\S+\/scripts\/hq-ask\.sh /);
  });
});

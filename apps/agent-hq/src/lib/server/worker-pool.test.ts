import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DelayedError,
  type Job,
  type Processor,
  type Queue,
  type Worker,
} from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskPayload, Team } from '@agent-hq/queue';
import {
  startServerWorkers,
  stopServerTail,
  stopServerWorkers,
} from '../../hooks.server';
import { GitWorktreeManager, type WorktreeManagerLike } from './git-worktree';
import { readHistory } from './history';
import { createEventStream } from './sse';
import { getState, resetStore } from './store';
import { SubscriptionPool } from './subscription-pool';
import {
  DEFAULT_ATTEMPTS,
  DEFAULT_CONCURRENCY,
  WorkerPool,
  buildTaskPrompt,
  deriveTeamStatus,
  isV2WorkersEnabled,
  truncateError,
  type QueueManagerLike,
  type WorkerJob,
  type WorkerPoolOptions,
  type WorkerTaskPayload,
} from './worker-pool';

const redisStore = vi.hoisted(() => {
  const values: Record<string, string> = {};
  return {
    values,
    hgetall: vi.fn(async () => ({ ...values })),
    hset: vi.fn(
      async (_k: string, p: string, v: string) => ((values[p] = v), 1),
    ),
    disconnect: vi.fn(),
  };
});

vi.mock('@agent-hq/queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent-hq/queue')>()),
  createRedisConnection: vi.fn(() => redisStore),
}));

interface MockJobRecord extends WorkerJob {
  id: string;
  state: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed';
  attemptsMade: number;
}

class MockQueueManager implements QueueManagerLike {
  readonly jobs: MockJobRecord[] = [];
  readonly events: string[] = [];
  readonly concurrencies: Partial<Record<Team, number>> = {};
  connection = { ping: vi.fn(async () => 'PONG') };
  private readonly procs: Partial<Record<Team, Processor<TaskPayload>>> = {};

  addJob(team: Team, data: TaskPayload): MockJobRecord {
    const job: MockJobRecord = {
      id: String(data.issueId),
      data: structuredClone(data) as WorkerTaskPayload,
      state: 'waiting',
      attemptsMade: 0,
      updateData: vi.fn(async (next: WorkerTaskPayload) => {
        job.data = next;
      }),
      moveToDelayed: vi.fn(async () => {
        job.state = 'delayed';
      }),
    };
    this.jobs.push(job);
    return job;
  }

  async run(team: Team, data: TaskPayload): Promise<MockJobRecord> {
    const job = this.addJob(team, data);
    const proc = this.procs[team];
    while (proc && job.state === 'waiting') {
      job.state = 'active';
      try {
        await proc(job as unknown as Job<TaskPayload>, `t-${job.id}`);
        if (job.state === 'active') job.state = 'completed';
      } catch (err) {
        const isDelayed =
          err instanceof DelayedError ||
          (err as Error)?.name === 'DelayedError';
        if (isDelayed) job.state = 'delayed';
        else if (++job.attemptsMade < DEFAULT_ATTEMPTS) job.state = 'waiting';
        else job.state = 'failed';
      }
    }
    return job;
  }

  getQueue(team: Team): Queue<TaskPayload> {
    const getJobs = async (t: string[] = ['active', 'delayed', 'waiting']) =>
      this.jobs.filter((j) => j.data.team === team && t.includes(j.state));
    return { getJobs } as unknown as Queue<TaskPayload>;
  }

  createWorker(
    team: Team,
    proc: Processor<TaskPayload>,
    opts?: { concurrency?: number },
  ) {
    this.concurrencies[team] = opts?.concurrency ?? 1;
    this.procs[team] = proc;
    const close = vi.fn(
      async () => void this.events.push(`worker.close:${team}`),
    );
    return { close } as unknown as Worker<TaskPayload>;
  }

  async close(): Promise<void> {
    this.events.push('manager.close');
  }
}

const makeTask = (id: number, team: Team): TaskPayload => ({
  issueId: id,
  title: `Feature #${id}`,
  team,
  body: `Body #${id}`,
  labels: [`team:${team}`],
});

async function makeScript(dir: string, body: string, name = 'delegate.sh') {
  const path = join(dir, name);
  await writeFile(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

describe('WorkerPool (#98)', () => {
  let tempDir: string;
  let manager: MockQueueManager;

  const createMockWorktreeManager = (baseDir: string): WorktreeManagerLike => ({
    prepare: vi.fn(async (payload) => ({
      worktreePath: baseDir,
      branch: `feat/${payload.issueId}-test`,
      slug: 'test',
    })),
    finalizeSuccess: vi.fn(async () => ({
      prUrl: 'https://github.com/fake-org/fake-repo/pull/123',
    })),
  });

  const createPool = (opts: WorkerPoolOptions = {}) =>
    new WorkerPool({
      enabled: true,
      queueManager: manager,
      subscriptionPool: new SubscriptionPool(),
      logDir: tempDir,
      worktreeManager:
        opts.worktreeManager ?? createMockWorktreeManager(tempDir),
      ...opts,
    });

  beforeEach(async () => {
    resetStore();
    for (const k of Object.keys(redisStore.values)) delete redisStore.values[k];
    vi.clearAllMocks();
    manager = new MockQueueManager();
    tempDir = await mkdtemp(join(tmpdir(), 'hq-pool-'));
    vi.stubEnv('AGENT_HQ_HOME', tempDir);
    vi.stubEnv('AGENT_HQ_LOG_DIR', join(tempDir, 'logs'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    resetStore();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('respects feature flag, team concurrency (2/1/1 = 4 slots), and delegate env', async () => {
    expect(isV2WorkersEnabled({})).toBe(false);
    expect(isV2WorkersEnabled({ AGENT_HQ_V2_WORKERS: 'true' })).toBe(true);
    expect(
      await new WorkerPool({ env: {}, queueManager: manager }).start(),
    ).toBe(false);

    const envFile = join(tempDir, 'env.json');
    const delegateScript = await makeScript(
      tempDir,
      `printf '{"team":"%s","id":"%s","m":"%s","t":"%s"}' "$HQ_TEAM" "$HQ_ISSUE_ID" "\${AGENT_MODEL:-}" "\${TICKET_ID:-}" > "${envFile}"`,
    );

    const pool = createPool({
      env: { ...process.env, AGENT_MODEL_AGY: 'gemini-custom' },
      delegateScript,
    });
    expect(pool.concurrency).toEqual(DEFAULT_CONCURRENCY);
    expect(pool.totalSlots).toBe(4);
    expect(await pool.start()).toBe(true);
    expect(manager.concurrencies).toEqual({ frontend: 2, backend: 1, qa: 1 });

    await manager.run('frontend', makeTask(11, 'frontend'));
    expect(JSON.parse(await readFile(envFile, 'utf8'))).toEqual({
      team: 'frontend',
      id: '11',
      m: 'gemini-custom',
      t: '',
    });
    await pool.close();
  });

  it('restarts on non-zero rate-limit via reportOutput, ignores exit 0 or foreign logs, delays when all in cooldown, and prevents infinite loops', async () => {
    const callsFile = join(tempDir, 'calls.txt');
    await writeFile(join(tempDir, 'foreign.log'), 'Rate limit exceeded\n');

    const delegateScript = await makeScript(
      tempDir,
      `echo "$1" >> "${callsFile}"
       echo "You have exhausted your quota on this model. Retry-After: 60"
       [ "$1" != "agy" ]`,
    );

    const reader = createEventStream().body!.getReader();
    await reader.read();

    const subscriptionPool = new SubscriptionPool();
    const reportSpy = vi.spyOn(subscriptionPool, 'reportOutput');
    const pool = createPool({ delegateScript, subscriptionPool });
    await pool.start();

    const job = await manager.run('frontend', makeTask(42, 'frontend'));
    expect(job.state).toBe('completed');
    expect(job.attemptsMade).toBe(0);
    expect(reportSpy).toHaveBeenCalled();
    expect((await readFile(callsFile, 'utf8')).trim().split('\n')).toEqual([
      'agy',
      'claude',
    ]);
    expect(getState().agents.agy.status).toBe('cooldown');

    const frame = await reader.read();
    expect(new TextDecoder().decode(frame.value)).toContain(
      '"event":"SUBSCRIPTION_FAILOVER"',
    );
    await reader.cancel();
    await expect
      .poll(async () => (await readHistory()).map((e) => e.event))
      .toEqual(['SUBSCRIPTION_FAILOVER']);

    const reset = new Date(Date.now() + 180_000).toISOString();
    await subscriptionPool.reportRateLimit('claude', reset);
    await expect
      .poll(async () => (await readHistory()).length)
      .toBeGreaterThanOrEqual(3);
    const delayed = await manager.run('frontend', makeTask(43, 'frontend'));
    expect(delayed.state).toBe('delayed');
    expect(delayed.moveToDelayed).toHaveBeenCalledTimes(1);
    await pool.close();

    let loopRuns = 0;
    const limitScript = await makeScript(
      tempDir,
      'echo "Rate limit exceeded"; exit 1',
      'limit.sh',
    );
    const stubbornPool = createPool({
      delegateScript: limitScript,
      subscriptionPool: {
        pick: vi.fn(async () => ({ provider: 'agy' as const })),
        reportOutput: vi.fn(async () => (++loopRuns, true)),
        on: vi.fn(),
        off: vi.fn(),
        close: vi.fn(),
      },
    });
    const fakeJob = manager.addJob('qa', makeTask(44, 'qa'));
    await expect(stubbornPool.processJob('qa', fakeJob)).rejects.toThrow(
      'Rate limit exceeded',
    );
    expect(loopRuns).toBe(2);
  });

  it('records truncated lastError across 3 repair retries (4 attempts) and catches Redis errors', async () => {
    const prompts: string[] = [];
    const body = `echo "noise $(printf '%0.s-' {1..80})"; echo "Fail on $2"; exit 2`;
    const delegateScript = await makeScript(tempDir, body);
    const subscriptionPool = new SubscriptionPool();
    vi.spyOn(subscriptionPool, 'pick')
      .mockRejectedValueOnce(new Error('Redis ECONNREFUSED'))
      .mockImplementation(async () => ({ provider: 'claude' }));

    const errors: unknown[] = [];
    const pool = createPool({
      delegateScript,
      subscriptionPool,
      maxErrorLength: 60,
      onError: (e) => errors.push(e),
      afterProcessExit: (j) => void prompts.push(buildTaskPrompt(j.data)),
    });
    await pool.start();

    const job = await manager.run('backend', makeTask(77, 'backend'));
    expect(errors).toHaveLength(1);
    expect(job.attemptsMade).toBe(4);
    expect(job.state).toBe('failed');
    expect(job.data.lastError).toContain('Fail on');
    expect(prompts.at(-1)).toContain('Vorheriger Versuch fehlgeschlagen');
    expect(truncateError('', 3)).toBe('Process exited with code 3');
    await pool.close();
  });

  it('degrades gracefully when Redis ping rejects or times out after 2s', async () => {
    manager.connection.ping.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const warnings: Error[] = [];
    const onError = (e: unknown) => warnings.push(e as Error);
    const msg = 'Redis nicht erreichbar, V2 deaktiviert';

    expect(await createPool({ onError }).start()).toBe(false);
    expect(warnings[0].message).toContain(msg);

    vi.useFakeTimers();
    manager.connection.ping.mockImplementationOnce(() => new Promise(() => {}));
    const startPromise = createPool({ onError }).start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await startPromise).toBe(false);
    expect(warnings[1].message).toContain(msg);
  });

  it('terminates running child process on close(), awaits worker.close before manager.close, decouples stopServerTail, and derives team status', async () => {
    const pidFile = join(tempDir, 'child.pid');
    const delegateScript = await makeScript(
      tempDir,
      `echo $$ > "${pidFile}"; sleep 30`,
    );
    const pool = await startServerWorkers({
      enabled: true,
      delegateScript,
      queueManager: manager,
      subscriptionPool: new SubscriptionPool(),
      worktreeManager: createMockWorktreeManager(tempDir),
    });
    expect(pool).not.toBeNull();

    void manager.run('backend', makeTask(90, 'backend'));
    await expect.poll(() => readFile(pidFile, 'utf8')).toMatch(/^\d+/);
    const pid = Number((await readFile(pidFile, 'utf8')).trim());

    stopServerTail();
    expect(manager.events).toEqual([]);

    await stopServerWorkers();
    expect(() => process.kill(pid, 0)).toThrow();
    expect(manager.events).toEqual([
      'worker.close:frontend',
      'worker.close:backend',
      'worker.close:qa',
      'manager.close',
    ]);

    const qaQueue = manager.getQueue('qa');
    expect(await deriveTeamStatus(qaQueue)).toBe('idle');
    const j = manager.addJob('qa', makeTask(1, 'qa'));
    j.state = 'active';
    expect(await deriveTeamStatus(qaQueue)).toBe('working');
    j.state = 'delayed';
    j.data.question = {
      id: '1-1',
      issueId: 1,
      team: 'qa',
      question: '?',
      status: 'PENDING',
    };
    expect(await deriveTeamStatus(qaQueue)).toBe('waiting_input');
  });

  it('registers synchronous exit fallback to SIGKILL running children, ignores errors, and unregisters on close', async () => {
    const pidFile = join(tempDir, 'exit-child.pid');
    const delegateScript = await makeScript(
      tempDir,
      `echo $$ > "${pidFile}"; sleep 30`,
      'exit-delegate.sh',
    );
    const pool = createPool({ delegateScript });

    const beforeStart = process.listeners('exit');
    await pool.start();
    const afterStart = process.listeners('exit');
    expect(afterStart.length).toBe(beforeStart.length + 1);

    const poolExitListener = afterStart.find((l) => !beforeStart.includes(l));
    expect(poolExitListener).toBeDefined();

    void manager.run('backend', makeTask(91, 'backend'));
    await expect.poll(() => readFile(pidFile, 'utf8')).toMatch(/^\d+/);
    const pid = Number((await readFile(pidFile, 'utf8')).trim());
    expect(() => process.kill(pid, 0)).not.toThrow();

    const killSpy = vi.spyOn(process, 'kill');

    expect(() => poolExitListener!(0)).not.toThrow();
    expect(killSpy).toHaveBeenCalledWith(-pid, 'SIGKILL');
    expect(() => poolExitListener!(0)).not.toThrow();

    await expect
      .poll(() => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);

    killSpy.mockRestore();

    await pool.close();
    expect(process.listeners('exit')).not.toContain(poolExitListener);
  });

  it('runs worker inside isolated worktree (not on main), commits uncommitted changes, pushes, creates draft PR, records prUrl, and removes worktree on exit 0 (#100)', async () => {
    // 1. Setup temporary git repo with bare origin
    const bareRemoteDir = join(tempDir, 'remote.git');
    const serverRepoDir = join(tempDir, 'server-repo');
    const fakeGhScript = join(tempDir, 'fake-gh.sh');
    const cwdFile = join(tempDir, 'worker-cwd.txt');

    execFileSync('git', ['init', '--bare', '-b', 'main', bareRemoteDir]);
    execFileSync('git', ['init', '-b', 'main', serverRepoDir]);
    execFileSync('git', ['-C', serverRepoDir, 'config', 'user.name', 'Tester']);
    execFileSync('git', [
      '-C',
      serverRepoDir,
      'config',
      'user.email',
      'tester@example.com',
    ]);
    execFileSync('git', [
      '-C',
      serverRepoDir,
      'remote',
      'add',
      'origin',
      bareRemoteDir,
    ]);
    await writeFile(join(serverRepoDir, 'README.md'), '# Main\n');
    execFileSync('git', ['-C', serverRepoDir, 'add', 'README.md']);
    execFileSync('git', ['-C', serverRepoDir, 'commit', '-m', 'initial']);
    execFileSync('git', ['-C', serverRepoDir, 'push', '-u', 'origin', 'main']);

    // Fake gh
    const fakeGhContent = `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  exit 1
fi
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then
  echo "https://github.com/fake-org/agent-hq/pull/100"
  exit 0
fi
exit 1
`;
    await writeFile(fakeGhScript, fakeGhContent);
    await chmod(fakeGhScript, 0o755);

    // Delegate script writes cwd and an uncommitted file
    const delegateScript = await makeScript(
      tempDir,
      `pwd > "${cwdFile}"
       echo "worker result" > worker-file.txt
       exit 0`,
      'delegate-wt.sh',
    );

    const worktreeManager = new GitWorktreeManager({
      repoRoot: serverRepoDir,
      ghBinary: fakeGhScript,
    });

    const pool = createPool({
      delegateScript,
      worktreeManager,
      repoRoot: serverRepoDir,
    });
    await pool.start();

    const task = makeTask(100, 'frontend');
    task.title = 'Worktree Handling Slot';
    const job = await manager.run('frontend', task);

    expect(job.state).toBe('completed');
    expect(job.data.prUrl).toBe(
      'https://github.com/fake-org/agent-hq/pull/100',
    );

    // Verify delegate ran in worktree, NOT in serverRepoDir and NOT on main
    const workerCwd = (await readFile(cwdFile, 'utf8')).trim();
    expect(workerCwd).toContain('.worktrees/feat-100-worktree-handling-slot');
    expect(workerCwd).not.toBe(serverRepoDir);

    // Verify commit by slot
    const commitMsg = execFileSync('git', [
      '-C',
      serverRepoDir,
      'log',
      '-1',
      '--format=%s',
      'feat/100-worktree-handling-slot',
    ])
      .toString()
      .trim();
    expect(commitMsg).toBe('feat(#100): Worktree Handling Slot');

    // Verify pushed to bare remote
    const remoteRef = execFileSync('git', [
      '--git-dir',
      bareRemoteDir,
      'rev-parse',
      'refs/heads/feat/100-worktree-handling-slot',
    ])
      .toString()
      .trim();
    expect(remoteRef).toBeTruthy();

    // Verify worktree was removed
    const wtList = execFileSync('git', [
      '-C',
      serverRepoDir,
      'worktree',
      'list',
    ]).toString();
    expect(wtList).not.toContain('feat-100-worktree-handling-slot');

    await pool.close();
  });

  it('keeps worktree on failure and reuses it on retry (#100)', async () => {
    const bareRemoteDir = join(tempDir, 'remote-fail.git');
    const serverRepoDir = join(tempDir, 'server-repo-fail');
    const fakeGhScript = join(tempDir, 'fake-gh-fail.sh');
    const runsCountFile = join(tempDir, 'runs.txt');

    execFileSync('git', ['init', '--bare', '-b', 'main', bareRemoteDir]);
    execFileSync('git', ['init', '-b', 'main', serverRepoDir]);
    execFileSync('git', ['-C', serverRepoDir, 'config', 'user.name', 'Tester']);
    execFileSync('git', [
      '-C',
      serverRepoDir,
      'config',
      'user.email',
      'tester@example.com',
    ]);
    execFileSync('git', [
      '-C',
      serverRepoDir,
      'remote',
      'add',
      'origin',
      bareRemoteDir,
    ]);
    await writeFile(join(serverRepoDir, 'README.md'), '# Main\n');
    execFileSync('git', ['-C', serverRepoDir, 'add', 'README.md']);
    execFileSync('git', ['-C', serverRepoDir, 'commit', '-m', 'initial']);
    execFileSync('git', ['-C', serverRepoDir, 'push', '-u', 'origin', 'main']);

    const fakeGhContent = `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then exit 1; fi
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then echo "https://github.com/fake-org/agent-hq/pull/200"; exit 0; fi
exit 1
`;
    await writeFile(fakeGhScript, fakeGhContent);
    await chmod(fakeGhScript, 0o755);

    // Fail first run, succeed second run
    const delegateScript = await makeScript(
      tempDir,
      `echo "run" >> "${runsCountFile}"
       RUNS=$(wc -l < "${runsCountFile}")
       if [ "$RUNS" -eq 1 ]; then
         echo "error occurred" >&2
         exit 1
       fi
       echo "fixed" > fixed.txt
       exit 0`,
      'delegate-fail-retry.sh',
    );

    const worktreeManager = new GitWorktreeManager({
      repoRoot: serverRepoDir,
      ghBinary: fakeGhScript,
    });

    const pool = createPool({
      delegateScript,
      worktreeManager,
      repoRoot: serverRepoDir,
    });
    await pool.start();

    const task = makeTask(200, 'backend');
    task.title = 'Retry Test';

    // The manager.run simulates BullMQ retrying until completed or failed
    const job = await manager.run('backend', task);
    expect(job.state).toBe('completed');
    expect(job.attemptsMade).toBe(1); // failed once, succeeded on 2nd attempt
    expect(job.data.prUrl).toBe(
      'https://github.com/fake-org/agent-hq/pull/200',
    );

    // Worktree removed after final success
    const wtList = execFileSync('git', [
      '-C',
      serverRepoDir,
      'worktree',
      'list',
    ]).toString();
    expect(wtList).not.toContain('feat-200-retry-test');

    await pool.close();
  });
});

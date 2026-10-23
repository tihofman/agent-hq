import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
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
import { jobIdForIssue, type TaskPayload, type Team } from '@agent-hq/queue';
import {
  startServerWorkers,
  stopServerTail,
  stopServerWorkers,
} from '../../hooks.server';
import { finalizeWorktree, prepareWorktree } from './git-worktree';
import { readHistory, recordEvent } from './history';
import { answerQuestion, askQuestion, setGhRunner } from './questions';
import { createEventStream } from './sse';
import { parseEvent } from './state';
import { getState, resetStore } from './store';
import { SubscriptionPool } from './subscription-pool';
import {
  DEFAULT_ATTEMPTS,
  DEFAULT_CONCURRENCY,
  WorkerPool,
  buildTaskPrompt,
  deriveTeamStatus,
  extractSessionId,
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
  delayUntil?: number;
  getState: () => Promise<MockJobRecord['state']>;
  promote: ReturnType<typeof vi.fn>;
}

class MockQueueManager implements QueueManagerLike {
  readonly jobs: MockJobRecord[] = [];
  readonly events: string[] = [];
  readonly concurrencies: Partial<Record<Team, number>> = {};
  connection = { ping: vi.fn(async () => 'PONG') };
  private readonly procs: Partial<Record<Team, Processor<TaskPayload>>> = {};

  addJob(team: Team, data: TaskPayload): MockJobRecord {
    const job: MockJobRecord = {
      id: jobIdForIssue(data.issueId),
      data: structuredClone(data) as WorkerTaskPayload,
      state: 'waiting',
      attemptsMade: 0,
      getState: async () => job.state,
      promote: vi.fn(async () => {
        job.state = 'waiting';
      }),
      updateData: vi.fn(async (next: WorkerTaskPayload) => {
        job.data = next;
      }),
      moveToDelayed: vi.fn(async (timestamp: number) => {
        job.delayUntil = timestamp;
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
      job.delayUntil = undefined;
      try {
        await proc(job as unknown as Job<TaskPayload>, `t-${job.id}`);
        if (job.state === 'active') job.state = 'completed';
      } catch (err) {
        const isDelayed =
          err instanceof DelayedError ||
          (err as Error)?.name === 'DelayedError';
        if (isDelayed) {
          job.state =
            job.delayUntil !== undefined && job.delayUntil <= Date.now()
              ? 'waiting'
              : 'delayed';
        } else if (++job.attemptsMade < DEFAULT_ATTEMPTS) job.state = 'waiting';
        else job.state = 'failed';
      }
    }
    return job;
  }

  getQueue(team: Team): Queue<TaskPayload> {
    const getJobs = async (t: string[] = ['active', 'delayed', 'waiting']) =>
      this.jobs.filter((j) => j.data.team === team && t.includes(j.state));
    const getJob = async (jobId: string) =>
      this.jobs.find(
        (j) =>
          j.id === jobId ||
          j.id === String(j.data.issueId) ||
          jobIdForIssue(j.data.issueId) === jobId,
      );
    return { getJobs, getJob } as unknown as Queue<TaskPayload>;
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

  const createPool = (opts: WorkerPoolOptions = {}) =>
    new WorkerPool({
      enabled: true,
      queueManager: manager,
      subscriptionPool: new SubscriptionPool(),
      logDir: tempDir,
      repoRoot: tempDir,
      prepareWorktree:
        opts.prepareWorktree ??
        vi.fn(async (_ctx, payload) => ({
          worktreePath: tempDir,
          branch: `feat/${payload.issueId}-test`,
          slug: 'test',
        })),
      finalizeWorktree:
        opts.finalizeWorktree ??
        vi.fn(async () => ({
          prUrl: 'https://github.com/fake-org/fake-repo/pull/123',
        })),
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
    setGhRunner(async () => '');
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
      repoRoot: tempDir,
      prepareWorktree: vi.fn(async () => ({
        worktreePath: tempDir,
        branch: 'feat/90-test',
        slug: 'test',
      })),
      finalizeWorktree: vi.fn(async () => ({
        prUrl: 'https://github.com/fake-org/fake-repo/pull/123',
      })),
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

  describe('Prompt-Baustein and Question handling (#101)', () => {
    it('extracts session ID for codex, agy, and claude outputs', () => {
      const codexOut =
        'Starting...\nsession id: 12345678-1234-1234-1234-123456789012\nDone';
      expect(extractSessionId(codexOut)).toBe(
        '12345678-1234-1234-1234-123456789012',
      );

      const agyOut = '>>> agy init session: conv-xyz-456\nWorking...';
      expect(extractSessionId(agyOut)).toBe('conv-xyz-456');

      expect(extractSessionId('no session here')).toBeUndefined();
    });

    it('buildTaskPrompt loads scripts/prompts/hq-ask.md with literal path and logs a warning when missing', async () => {
      const promptDir = join(tempDir, 'prompts');
      await mkdir(promptDir, { recursive: true });
      const promptFile = join(promptDir, 'hq-ask.md');
      await writeFile(
        promptFile,
        'Use {{HQ_ASK}} "<Frage>" to ask question.\nImportant: exit immediately!',
      );

      const fakeDelegate = join(tempDir, 'delegate.sh');
      const payload = makeTask(101, 'frontend');

      const prompt = buildTaskPrompt(payload, fakeDelegate);
      expect(prompt).toContain(join(tempDir, 'hq-ask.sh'));
      expect(prompt).not.toContain('{{HQ_ASK}}');
      expect(prompt).toContain('Important: exit immediately!');

      // Also verify real scripts/prompts/hq-ask.md from repo
      const realPrompt = buildTaskPrompt(payload);
      expect(realPrompt).toContain('/scripts/hq-ask.sh');
      expect(realPrompt).not.toContain('{{HQ_ASK}}');

      // Missing prompt file logs warning instead of silently returning empty
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const missingDelegate = join(tempDir, 'missing-dir', 'delegate.sh');
      const promptFallback = buildTaskPrompt(payload, missingDelegate);
      expect(promptFallback).toBe(`Ticket #101: Feature #101\n\nBody #101`);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Prompt template missing'),
      );
      warnSpy.mockRestore();
    });

    it('buildTaskPrompt includes question and answer if answered without sessionId', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const payload: TaskPayload = {
        ...makeTask(101, 'frontend'),
        question: {
          id: '101-1',
          issueId: 101,
          team: 'frontend',
          question: 'Tabs or spaces?',
          status: 'ANSWERED',
          answer: 'Spaces',
        },
      };

      const prompt = buildTaskPrompt(
        payload,
        join(tempDir, 'missing', 'delegate.sh'),
      );
      expect(prompt).toContain('Frage: Tabs or spaces?');
      expect(prompt).toContain('Antwort: Spaces');
      warnSpy.mockRestore();
    });

    it('delays job, saves { sessionId, provider } only when question is asked, and does not finalize worktree while paused', async () => {
      const sessionId = '11111111-2222-3333-4444-555555555555';
      const delegateScript = await makeScript(
        tempDir,
        `echo "session id: ${sessionId}"; exit 0`,
        'q-delegate.sh',
      );
      const finalizeSpy = vi.fn(async () => ({
        prUrl: 'https://github.com/fake-org/fake-repo/pull/105',
      }));

      const pool = createPool({
        delegateScript,
        queueManager: manager,
        subscriptionPool: new SubscriptionPool(),
        finalizeWorktree: finalizeSpy,
        afterProcessExit: (j) => {
          if (j.data.issueId === 105) {
            j.data.question = {
              id: '105-1',
              issueId: 105,
              team: 'frontend',
              question: 'Wait for user?',
              status: 'PENDING',
            };
          }
        },
      });
      await pool.start();

      // Job 105 asks a question -> delayed, sessionId + provider saved, finalizeWorktree NOT called
      const pausedJob = await manager.run(
        'frontend',
        makeTask(105, 'frontend'),
      );
      expect(pausedJob.state).toBe('delayed');
      expect(pausedJob.data.sessionId).toBe(sessionId);
      expect(pausedJob.data.provider).toBe('agy');
      expect(finalizeSpy).not.toHaveBeenCalled();

      // Job 109 completes without a question -> sessionId and provider are NOT saved
      const normalJob = await manager.run(
        'frontend',
        makeTask(109, 'frontend'),
      );
      expect(normalJob.state).toBe('completed');
      expect(normalJob.data.sessionId).toBeUndefined();
      expect(normalJob.data.provider).toBeUndefined();
      expect(finalizeSpy).toHaveBeenCalledTimes(1);

      await pool.close();
    });

    it('handles grace-period race: when question is answered while job is still active, moves to delayed(now) and immediately re-enters with answer', async () => {
      const sessionId = '22222222-3333-4444-5555-666666666666';
      const callsFile = join(tempDir, 'race-calls.jsonl');
      const delegateScript = await makeScript(
        tempDir,
        `jq -nc --arg p "$2" --arg s "\${HQ_SESSION_ID:-}" '{prompt:$p,hq_session:$s}' >> "${callsFile}"
         echo "session id: ${sessionId}"
         exit 0`,
        'race-delegate.sh',
      );
      const finalizeSpy = vi.fn(async () => ({
        prUrl: 'https://github.com/fake-org/fake-repo/pull/110',
      }));

      let runs = 0;
      const pool = createPool({
        delegateScript,
        queueManager: manager,
        subscriptionPool: new SubscriptionPool(),
        finalizeWorktree: finalizeSpy,
        afterProcessExit: async (j) => {
          runs++;
          if (runs === 1) {
            // Simulate worker having asked a question and user answering during grace period (while job is still active)
            await askQuestion({
              issueId: j.data.issueId,
              team: j.data.team,
              question: 'Race question?',
            });
            await answerQuestion(`${j.data.issueId}-1`, 'Fast user answer');
            const fresh = await manager
              .getQueue(j.data.team)
              .getJob(jobIdForIssue(j.data.issueId));
            if (fresh?.data) j.data = fresh.data;
          }
        },
      });
      await pool.start();

      const job = await manager.run('frontend', makeTask(110, 'frontend'));
      expect(job.state).toBe('completed');
      expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
      // Verify moveToDelayed was called with now (not +7 days)
      const delayTimestamp = vi.mocked(job.moveToDelayed).mock.calls[0][0];
      expect(delayTimestamp).toBeLessThanOrEqual(Date.now());

      const calls = (await readFile(callsFile, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(calls).toHaveLength(2);
      expect(calls[0].hq_session).toBe('');
      expect(calls[1]).toEqual({
        prompt: 'Fast user answer',
        hq_session: sessionId,
      });
      expect(finalizeSpy).toHaveBeenCalledTimes(1);
      expect(job.data.sessionId).toBeUndefined();
      expect(job.data.provider).toBeUndefined();

      await pool.close();
    });

    it('immediately re-delays active job if question is still pending without running delegate', async () => {
      const markerFile = join(tempDir, 'should-not-run.txt');
      const delegateScript = await makeScript(
        tempDir,
        `touch "${markerFile}"; exit 0`,
        'no-run.sh',
      );

      const pool = createPool({
        delegateScript,
        queueManager: manager,
        subscriptionPool: new SubscriptionPool(),
      });
      await pool.start();

      const task = makeTask(106, 'frontend');
      task.question = {
        id: '106-1',
        issueId: 106,
        team: 'frontend',
        question: 'Still waiting?',
        status: 'PENDING',
      };

      const job = await manager.run('frontend', task);
      expect(job.state).toBe('delayed');
      expect(existsSync(markerFile)).toBe(false);

      await pool.close();
    });

    it('terminates worker process after grace period when question is asked and process does not exit', async () => {
      const pidFile = join(tempDir, 'grace-child.pid');
      const delegateScript = await makeScript(
        tempDir,
        `echo $$ > "${pidFile}"; sleep 30`,
        'grace-delegate.sh',
      );

      const pool = createPool({
        delegateScript,
        queueManager: manager,
        subscriptionPool: new SubscriptionPool(),
        questionGracePeriodMs: 50,
      });
      await pool.start();

      const task = makeTask(107, 'backend');
      const runPromise = manager.run('backend', task);

      await expect.poll(() => readFile(pidFile, 'utf8')).toMatch(/^\d+/);
      const pid = Number((await readFile(pidFile, 'utf8')).trim());
      expect(() => process.kill(pid, 0)).not.toThrow();

      // Trigger QUESTION_PENDING for this issue and mark question on job
      const job = manager.jobs.find((j) => j.data.issueId === 107)!;
      job.data.question = {
        id: '107-1',
        issueId: 107,
        team: 'backend',
        question: 'Need input?',
        status: 'PENDING',
      };

      const ev = parseEvent({
        event: 'QUESTION_PENDING',
        data: {
          questionId: '107-1',
          issueId: 107,
          team: 'backend',
          question: 'Need input?',
        },
      });
      await recordEvent(ev);

      // Child should be terminated by pool after 50ms grace period
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

      const finishedJob = await runPromise;
      expect(finishedJob.state).toBe('delayed');

      await pool.close();
    });

    it('resumes session only with same provider, passes HQ_SESSION_ID (not SESSION), clears session after continuation so repair retries run normally, and falls back when provider is in cooldown', async () => {
      const callsFile = join(tempDir, 'resume-calls.jsonl');
      const delegateScript = await makeScript(
        tempDir,
        `jq -nc --arg a "$1" --arg p "$2" --arg s "\${SESSION:-}" --arg h "\${HQ_SESSION_ID:-}" '{agent:$a,prompt:$p,session:$s,hq_session:$h}' >> "${callsFile}"
         if [ "\${FAIL_ONCE:-0}" = "1" ] && [ "$(wc -l < "${callsFile}")" -eq 1 ]; then
           echo "compile error" >&2
           exit 1
         fi
         exit 0`,
        'resume-delegate.sh',
      );

      const subscriptionPool = new SubscriptionPool();
      const pool = createPool({
        delegateScript,
        queueManager: manager,
        subscriptionPool,
        env: { ...process.env, FAIL_ONCE: '1' },
      });
      await pool.start();

      // 1. Resumed run fails on attempt 1 -> sessionId cleared -> attempt 2 (repair retry) runs with full prompt + lastError + question/answer
      const task1: TaskPayload = {
        ...makeTask(108, 'frontend'),
        sessionId: 'session-prev-123',
        provider: 'agy',
        question: {
          id: '108-1',
          issueId: 108,
          team: 'frontend',
          question: 'Confirm?',
          status: 'ANSWERED',
          answer: 'Confirmed by user',
        },
      };

      const job1 = await manager.run('frontend', task1);
      expect(job1.state).toBe('completed');
      expect(job1.attemptsMade).toBe(1);
      expect(job1.data.sessionId).toBeUndefined();
      expect(job1.data.provider).toBeUndefined();

      const calls1 = (await readFile(callsFile, 'utf8'))
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      expect(calls1).toHaveLength(2);
      expect(calls1[0]).toEqual({
        agent: 'agy',
        prompt: 'Confirmed by user',
        session: '',
        hq_session: 'session-prev-123',
      });
      expect(calls1[1].hq_session).toBe('');
      expect(calls1[1].prompt).toContain('Ticket #108: Feature #108');
      expect(calls1[1].prompt).toContain('Vorheriger Versuch fehlgeschlagen');
      expect(calls1[1].prompt).toContain('Frage: Confirm?');
      expect(calls1[1].prompt).toContain('Antwort: Confirmed by user');

      // 2. When saved provider (agy) is in cooldown, falls back to claude with fresh run (full prompt, no HQ_SESSION_ID)
      await writeFile(callsFile, '');
      await subscriptionPool.reportRateLimit(
        'agy',
        new Date(Date.now() + 60_000).toISOString(),
      );
      const task2: TaskPayload = {
        ...makeTask(111, 'frontend'),
        sessionId: 'session-agy-999',
        provider: 'agy',
        question: {
          id: '111-1',
          issueId: 111,
          team: 'frontend',
          question: 'Use Redis?',
          status: 'ANSWERED',
          answer: 'Yes, use Redis',
        },
      };
      const poolOk = createPool({
        delegateScript,
        queueManager: manager,
        subscriptionPool,
      });
      await poolOk.start();
      const job2 = await manager.run('frontend', task2);
      expect(job2.state).toBe('completed');
      const calls2 = (await readFile(callsFile, 'utf8'))
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      expect(calls2).toHaveLength(1);
      expect(calls2[0].agent).toBe('claude');
      expect(calls2[0].hq_session).toBe('');
      expect(calls2[0].prompt).toContain('Ticket #111: Feature #111');
      expect(calls2[0].prompt).toContain('Frage: Use Redis?');
      expect(calls2[0].prompt).toContain('Antwort: Yes, use Redis');

      await pool.close();
      await poolOk.close();
    });

    it('loads open questions from delayed jobs into state on pool.start() after server restart', async () => {
      const delayedJob = manager.addJob('backend', {
        ...makeTask(112, 'backend'),
        question: {
          id: '112-1',
          issueId: 112,
          team: 'backend',
          question: 'Persisted across restart?',
          options: ['Yes', 'No'],
          status: 'PENDING',
        },
      });
      delayedJob.state = 'delayed';

      resetStore();
      expect(getState().questions).toEqual({});

      const pool = createPool();
      await pool.start();

      expect(getState().questions?.['112-1']).toEqual({
        id: '112-1',
        issueId: 112,
        team: 'backend',
        question: 'Persisted across restart?',
        options: ['Yes', 'No'],
        status: 'PENDING',
      });

      await pool.close();
    });
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

    const pool = createPool({
      delegateScript,
      repoRoot: serverRepoDir,
      ghBinary: fakeGhScript,
      prepareWorktree,
      finalizeWorktree,
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

    const pool = createPool({
      delegateScript,
      repoRoot: serverRepoDir,
      ghBinary: fakeGhScript,
      prepareWorktree,
      finalizeWorktree,
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

  it('resolves delegateScript to an absolute path so it is never resolved relative to worktree cwd (#100)', async () => {
    await makeScript(
      tempDir,
      `echo "executed from $(pwd)" > execution.txt
       exit 0`,
      'relative-delegate.sh',
    );
    const isolatedWorktree = join(tempDir, 'sub-wt');
    await mkdir(isolatedWorktree, { recursive: true });

    const pool = createPool({
      cwd: tempDir,
      delegateScript: 'relative-delegate.sh',
      prepareWorktree: vi.fn(async () => ({
        worktreePath: isolatedWorktree,
        branch: 'feat/300-test',
        slug: 'test',
      })),
      finalizeWorktree: vi.fn(async () => ({
        prUrl: 'https://github.com/fake-org/agent-hq/pull/300',
      })),
    });
    await pool.start();

    const task = makeTask(300, 'frontend');
    const job = await manager.run('frontend', task);

    expect(job.state).toBe('completed');
    const executedOutput = (
      await readFile(join(isolatedWorktree, 'execution.txt'), 'utf8')
    ).trim();
    expect(executedOutput).toContain(isolatedWorktree);
    await pool.close();
  });
});

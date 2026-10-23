import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
import { readHistory, recordEvent } from './history';
import { parseEvent } from './state';
import { createEventStream } from './sse';
import { getState, resetStore } from './store';
import { SubscriptionPool } from './subscription-pool';
import {
  DEFAULT_ATTEMPTS,
  DEFAULT_CONCURRENCY,
  WorkerPool,
  buildTaskPrompt,
  extractSessionId,
  loadHqAskPrompt,
  deriveTeamStatus,
  isV2WorkersEnabled,
  truncateError,
  type QueueManagerLike,
  type WorkerJob,
  type WorkerPoolOptions,
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
      data: structuredClone(data),
      state: 'waiting',
      attemptsMade: 0,
      updateData: vi.fn(async (next: TaskPayload) => {
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
    const getJob = async (jobId: string) =>
      this.jobs.find((j) => j.id === jobId || j.id === String(j.data.issueId));
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

    it('buildTaskPrompt includes hq-ask block with literal path when file exists, falls back cleanly when missing', async () => {
      const promptDir = join(tempDir, 'prompts');
      await mkdir(promptDir, { recursive: true });
      const promptFile = join(promptDir, 'hq-ask.md');
      await writeFile(
        promptFile,
        'Use {{HQ_ASK}} "<Frage>" to ask question.\nImportant: exit immediately!',
      );

      const fakeDelegate = join(tempDir, 'delegate.sh');
      const payload = makeTask(101, 'frontend');

      // With prompt fixture
      expect(loadHqAskPrompt(promptFile, join(tempDir, 'hq-ask.sh'))).toContain(
        join(tempDir, 'hq-ask.sh'),
      );
      const prompt = buildTaskPrompt(payload, {
        delegateScript: fakeDelegate,
        promptTemplatePath: promptFile,
      });
      expect(prompt).toContain(join(tempDir, 'hq-ask.sh'));
      expect(prompt).not.toContain('{{HQ_ASK}}');
      expect(prompt).toContain('Important: exit immediately!');

      // Fallback when missing
      const promptFallback = buildTaskPrompt(payload, {
        delegateScript: fakeDelegate,
        promptTemplatePath: join(tempDir, 'nonexistent.md'),
      });
      expect(promptFallback).toBe(`Ticket #101: Feature #101\n\nBody #101`);
    });

    it('buildTaskPrompt includes question and answer if answered without sessionId', () => {
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

      const prompt = buildTaskPrompt(payload, {
        promptTemplatePath: join(tempDir, 'nonexistent.md'),
      });
      expect(prompt).toContain('Frage: Tabs or spaces?');
      expect(prompt).toContain('Antwort: Spaces');
    });

    it('delays job and saves session ID when question is pending at process exit', async () => {
      const sessionId = '11111111-2222-3333-4444-555555555555';
      const delegateScript = await makeScript(
        tempDir,
        `echo "session id: ${sessionId}"; exit 0`,
        'q-delegate.sh',
      );

      const pool = createPool({
        delegateScript,
        queueManager: manager,
        subscriptionPool: new SubscriptionPool(),
        afterProcessExit: (j) => {
          j.data.question = {
            id: '105-1',
            issueId: 105,
            team: 'frontend',
            question: 'Wait for user?',
            status: 'PENDING',
          };
        },
      });
      await pool.start();

      const task = makeTask(105, 'frontend');

      const job = await manager.run('frontend', task);
      expect(job.state).toBe('delayed');
      expect(job.data.sessionId).toBe(sessionId);

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

    it('resumes session with answer when sessionId is present, passes SESSION env and prompt', async () => {
      const envCaptureFile = join(tempDir, 'captured-env.json');
      const delegateScript = await makeScript(
        tempDir,
        `echo "{\\"prompt\\":\\"$2\\",\\"session\\":\\"\${SESSION:-}\\",\\"hq_session\\":\\"\${HQ_SESSION_ID:-}\\"}" > "${envCaptureFile}"; exit 0`,
        'resume-delegate.sh',
      );

      const pool = createPool({
        delegateScript,
        queueManager: manager,
        subscriptionPool: new SubscriptionPool(),
      });
      await pool.start();

      const task: TaskPayload = {
        ...makeTask(108, 'frontend'),
        sessionId: 'session-prev-123',
        question: {
          id: '108-1',
          issueId: 108,
          team: 'frontend',
          question: 'Confirm?',
          status: 'ANSWERED',
          answer: 'Confirmed by user',
        },
      };

      const job = await manager.run('frontend', task);
      expect(job.state).toBe('completed');

      const captured = JSON.parse(await readFile(envCaptureFile, 'utf8'));
      expect(captured.session).toBe('session-prev-123');
      expect(captured.hq_session).toBe('session-prev-123');
      expect(captured.prompt).toBe('Confirmed by user');

      await pool.close();
    });
  });
});

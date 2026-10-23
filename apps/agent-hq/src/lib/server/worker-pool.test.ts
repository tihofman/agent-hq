import { EventEmitter } from 'node:events';
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
  getAllTeamStatuses,
  getTeamStatus,
  isV2WorkersEnabled,
  truncateError,
  type QueueManagerLike,
} from './worker-pool';

const redisStore = vi.hoisted(() => {
  const values: Record<string, string> = {};
  return {
    values,
    hgetall: vi.fn(async () => ({ ...values })),
    hset: vi.fn(async (_key: string, provider: string, value: string) => {
      values[provider] = value;
      return 1;
    }),
    disconnect: vi.fn(),
  };
});

vi.mock('@agent-hq/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agent-hq/queue')>();
  return {
    ...actual,
    createRedisConnection: vi.fn(() => redisStore),
  };
});

interface MockJobRecord {
  id: string;
  data: TaskPayload;
  state: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed';
  attempts: number;
  attemptsMade: number;
  delayUntil?: number;
  failedReason?: string;
  updateData: ReturnType<typeof vi.fn>;
  moveToDelayed: ReturnType<typeof vi.fn>;
}

class InMemoryTeamQueue extends EventEmitter {
  readonly jobs = new Map<string, MockJobRecord>();
  processor?: Processor<TaskPayload, unknown, string>;
  concurrency = 1;
  private activeCount = 0;
  private readonly pendingIds: string[] = [];
  private drainResolvers: (() => void)[] = [];

  constructor(readonly team: Team) {
    super();
  }

  enqueue(
    payload: TaskPayload,
    opts?: { attempts?: number; id?: string },
  ): MockJobRecord {
    const id = opts?.id ?? String(payload.issueId);
    const existing = this.jobs.get(id);
    if (
      existing &&
      (existing.state === 'waiting' ||
        existing.state === 'active' ||
        existing.state === 'delayed')
    ) {
      return existing;
    }

    const record: MockJobRecord = {
      id,
      data: structuredClone(payload),
      state: 'waiting',
      attempts: opts?.attempts ?? DEFAULT_ATTEMPTS,
      attemptsMade: 0,
      updateData: vi.fn(async (nextData: TaskPayload) => {
        record.data = structuredClone(nextData);
      }),
      moveToDelayed: vi.fn(async (timestamp: number) => {
        record.state = 'delayed';
        record.delayUntil = timestamp;
      }),
    };
    this.jobs.set(id, record);
    this.pendingIds.push(id);
    this.pump();
    return record;
  }

  async getJob(id: string): Promise<MockJobRecord | undefined> {
    return this.jobs.get(id);
  }

  async getActive(): Promise<MockJobRecord[]> {
    return [...this.jobs.values()].filter((j) => j.state === 'active');
  }

  async getDelayed(): Promise<MockJobRecord[]> {
    return [...this.jobs.values()].filter((j) => j.state === 'delayed');
  }

  async getWaiting(): Promise<MockJobRecord[]> {
    return [...this.jobs.values()].filter((j) => j.state === 'waiting');
  }

  pump(): void {
    if (!this.processor) return;
    while (this.activeCount < this.concurrency && this.pendingIds.length > 0) {
      const id = this.pendingIds.shift()!;
      const job = this.jobs.get(id);
      if (!job || job.state !== 'waiting') continue;
      this.activeCount++;
      job.state = 'active';
      void this.runJob(job);
    }
    this.checkIdle();
  }

  private async runJob(job: MockJobRecord): Promise<void> {
    try {
      await this.processor!(
        job as unknown as Job<TaskPayload>,
        `token-${job.id}`,
      );
      if (job.state === 'active') {
        job.state = 'completed';
      }
    } catch (err) {
      if (
        err instanceof DelayedError ||
        (err instanceof Error && err.name === 'DelayedError')
      ) {
        job.state = 'delayed';
      } else {
        job.attemptsMade++;
        const reason = err instanceof Error ? err.message : String(err);
        if (job.attemptsMade < job.attempts) {
          job.state = 'waiting';
          this.pendingIds.push(job.id);
        } else {
          job.state = 'failed';
          job.failedReason = reason;
        }
      }
    } finally {
      this.activeCount--;
      this.pump();
    }
  }

  private checkIdle(): void {
    if (this.activeCount === 0 && this.pendingIds.length === 0) {
      for (const resolve of this.drainResolvers.splice(0)) {
        resolve();
      }
    }
  }

  waitForIdle(): Promise<void> {
    if (this.activeCount === 0 && this.pendingIds.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }
}

class MockQueueManager implements QueueManagerLike {
  readonly queues: Record<Team, InMemoryTeamQueue> = {
    frontend: new InMemoryTeamQueue('frontend'),
    backend: new InMemoryTeamQueue('backend'),
    qa: new InMemoryTeamQueue('qa'),
  };
  readonly workers = new Map<Team, EventEmitter & { concurrency?: number }>();
  connection = {
    status: 'ready',
    ping: vi.fn(async () => 'PONG'),
  };
  closed = false;

  getQueue(team: Team): Queue<TaskPayload> {
    return this.queues[team] as unknown as Queue<TaskPayload>;
  }

  createWorker(
    team: Team,
    processor: Processor<TaskPayload, unknown, string>,
    options?: { concurrency?: number },
  ): Worker<TaskPayload> {
    const queue = this.queues[team];
    queue.concurrency = options?.concurrency ?? 1;
    queue.processor = processor;
    const worker = Object.assign(new EventEmitter(), {
      concurrency: queue.concurrency,
      close: vi.fn(async () => {}),
    });
    this.workers.set(team, worker);
    queue.pump();
    return worker as unknown as Worker<TaskPayload>;
  }

  async waitForAllIdle(): Promise<void> {
    await Promise.all([
      this.queues.frontend.waitForIdle(),
      this.queues.backend.waitForIdle(),
      this.queues.qa.waitForIdle(),
    ]);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function makeTask(
  issueId: number,
  team: Team,
  overrides: Partial<TaskPayload> = {},
): TaskPayload {
  return {
    issueId,
    title: `Implement feature #${issueId}`,
    team,
    body: `Acceptance criteria for #${issueId}`,
    labels: [`team:${team}`, 'agent:agy'],
    ...overrides,
  };
}

async function createFakeDelegateScript(
  dir: string,
  body: string,
): Promise<string> {
  const scriptPath = join(dir, 'fake-delegate.sh');
  await writeFile(
    scriptPath,
    `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`,
    'utf8',
  );
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

describe('WorkerPool (#98)', () => {
  let tempDir: string;
  let originalHqHome: string | undefined;
  let originalLogDir: string | undefined;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    resetStore();
    for (const key of Object.keys(redisStore.values)) {
      delete redisStore.values[key];
    }
    vi.clearAllMocks();

    tempDir = await mkdtemp(join(tmpdir(), 'agent-hq-worker-pool-'));
    originalHqHome = process.env.AGENT_HQ_HOME;
    originalLogDir = process.env.AGENT_HQ_LOG_DIR;
    originalFlag = process.env.AGENT_HQ_V2_WORKERS;

    process.env.AGENT_HQ_HOME = tempDir;
    process.env.AGENT_HQ_LOG_DIR = join(tempDir, 'logs');
    delete process.env.AGENT_HQ_V2_WORKERS;
  });

  afterEach(async () => {
    resetStore();
    if (originalHqHome === undefined) delete process.env.AGENT_HQ_HOME;
    else process.env.AGENT_HQ_HOME = originalHqHome;

    if (originalLogDir === undefined) delete process.env.AGENT_HQ_LOG_DIR;
    else process.env.AGENT_HQ_LOG_DIR = originalLogDir;

    if (originalFlag === undefined) delete process.env.AGENT_HQ_V2_WORKERS;
    else process.env.AGENT_HQ_V2_WORKERS = originalFlag;

    await rm(tempDir, { recursive: true, force: true });
  });

  it('keeps execution disabled when feature flag AGENT_HQ_V2_WORKERS is off', async () => {
    expect(isV2WorkersEnabled({})).toBe(false);
    expect(isV2WorkersEnabled({ AGENT_HQ_V2_WORKERS: '0' })).toBe(false);
    expect(isV2WorkersEnabled({ AGENT_HQ_V2_WORKERS: '1' })).toBe(true);
    expect(isV2WorkersEnabled({ AGENT_HQ_V2_WORKERS: 'true' })).toBe(true);

    const callsFile = join(tempDir, 'calls.log');
    const script = await createFakeDelegateScript(
      tempDir,
      `echo "$1" >> "${callsFile}"`,
    );
    const manager = new MockQueueManager();
    const pool = new WorkerPool({
      env: {},
      delegateScript: script,
      queueManager: manager,
    });

    expect(pool.enabled).toBe(false);
    expect(await pool.start()).toBe(false);
    expect(manager.workers.size).toBe(0);

    const job = manager.queues.frontend.enqueue(makeTask(1, 'frontend'));
    await pool.processJob('frontend', job as unknown as Job<TaskPayload>);
    await expect(readFile(callsFile, 'utf8')).rejects.toThrow();
  });

  it('enforces max 4 concurrent runs across pool, per-team concurrency (2/1/1), and single-flight per job', async () => {
    const eventsFile = join(tempDir, 'concurrency.jsonl');
    const script = await createFakeDelegateScript(
      tempDir,
      `
provider="$1"
prompt="$2"
jq -nc --arg ev "start" --arg team "\${HQ_TEAM}" --arg issue "\${HQ_ISSUE_ID}" --arg model "\${AGENT_MODEL}" --arg prov "$provider" '{ev:$ev,team:$team,issue:$issue,model:$model,provider:$prov}' >> "${eventsFile}"
sleep 0.12
jq -nc --arg ev "end" --arg team "\${HQ_TEAM}" --arg issue "\${HQ_ISSUE_ID}" '{ev:$ev,team:$team,issue:$issue}' >> "${eventsFile}"
`,
    );

    const manager = new MockQueueManager();
    const pool = new WorkerPool({
      enabled: true,
      delegateScript: script,
      queueManager: manager,
      subscriptionPool: new SubscriptionPool(),
      logDir: join(tempDir, 'logs'),
    });

    expect(pool.concurrency).toEqual(DEFAULT_CONCURRENCY);
    expect(pool.totalSlots).toBe(4);
    expect(await pool.start()).toBe(true);

    // Enqueue 6 jobs across teams: 3 frontend (limit 2), 2 backend (limit 1), 1 qa (limit 1)
    manager.queues.frontend.enqueue(makeTask(101, 'frontend'));
    manager.queues.frontend.enqueue(makeTask(102, 'frontend'));
    manager.queues.frontend.enqueue(makeTask(103, 'frontend'));
    manager.queues.backend.enqueue(makeTask(201, 'backend'));
    manager.queues.backend.enqueue(makeTask(202, 'backend'));
    manager.queues.qa.enqueue(makeTask(301, 'qa'));

    await manager.waitForAllIdle();

    const lines = (await readFile(eventsFile, 'utf8'))
      .trim()
      .split('\n')
      .map(
        (l) =>
          JSON.parse(l) as {
            ev: 'start' | 'end';
            team: Team;
            issue: string;
            model?: string;
            provider?: string;
          },
      );

    let activeTotal = 0;
    let maxTotal = 0;
    const activeByTeam: Record<Team, number> = {
      frontend: 0,
      backend: 0,
      qa: 0,
    };
    const maxByTeam: Record<Team, number> = {
      frontend: 0,
      backend: 0,
      qa: 0,
    };
    const activeByIssue = new Set<string>();
    let duplicateConcurrentIssue = false;

    for (const item of lines) {
      if (item.ev === 'start') {
        activeTotal++;
        activeByTeam[item.team]++;
        maxTotal = Math.max(maxTotal, activeTotal);
        maxByTeam[item.team] = Math.max(
          maxByTeam[item.team],
          activeByTeam[item.team],
        );
        if (activeByIssue.has(item.issue)) {
          duplicateConcurrentIssue = true;
        }
        activeByIssue.add(item.issue);
        expect(item.model).toBeTruthy();
      } else {
        activeTotal--;
        activeByTeam[item.team]--;
        activeByIssue.delete(item.issue);
      }
    }

    expect(maxTotal).toBe(4);
    expect(maxByTeam.frontend).toBe(2);
    expect(maxByTeam.backend).toBe(1);
    expect(maxByTeam.qa).toBe(1);
    expect(duplicateConcurrentIssue).toBe(false);

    // Also verify direct concurrent invocation of the same job is serialized (never runs twice at once)
    const sameJob = manager.queues.backend.enqueue(makeTask(999, 'backend'));
    let activeSame = 0;
    let maxSame = 0;
    const checkScript = await createFakeDelegateScript(tempDir, 'sleep 0.08');
    const singlePool = new WorkerPool({
      enabled: true,
      concurrency: { frontend: 2, backend: 2, qa: 1 },
      delegateScript: checkScript,
      subscriptionPool: new SubscriptionPool(),
      afterProcessExit: async () => {
        activeSame++;
        maxSame = Math.max(maxSame, activeSame);
        await new Promise((r) => setTimeout(r, 30));
        activeSame--;
      },
    });
    await Promise.all([
      singlePool.processJob('backend', sameJob as unknown as Job<TaskPayload>),
      singlePool.processJob('backend', sameJob as unknown as Job<TaskPayload>),
    ]);
    expect(maxSame).toBe(1);

    await singlePool.close();
    await pool.close();
  });

  it('restarts immediately with fallback provider on rate-limit without counting as a retry, and emits SUBSCRIPTION_FAILOVER to state, SSE, and history', async () => {
    const callsFile = join(tempDir, 'ratelimit-calls.jsonl');
    const script = await createFakeDelegateScript(
      tempDir,
      `
provider="$1"
prompt="$2"
jq -nc --arg p "$provider" --arg m "\${AGENT_MODEL}" --arg pr "$prompt" '{provider:$p,model:$m,prompt:$pr}' >> "${callsFile}"
if [ "$provider" = "agy" ]; then
  echo "You have exhausted your quota on this model. Retry-After: 60"
  exit 1
fi
echo "Completed with fallback $provider"
exit 0
`,
    );

    const sseResponse = createEventStream();
    const reader = sseResponse.body!.getReader();
    const decoder = new TextDecoder();
    // Read initial INIT_STATE frame
    await reader.read();

    const manager = new MockQueueManager();
    const subPool = new SubscriptionPool();
    const reportSpy = vi.spyOn(subPool, 'reportRateLimit');

    const pool = new WorkerPool({
      enabled: true,
      delegateScript: script,
      queueManager: manager,
      subscriptionPool: subPool,
      logDir: join(tempDir, 'logs'),
    });
    await pool.start();

    const job = manager.queues.frontend.enqueue(makeTask(42, 'frontend'));
    await manager.waitForAllIdle();

    // Job succeeded on the first BullMQ attempt (0 failed retries)
    expect(job.state).toBe('completed');
    expect(job.attemptsMade).toBe(0);
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0][0]).toBe('agy');

    const calls = (await readFile(callsFile, 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { provider: string; model: string });
    expect(calls.map((c) => c.provider)).toEqual(['agy', 'claude']);

    // Verify State Machine updated
    expect(getState().agents.agy.status).toBe('cooldown');
    expect(getState().agents.agy.room).toBe('lounge');

    // Verify SSE stream received SUBSCRIPTION_FAILOVER
    const sseFrame = await reader.read();
    const sseText = decoder.decode(sseFrame.value);
    expect(sseText).toContain('event: UPDATE');
    expect(sseText).toContain('"event":"SUBSCRIPTION_FAILOVER"');
    expect(sseText).toContain('"from":"agy"');
    expect(sseText).toContain('"to":"claude"');
    await reader.cancel();

    // Verify JSONL history persisted SUBSCRIPTION_FAILOVER
    await expect
      .poll(async () => (await readHistory()).map((e) => e.event))
      .toContain('SUBSCRIPTION_FAILOVER');

    await pool.close();
  });

  it('delays the job until earliest provider reset when all team providers are in cooldown', async () => {
    const script = await createFakeDelegateScript(
      tempDir,
      `
echo "Rate limit exceeded. Retry-After: 120"
exit 1
`,
    );

    const manager = new MockQueueManager();
    const subPool = new SubscriptionPool();
    // Put claude in cooldown until +180s, agy will hit rate limit with +120s during the run
    const baseMs = Date.now();
    const claudeReset = new Date(baseMs + 180_000).toISOString();
    await subPool.reportRateLimit('claude', claudeReset);

    const pool = new WorkerPool({
      enabled: true,
      delegateScript: script,
      queueManager: manager,
      subscriptionPool: subPool,
      logDir: join(tempDir, 'logs'),
    });
    await pool.start();

    const job = manager.queues.frontend.enqueue(makeTask(55, 'frontend'));
    await manager.waitForAllIdle();

    expect(job.state).toBe('delayed');
    expect(job.attemptsMade).toBe(0);
    expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
    // Earliest reset between agy (~120s) and claude (180s)
    expect(job.delayUntil!).toBeGreaterThanOrEqual(baseMs + 115_000);
    expect(job.delayUntil!).toBeLessThan(Date.parse(claudeReset));

    await pool.close();
  });

  it('writes truncated error output to job.data.lastError, frees the slot, includes lastError in retry prompts, and marks job failed after 3 repairs (4 attempts total)', async () => {
    const promptsFile = join(tempDir, 'retry-prompts.jsonl');
    const script = await createFakeDelegateScript(
      tempDir,
      `
provider="$1"
prompt="$2"
if [ -f "${promptsFile}" ]; then
  count=$(wc -l < "${promptsFile}" | tr -d ' ')
else
  count=0
fi
count=$((count + 1))
jq -nc --argjson attempt "$count" --arg prompt "$prompt" '{attempt:$attempt,prompt:$prompt}' >> "${promptsFile}"
echo "Padding noise before failure: $(printf '%0.s-' {1..100})"
echo "Test run #$count failed: AssertionError: expected true to be false"
exit 2
`,
    );

    const manager = new MockQueueManager();
    const pool = new WorkerPool({
      enabled: true,
      delegateScript: script,
      queueManager: manager,
      subscriptionPool: new SubscriptionPool(),
      logDir: join(tempDir, 'logs'),
      maxErrorLength: 120,
    });
    await pool.start();

    const job = manager.queues.backend.enqueue(makeTask(77, 'backend'));
    await manager.waitForAllIdle();

    // 1 initial attempt + 3 repair retries = 4 attempts total, then failed
    expect(job.attemptsMade).toBe(4);
    expect(job.state).toBe('failed');
    expect(job.failedReason).toContain(
      'Test run #4 failed: AssertionError: expected true to be false',
    );
    expect(job.data.lastError).toContain(
      'Test run #4 failed: AssertionError: expected true to be false',
    );
    expect(pool.activeSlots).toBe(0);

    const recorded = (await readFile(promptsFile, 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { attempt: number; prompt: string });

    expect(recorded).toHaveLength(4);
    expect(recorded[0].prompt).not.toContain(
      'Vorheriger Versuch fehlgeschlagen',
    );
    expect(recorded[1].prompt).toContain(
      'Test run #1 failed: AssertionError: expected true to be false',
    );
    expect(recorded[2].prompt).toContain(
      'Test run #2 failed: AssertionError: expected true to be false',
    );
    expect(recorded[3].prompt).toContain(
      'Test run #3 failed: AssertionError: expected true to be false',
    );

    expect(truncateError('x'.repeat(200), 1, 50)).toHaveLength(50);
    expect(truncateError('', 3)).toBe('Process exited with code 3');
    expect(
      buildTaskPrompt({
        issueId: 9,
        title: 'Fix bug',
        team: 'qa',
        body: 'Details',
        labels: [],
        lastError: 'Boom',
      }),
    ).toContain('Boom');

    await pool.close();
  });

  it('catches Redis errors from pick/reportRateLimit and fails the job into retry without crashing the server', async () => {
    const script = await createFakeDelegateScript(tempDir, 'exit 0');
    const manager = new MockQueueManager();
    const subPool = new SubscriptionPool();
    const errors: unknown[] = [];

    // First attempt fails in pick() due to Redis error, second attempt succeeds
    vi.spyOn(subPool, 'pick')
      .mockRejectedValueOnce(new Error('Redis ECONNREFUSED'))
      .mockResolvedValue({ provider: 'codex' });

    const pool = new WorkerPool({
      enabled: true,
      delegateScript: script,
      queueManager: manager,
      subscriptionPool: subPool,
      onError: (err) => errors.push(err),
    });
    await pool.start();

    const job = manager.queues.qa.enqueue(makeTask(88, 'qa'));
    await manager.waitForAllIdle();

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toContain('Redis ECONNREFUSED');
    expect(job.attemptsMade).toBe(1);
    expect(job.state).toBe('completed');

    await pool.close();
  });

  it('degrades gracefully when Redis ping fails on start (ADR 0006 Section 5)', async () => {
    const manager = new MockQueueManager();
    manager.connection.ping.mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 127.0.0.1:6379'),
    );
    const warnings: unknown[] = [];

    const pool = new WorkerPool({
      enabled: true,
      queueManager: manager,
      onError: (err) => warnings.push(err),
    });

    expect(await pool.start()).toBe(false);
    expect(warnings).toHaveLength(1);
    expect((warnings[0] as Error).message).toContain('Redis nicht erreichbar');
  });

  it('provides the after-process-exit extension point to inspect job data and pause jobs with pending questions (#101)', async () => {
    const script = await createFakeDelegateScript(
      tempDir,
      'echo "Asking question and exiting"; exit 0',
    );
    const manager = new MockQueueManager();
    const inspected: string[] = [];

    const pool = new WorkerPool({
      enabled: true,
      delegateScript: script,
      queueManager: manager,
      subscriptionPool: new SubscriptionPool(),
      afterProcessExit: async ({ job, provider, output }) => {
        inspected.push(`${provider}:${job.data.issueId}:${output.trim()}`);
      },
    });
    await pool.start();

    const pendingTask = makeTask(101, 'frontend', {
      question: {
        id: '101-1',
        issueId: 101,
        team: 'frontend',
        question: 'Modal or inline?',
        status: 'PENDING',
      },
    });
    const job = manager.queues.frontend.enqueue(pendingTask);
    await manager.waitForAllIdle();

    expect(inspected).toEqual(['agy:101:Asking question and exiting']);
    expect(job.state).toBe('delayed');
    expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
    expect(pool.activeSlots).toBe(0);

    await pool.close();
  });

  it('derives team status idle / working / waiting_input from queue states', async () => {
    expect(deriveTeamStatus([])).toBe('idle');
    expect(
      deriveTeamStatus([{ state: 'waiting', data: makeTask(1, 'frontend') }]),
    ).toBe('idle');
    expect(
      deriveTeamStatus([{ state: 'active', data: makeTask(1, 'frontend') }]),
    ).toBe('working');
    expect(
      deriveTeamStatus([
        { state: 'active', data: makeTask(1, 'frontend') },
        {
          state: 'delayed',
          data: makeTask(2, 'frontend', {
            question: {
              id: '2-1',
              issueId: 2,
              team: 'frontend',
              question: 'Color?',
              status: 'PENDING',
            },
          }),
        },
      ]),
    ).toBe('waiting_input');

    const manager = new MockQueueManager();
    expect(await getAllTeamStatuses(manager.queues)).toEqual({
      frontend: 'idle',
      backend: 'idle',
      qa: 'idle',
    });

    // Simulate an active job in backend and a paused question job in frontend
    const feJob = manager.queues.frontend.enqueue(
      makeTask(10, 'frontend', {
        question: {
          id: '10-1',
          issueId: 10,
          team: 'frontend',
          question: 'Use snippet?',
          status: 'PENDING',
        },
      }),
    );
    feJob.state = 'delayed';

    const beJob = manager.queues.backend.enqueue(makeTask(20, 'backend'));
    beJob.state = 'active';

    expect(await getTeamStatus(manager.queues.frontend)).toBe('waiting_input');
    expect(await getTeamStatus(manager.queues.backend)).toBe('working');
    expect(await getTeamStatus(manager.queues.qa)).toBe('idle');
    expect(await getAllTeamStatuses(manager.queues)).toEqual({
      frontend: 'waiting_input',
      backend: 'working',
      qa: 'idle',
    });
  });
});

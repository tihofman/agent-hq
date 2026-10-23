import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import {
  DelayedError,
  type Job,
  type Processor,
  type Queue,
  type Worker,
  type WorkerOptions,
} from 'bullmq';
import {
  QueueManager,
  getQueueName,
  type TaskPayload,
  type Team,
} from '@agent-hq/queue';
import { recordEvent } from './history';
import { detectRateLimit } from './ratelimit';
import { parseEvent, type Agent } from './state';
import { SubscriptionPool } from './subscription-pool';

export const TEAMS: readonly Team[] = ['frontend', 'backend', 'qa'] as const;

export const DEFAULT_CONCURRENCY: Record<Team, number> = {
  frontend: 2,
  backend: 1,
  qa: 1,
};

export const DEFAULT_MODELS: Record<Agent, string> = {
  agy: 'gemini-3.8-flash-high',
  claude: 'claude-3-7-sonnet',
  codex: 'gpt-6-luna',
};

export const DEFAULT_ATTEMPTS = 4;
export const MAX_ERROR_LENGTH = 2000;
const DEFAULT_QUESTION_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

export type TeamStatus = 'idle' | 'working' | 'waiting_input';

export interface AfterProcessExitContext {
  job: Pick<Job<TaskPayload>, 'id' | 'data' | 'updateData' | 'moveToDelayed'>;
  team: Team;
  provider: Agent;
  exitCode: number;
  output: string;
  token?: string;
}

export type AfterProcessExitResult =
  | { action: 'delay'; until?: number; delayMs?: number }
  | { action: 'complete' }
  | { action: 'continue' }
  | void;

export type JobLike =
  | {
      state?: string;
      data?: Partial<TaskPayload>;
      question?: TaskPayload['question'];
    }
  | Partial<TaskPayload>;

export interface TeamQueueJobsSnapshot {
  active?: readonly JobLike[];
  delayed?: readonly JobLike[];
  waiting?: readonly JobLike[];
}

export interface QueueStatusSource {
  getActive?: () => Promise<readonly JobLike[]>;
  getDelayed?: () => Promise<readonly JobLike[]>;
  getWaiting?: () => Promise<readonly JobLike[]>;
  getJobs?: (
    types?: ('active' | 'delayed' | 'waiting')[] | string,
  ) => Promise<readonly JobLike[]>;
}

export interface QueueManagerLike {
  connection?: {
    ping?: () => Promise<string>;
    status?: string;
  };
  getQueue(team: Team): Queue<TaskPayload>;
  createWorker(
    team: Team,
    processor: Processor<TaskPayload, unknown, string>,
    options?: Partial<WorkerOptions>,
  ): Worker<TaskPayload>;
  close(): Promise<void>;
}

export interface SubscriptionPoolLike {
  pick: SubscriptionPool['pick'];
  reportRateLimit: SubscriptionPool['reportRateLimit'];
  reportOutput?: SubscriptionPool['reportOutput'];
  on: SubscriptionPool['on'];
  off: SubscriptionPool['off'];
  close?: () => void;
}

export interface WorkerPoolOptions {
  enabled?: boolean;
  concurrency?: Partial<Record<Team, number>>;
  models?: Partial<Record<Agent, string>>;
  delegateScript?: string;
  cwd?: string;
  logDir?: string;
  env?: NodeJS.ProcessEnv;
  queueManager?: QueueManagerLike;
  subscriptionPool?: SubscriptionPoolLike;
  afterProcessExit?: (
    ctx: AfterProcessExitContext,
  ) => Promise<AfterProcessExitResult> | AfterProcessExitResult;
  onError?: (err: unknown) => void;
  maxErrorLength?: number;
  now?: () => Date;
}

class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  get activeCount(): number {
    return this.active;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
    } else {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) {
        next();
      } else {
        this.active--;
      }
    };
  }
}

export function isV2WorkersEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.AGENT_HQ_V2_WORKERS?.trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

export function buildTaskPrompt(payload: TaskPayload): string {
  const sections = [`Ticket #${payload.issueId}: ${payload.title}`];
  if (payload.body?.trim()) {
    sections.push(payload.body.trim());
  }
  if (payload.lastError?.trim()) {
    sections.push(
      `Vorheriger Versuch fehlgeschlagen:\n${payload.lastError.trim()}`,
    );
  }
  return sections.join('\n\n');
}

export function truncateError(
  output: string,
  exitCode: number | null,
  maxLength = MAX_ERROR_LENGTH,
): string {
  const cleaned = stripVTControlCharacters(output).trim();
  if (!cleaned) {
    return `Process exited with code ${exitCode ?? 1}`;
  }
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `...${cleaned.slice(-(maxLength - 3))}`;
}

function hasPendingQuestion(item: JobLike): boolean {
  if (!item || typeof item !== 'object') return false;
  const data =
    'data' in item && item.data && typeof item.data === 'object'
      ? item.data
      : (item as Partial<TaskPayload>);
  return data.question?.status === 'PENDING';
}

export function deriveTeamStatus(
  input: readonly JobLike[] | TeamQueueJobsSnapshot,
): TeamStatus {
  if (Array.isArray(input)) {
    const relevant = input.filter((job) => {
      const state =
        job && typeof job === 'object' && 'state' in job
          ? job.state
          : undefined;
      return state !== 'completed' && state !== 'failed';
    });
    if (relevant.some(hasPendingQuestion)) {
      return 'waiting_input';
    }
    if (
      relevant.some(
        (job) =>
          job &&
          typeof job === 'object' &&
          'state' in job &&
          job.state === 'active',
      )
    ) {
      return 'working';
    }
    return 'idle';
  }

  const snapshot = input as TeamQueueJobsSnapshot;
  const active = snapshot.active ?? [];
  const delayed = snapshot.delayed ?? [];
  const waiting = snapshot.waiting ?? [];
  if (
    active.some(hasPendingQuestion) ||
    delayed.some(hasPendingQuestion) ||
    waiting.some(hasPendingQuestion)
  ) {
    return 'waiting_input';
  }
  if (active.length > 0) {
    return 'working';
  }
  return 'idle';
}

export async function getTeamStatus(
  queue: QueueStatusSource,
  onError?: (err: unknown) => void,
): Promise<TeamStatus> {
  try {
    const active = queue.getActive
      ? await queue.getActive()
      : ((await queue.getJobs?.(['active'])) ?? []);
    const delayed = queue.getDelayed
      ? await queue.getDelayed()
      : ((await queue.getJobs?.(['delayed'])) ?? []);
    const waiting = queue.getWaiting
      ? await queue.getWaiting()
      : ((await queue.getJobs?.(['waiting'])) ?? []);
    return deriveTeamStatus({ active, delayed, waiting });
  } catch (err) {
    onError?.(err);
    return 'idle';
  }
}

export async function getAllTeamStatuses(
  queues: Record<Team, QueueStatusSource>,
  onError?: (err: unknown) => void,
): Promise<Record<Team, TeamStatus>> {
  const [frontend, backend, qa] = await Promise.all([
    getTeamStatus(queues.frontend, onError),
    getTeamStatus(queues.backend, onError),
    getTeamStatus(queues.qa, onError),
  ]);
  return { frontend, backend, qa };
}

export function wireSubscriptionFailover(
  pool: Pick<SubscriptionPoolLike, 'on' | 'off'>,
  onError?: (err: unknown) => void,
): () => void {
  const listener = (failover: {
    team: Team;
    from: Agent;
    to: Agent | null;
    cooldownUntil: string;
  }) => {
    try {
      const event = parseEvent({
        event: 'SUBSCRIPTION_FAILOVER',
        agent: failover.from,
        data: {
          team: failover.team,
          from: failover.from,
          to: failover.to,
          cooldownUntil: failover.cooldownUntil,
        },
      });
      void recordEvent(event).catch((err) => onError?.(err));
    } catch (err) {
      onError?.(err);
    }
  };
  pool.on('SUBSCRIPTION_FAILOVER', listener);
  return () => {
    pool.off('SUBSCRIPTION_FAILOVER', listener);
  };
}

function resolveDefaultDelegateScript(): string {
  if (process.env.AGENT_HQ_DELEGATE_SCRIPT) {
    return process.env.AGENT_HQ_DELEGATE_SCRIPT;
  }
  const direct = resolve(process.cwd(), 'scripts/delegate.sh');
  if (existsSync(direct)) return direct;
  return resolve(process.cwd(), '../../scripts/delegate.sh');
}

function findRateLimitInOutput(
  output: string,
  now: Date,
): { line: string; cooldownUntil?: string } | null {
  let matchedLine: string | undefined;
  let latestCooldownUntil: string | undefined;

  for (const rawLine of output.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const detected = detectRateLimit(rawLine, now);
    if (!detected) continue;
    if (matchedLine === undefined) {
      matchedLine = rawLine;
    }
    if (
      detected.cooldownUntil &&
      (!latestCooldownUntil ||
        Date.parse(detected.cooldownUntil) > Date.parse(latestCooldownUntil))
    ) {
      latestCooldownUntil = detected.cooldownUntil;
      matchedLine = rawLine;
    }
  }

  if (matchedLine === undefined) return null;
  return latestCooldownUntil
    ? { line: matchedLine, cooldownUntil: latestCooldownUntil }
    : { line: matchedLine };
}

function snapshotLogFiles(logDir: string): Map<string, number> {
  const snapshot = new Map<string, number>();
  if (!existsSync(logDir)) return snapshot;
  try {
    for (const entry of readdirSync(logDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.log')) continue;
      const fullPath = join(logDir, entry.name);
      try {
        snapshot.set(entry.name, statSync(fullPath).size);
      } catch {
        // ignore transient file race
      }
    }
  } catch {
    // ignore missing dir
  }
  return snapshot;
}

function readRunLogFiles(
  logDir: string,
  pid: number | undefined,
  before: Map<string, number>,
): string {
  if (!existsSync(logDir)) return '';
  const chunks: string[] = [];
  try {
    const entries = readdirSync(logDir, { withFileTypes: true }).filter(
      (e) => e.isFile() && e.name.endsWith('.log'),
    );
    const pidPattern = pid ? new RegExp(`(?:^|-)${pid}(?:-|$|\\.log$)`) : null;
    const matchedByPid = pidPattern
      ? entries.filter((e) => pidPattern.test(e.name))
      : [];
    const candidates =
      matchedByPid.length > 0
        ? matchedByPid
        : entries.filter((e) => {
            const prevSize = before.get(e.name);
            if (prevSize === undefined) return true;
            try {
              return statSync(join(logDir, e.name)).size > prevSize;
            } catch {
              return false;
            }
          });

    for (const entry of candidates) {
      try {
        const content = readFileSync(join(logDir, entry.name), 'utf8');
        const prevSize =
          matchedByPid.length > 0 ? 0 : (before.get(entry.name) ?? 0);
        chunks.push(prevSize > 0 ? content.slice(prevSize) : content);
      } catch {
        // ignore transient read error
      }
    }
  } catch {
    // ignore read error
  }
  return chunks.join('\n');
}

export class WorkerPool {
  readonly enabled: boolean;
  readonly concurrency: Record<Team, number>;
  readonly totalSlots: number;
  readonly models: Record<Agent, string>;

  private readonly delegateScript: string;
  private readonly cwd: string;
  private readonly logDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly maxErrorLength: number;
  private readonly now: () => Date;
  private readonly onError: (err: unknown) => void;
  private readonly afterProcessExit?: (
    ctx: AfterProcessExitContext,
  ) => Promise<AfterProcessExitResult> | AfterProcessExitResult;

  private queueManager?: QueueManagerLike;
  private readonly ownsQueueManager: boolean;
  private subscriptionPool?: SubscriptionPoolLike;
  private readonly ownsSubscriptionPool: boolean;
  private unwireFailover?: () => void;

  private readonly queues = new Map<Team, Queue<TaskPayload>>();
  private readonly workers = new Map<Team, Worker<TaskPayload>>();
  private readonly teamSemaphores: Record<Team, Semaphore>;
  private readonly poolSemaphore: Semaphore;
  private readonly jobLocks = new Map<string, Promise<void>>();
  private started = false;

  constructor(options: WorkerPoolOptions = {}) {
    this.enabled = options.enabled ?? isV2WorkersEnabled(options.env);
    this.concurrency = {
      frontend: options.concurrency?.frontend ?? DEFAULT_CONCURRENCY.frontend,
      backend: options.concurrency?.backend ?? DEFAULT_CONCURRENCY.backend,
      qa: options.concurrency?.qa ?? DEFAULT_CONCURRENCY.qa,
    };
    for (const team of TEAMS) {
      const value = this.concurrency[team];
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Invalid concurrency for ${team}: ${value}`);
      }
    }
    this.totalSlots =
      this.concurrency.frontend +
      this.concurrency.backend +
      this.concurrency.qa;
    this.models = {
      ...DEFAULT_MODELS,
      ...options.models,
    };

    this.delegateScript =
      options.delegateScript ?? resolveDefaultDelegateScript();
    this.cwd = options.cwd ?? process.cwd();
    this.logDir =
      options.logDir ??
      options.env?.AGENT_HQ_LOG_DIR ??
      process.env.AGENT_HQ_LOG_DIR ??
      join(tmpdir(), 'agent-hq');
    this.env = options.env ?? process.env;
    this.maxErrorLength = options.maxErrorLength ?? MAX_ERROR_LENGTH;
    this.now = options.now ?? (() => new Date());
    this.onError =
      options.onError ??
      ((err: unknown) => {
        console.warn('WorkerPool error:', err);
      });
    this.afterProcessExit = options.afterProcessExit;

    this.queueManager = options.queueManager;
    this.ownsQueueManager = !options.queueManager;
    this.subscriptionPool = options.subscriptionPool;
    this.ownsSubscriptionPool = !options.subscriptionPool;

    this.teamSemaphores = {
      frontend: new Semaphore(this.concurrency.frontend),
      backend: new Semaphore(this.concurrency.backend),
      qa: new Semaphore(this.concurrency.qa),
    };
    this.poolSemaphore = new Semaphore(this.totalSlots);
  }

  get activeSlots(): number {
    return this.poolSemaphore.activeCount;
  }

  getActiveTeamSlots(team: Team): number {
    return this.teamSemaphores[team].activeCount;
  }

  async start(): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    if (this.started) {
      return true;
    }

    try {
      this.queueManager ??= new QueueManager({
        connectionOptions: {
          onError: (err) => this.onError(err),
        },
        queueOptions: {
          defaultJobOptions: { attempts: DEFAULT_ATTEMPTS },
        },
      });

      if (this.queueManager.connection?.ping) {
        try {
          await this.queueManager.connection.ping();
        } catch (err) {
          this.onError(
            new Error(
              `Warnung: Redis nicht erreichbar – V2 Worker-Pool deaktiviert (${err instanceof Error ? err.message : String(err)})`,
            ),
          );
          if (this.ownsQueueManager) {
            await this.queueManager.close().catch(() => {});
            this.queueManager = undefined;
          }
          return false;
        }
      }

      this.subscriptionPool ??= new SubscriptionPool();
      this.unwireFailover = wireSubscriptionFailover(
        this.subscriptionPool,
        this.onError,
      );

      for (const team of TEAMS) {
        const queue = this.queueManager.getQueue(team);
        (
          queue as unknown as {
            on?: (ev: string, fn: (err: unknown) => void) => void;
          }
        ).on?.('error', (err) => this.onError(err));
        this.queues.set(team, queue);

        const worker = this.queueManager.createWorker(
          team,
          (job, token) => this.processJob(team, job, token),
          { concurrency: this.concurrency[team] },
        );
        (
          worker as unknown as {
            on?: (ev: string, fn: (err: unknown) => void) => void;
          }
        ).on?.('error', (err) => this.onError(err));
        this.workers.set(team, worker);
      }

      this.started = true;
      return true;
    } catch (err) {
      this.onError(err);
      await this.close();
      return false;
    }
  }

  async processJob(
    team: Team,
    job: Pick<Job<TaskPayload>, 'id' | 'data' | 'updateData' | 'moveToDelayed'>,
    token?: string,
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const jobKey = `${getQueueName(team)}:${String(job.id ?? job.data.issueId)}`;
    const previousLock = this.jobLocks.get(jobKey);
    if (previousLock) {
      await previousLock.catch(() => {});
    }

    let releaseJobLock!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      releaseJobLock = resolve;
    });
    this.jobLocks.set(jobKey, currentLock);

    let releaseTeamSlot: (() => void) | undefined;
    let releasePoolSlot: (() => void) | undefined;

    try {
      releaseTeamSlot = await this.teamSemaphores[team].acquire();
      releasePoolSlot = await this.poolSemaphore.acquire();

      this.subscriptionPool ??= new SubscriptionPool();
      if (!this.unwireFailover) {
        this.unwireFailover = wireSubscriptionFailover(
          this.subscriptionPool,
          this.onError,
        );
      }

      while (true) {
        let picked: Awaited<ReturnType<SubscriptionPool['pick']>>;
        try {
          picked = await this.subscriptionPool.pick(team);
        } catch (err) {
          this.onError(err);
          throw err instanceof Error ? err : new Error(String(err));
        }

        if (picked.provider === null) {
          const resetAt = Math.max(
            this.now().getTime(),
            Date.parse(picked.cooldownUntil),
          );
          try {
            await job.moveToDelayed(resetAt, token);
          } catch (err) {
            this.onError(err);
            throw err instanceof Error ? err : new Error(String(err));
          }
          throw new DelayedError();
        }

        const provider = picked.provider;
        const prompt = buildTaskPrompt(job.data);
        const model = this.models[provider];

        const { exitCode, output } = await this.runDelegate(
          team,
          provider,
          model,
          prompt,
          job.data,
        );

        const rateLimit = findRateLimitInOutput(output, this.now());
        if (rateLimit) {
          try {
            if (typeof this.subscriptionPool.reportOutput === 'function') {
              await this.subscriptionPool.reportOutput(
                provider,
                rateLimit.line,
              );
            } else {
              await this.subscriptionPool.reportRateLimit(
                provider,
                rateLimit.cooldownUntil,
              );
            }
          } catch (err) {
            this.onError(err);
            throw err instanceof Error ? err : new Error(String(err));
          }
          continue;
        }

        await this.refreshJobData(team, job);
        const exitAction = await this.inspectJobAfterExit({
          job,
          team,
          provider,
          exitCode,
          output,
          token,
        });

        if (exitAction?.action === 'delay') {
          const until =
            exitAction.until ??
            this.now().getTime() +
              (exitAction.delayMs ?? DEFAULT_QUESTION_DELAY_MS);
          await job.moveToDelayed(until, token);
          throw new DelayedError();
        }
        if (exitAction?.action === 'complete') {
          return;
        }

        if (exitCode === 0) {
          return;
        }

        const lastError = truncateError(output, exitCode, this.maxErrorLength);
        job.data = { ...job.data, lastError };
        if (typeof job.updateData === 'function') {
          try {
            await job.updateData(job.data);
          } catch (err) {
            this.onError(err);
          }
        }
        throw new Error(lastError);
      }
    } finally {
      releasePoolSlot?.();
      releaseTeamSlot?.();
      releaseJobLock();
      if (this.jobLocks.get(jobKey) === currentLock) {
        this.jobLocks.delete(jobKey);
      }
    }
  }

  private async refreshJobData(
    team: Team,
    job: Pick<Job<TaskPayload>, 'id' | 'data'>,
  ): Promise<void> {
    const queue = this.queues.get(team) as
      | (Queue<TaskPayload> & {
          getJob?: (id: string) => Promise<{ data?: TaskPayload } | undefined>;
        })
      | undefined;
    if (job.id === undefined || typeof queue?.getJob !== 'function') {
      return;
    }
    try {
      const fresh = await queue.getJob(String(job.id));
      if (fresh?.data) {
        job.data = fresh.data;
      }
    } catch (err) {
      this.onError(err);
    }
  }

  protected async inspectJobAfterExit(
    ctx: AfterProcessExitContext,
  ): Promise<AfterProcessExitResult> {
    if (this.afterProcessExit) {
      const result = await this.afterProcessExit(ctx);
      if (result) return result;
    }
    if (ctx.job.data.question?.status === 'PENDING') {
      return { action: 'delay', delayMs: DEFAULT_QUESTION_DELAY_MS };
    }
    return undefined;
  }

  private runDelegate(
    team: Team,
    provider: Agent,
    model: string,
    prompt: string,
    payload: TaskPayload,
  ): Promise<{ exitCode: number; output: string }> {
    const beforeLogs = snapshotLogFiles(this.logDir);

    return new Promise((resolveRun) => {
      const childEnv: NodeJS.ProcessEnv = {
        ...this.env,
        AGENT_MODEL: model,
        AGENT_HQ_LOG_DIR: this.logDir,
        TICKET_ID: String(payload.issueId),
        TICKET_TITLE: payload.title,
        HQ_ISSUE_ID: String(payload.issueId),
        HQ_TEAM: team,
      };

      let stdout = '';
      let stderr = '';
      let settled = false;

      const child = spawn(this.delegateScript, [provider, prompt], {
        cwd: this.cwd,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });

      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });

      const finish = (exitCode: number, spawnError?: Error) => {
        if (settled) return;
        settled = true;
        const logContent = readRunLogFiles(this.logDir, child.pid, beforeLogs);
        const parts = [stdout, stderr];
        if (logContent && !stdout.includes(logContent.trim())) {
          parts.push(logContent);
        }
        if (spawnError) {
          parts.push(spawnError.message);
        }
        const output = parts.filter(Boolean).join('\n');
        resolveRun({ exitCode, output });
      };

      child.on('error', (err) => {
        finish(1, err);
      });

      child.on('close', (code) => {
        finish(code ?? 1);
      });
    });
  }

  async getTeamStatus(team: Team): Promise<TeamStatus> {
    const queue = this.queues.get(team);
    if (!queue) {
      return this.teamSemaphores[team].activeCount > 0 ? 'working' : 'idle';
    }
    return getTeamStatus(queue as unknown as QueueStatusSource, this.onError);
  }

  async getTeamStatuses(): Promise<Record<Team, TeamStatus>> {
    const [frontend, backend, qa] = await Promise.all([
      this.getTeamStatus('frontend'),
      this.getTeamStatus('backend'),
      this.getTeamStatus('qa'),
    ]);
    return { frontend, backend, qa };
  }

  async close(): Promise<void> {
    this.started = false;
    this.unwireFailover?.();
    this.unwireFailover = undefined;
    this.workers.clear();
    this.queues.clear();

    if (this.ownsQueueManager && this.queueManager) {
      try {
        await this.queueManager.close();
      } catch (err) {
        this.onError(err);
      }
      this.queueManager = undefined;
    }

    if (this.ownsSubscriptionPool && this.subscriptionPool) {
      try {
        this.subscriptionPool.close?.();
      } catch (err) {
        this.onError(err);
      }
      this.subscriptionPool = undefined;
    }
  }
}

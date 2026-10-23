import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { DelayedError, type Job, type Queue, type Worker } from 'bullmq';
import {
  QueueManager,
  type QueueManagerLike,
  type TaskPayload,
  type Team,
} from '@agent-hq/queue';
import {
  finalizeWorktree,
  prepareWorktree,
  type FinishWorktreeResult,
  type PreparedWorktree,
  type WorktreeContext,
} from './git-worktree';
import { recordEvent } from './history';
import { resetQuestionsState, setQueueManager } from './questions';
import { parseEvent, type Agent } from './state';
import { dispatch, subscribe } from './store';
import { SubscriptionPool } from './subscription-pool';

export type { QueueManagerLike };

export const TEAMS: readonly Team[] = ['frontend', 'backend', 'qa'] as const;
export const DEFAULT_CONCURRENCY: Record<Team, number> = {
  frontend: 2,
  backend: 1,
  qa: 1,
};
export const DEFAULT_ATTEMPTS = 4;
export const MAX_ERROR_LENGTH = 2000;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_QUESTION_GRACE_PERIOD_MS = 60_000;
const PING_TIMEOUT_MS = 2_000;
const KILL_TIMEOUT_MS = 2_000;

export type TeamStatus = 'idle' | 'working' | 'waiting_input';
export type WorkerTaskPayload = TaskPayload & { prUrl?: string };
export type WorkerJob = Pick<Job<TaskPayload>, 'id' | 'moveToDelayed'> & {
  data: WorkerTaskPayload;
  updateData: (data: WorkerTaskPayload) => Promise<void>;
};

export type SubscriptionPoolLike = Pick<
  SubscriptionPool,
  'pick' | 'reportOutput' | 'on' | 'off' | 'close'
> & {
  status?: SubscriptionPool['status'];
};

export interface WorkerPoolOptions {
  enabled?: boolean;
  concurrency?: Partial<Record<Team, number>>;
  delegateScript?: string;
  cwd?: string;
  repoRoot?: string;
  ghBinary?: string;
  prepareWorktree?: (
    ctx: WorktreeContext,
    payload: TaskPayload,
  ) => Promise<PreparedWorktree>;
  finalizeWorktree?: (
    ctx: WorktreeContext,
    payload: TaskPayload,
    worktree: PreparedWorktree,
  ) => Promise<FinishWorktreeResult>;
  logDir?: string;
  env?: NodeJS.ProcessEnv;
  queueManager?: QueueManagerLike;
  subscriptionPool?: SubscriptionPoolLike;
  afterProcessExit?: (job: WorkerJob) => Promise<void> | void;
  onError?: (err: unknown) => void;
  maxErrorLength?: number;
  questionGracePeriodMs?: number;
}

export function isV2WorkersEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.AGENT_HQ_V2_WORKERS?.trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

export function extractSessionId(output: string): string | undefined {
  const uuidMatch = output.match(
    /^session id:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/im,
  );
  if (uuidMatch) return uuidMatch[1];
  const agyMatch = output.match(
    /^>>> agy init session:\s*([A-Za-z0-9][A-Za-z0-9_-]*)$/m,
  );
  if (agyMatch) return agyMatch[1];
  return undefined;
}

export function buildTaskPrompt(
  payload: TaskPayload,
  delegateScript = resolveDefaultDelegateScript(),
): string {
  const sections = [`Ticket #${payload.issueId}: ${payload.title}`];
  if (payload.body?.trim()) sections.push(payload.body.trim());
  if (payload.lastError?.trim()) {
    sections.push(
      `Vorheriger Versuch fehlgeschlagen:\n${payload.lastError.trim()}`,
    );
  }
  if (payload.question?.status === 'ANSWERED' && payload.question.answer) {
    sections.push(
      `Frage: ${payload.question.question}\nAntwort: ${payload.question.answer}`,
    );
  }

  const delegateDir = dirname(resolve(delegateScript));
  const promptPath = join(delegateDir, 'prompts', 'hq-ask.md');
  const hqAskPath = join(delegateDir, 'hq-ask.sh');
  try {
    const content = readFileSync(promptPath, 'utf8')
      .replaceAll('{{HQ_ASK}}', hqAskPath)
      .trim();
    if (content) sections.push(content);
  } catch {
    console.warn(`[worker-pool] Prompt template missing: ${promptPath}`);
  }

  return sections.join('\n\n');
}

export function truncateError(
  output: string,
  exitCode: number | null,
  maxLength = MAX_ERROR_LENGTH,
): string {
  const cleaned = stripVTControlCharacters(output).trim();
  if (!cleaned) return `Process exited with code ${exitCode ?? 1}`;
  return cleaned.length <= maxLength
    ? cleaned
    : `...${cleaned.slice(-(maxLength - 3))}`;
}

export async function deriveTeamStatus(
  queue: Pick<Queue<TaskPayload>, 'getJobs'>,
): Promise<TeamStatus> {
  const jobs = await queue.getJobs(['active', 'delayed', 'waiting']);
  if (jobs.some((j) => j.data?.question?.status === 'PENDING')) {
    return 'waiting_input';
  }
  return jobs.some((j) =>
    'state' in j
      ? (j as { state?: string }).state === 'active'
      : Boolean(j.processedOn && !j.delay),
  )
    ? 'working'
    : 'idle';
}

function resolveDefaultDelegateScript(): string {
  if (process.env.AGENT_HQ_DELEGATE_SCRIPT) {
    return process.env.AGENT_HQ_DELEGATE_SCRIPT;
  }
  const direct = resolve(process.cwd(), 'scripts/delegate.sh');
  return existsSync(direct)
    ? direct
    : resolve(process.cwd(), '../../scripts/delegate.sh');
}

export class WorkerPool {
  readonly enabled: boolean;
  readonly concurrency: Record<Team, number>;
  readonly totalSlots: number;

  private readonly opts: WorkerPoolOptions;
  private readonly onError: (err: unknown) => void;
  private repoRoot?: string;
  private readonly prepareWorktreeFn: (
    ctx: WorktreeContext,
    payload: TaskPayload,
  ) => Promise<PreparedWorktree>;
  private readonly finalizeWorktreeFn: (
    ctx: WorktreeContext,
    payload: TaskPayload,
    worktree: PreparedWorktree,
  ) => Promise<FinishWorktreeResult>;
  private queueManager?: QueueManagerLike;
  private subscriptionPool?: SubscriptionPoolLike;
  private unwireFailover?: () => void;
  private readonly workers = new Map<Team, Worker<TaskPayload>>();
  private readonly children = new Set<ChildProcess>();
  private started = false;
  private closing = false;
  private exitHandlerRegistered = false;

  private readonly onExit = (): void => {
    for (const child of this.children) {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // ignore
        }
      }
    }
  };

  private registerExitHandler(): void {
    if (!this.exitHandlerRegistered) {
      process.once('exit', this.onExit);
      this.exitHandlerRegistered = true;
    }
  }

  private unregisterExitHandler(): void {
    process.off('exit', this.onExit);
    this.exitHandlerRegistered = false;
  }

  constructor(options: WorkerPoolOptions = {}) {
    this.opts = options;
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
    this.onError =
      options.onError ?? ((err: unknown) => console.warn('[worker-pool]', err));
    this.prepareWorktreeFn = options.prepareWorktree ?? prepareWorktree;
    this.finalizeWorktreeFn = options.finalizeWorktree ?? finalizeWorktree;
    if (options.repoRoot) {
      this.repoRoot = resolve(options.repoRoot);
    }
    this.queueManager = options.queueManager;
    this.subscriptionPool = options.subscriptionPool;
  }

  private getWorktreeContext(): WorktreeContext {
    return {
      repoRoot: this.repoRoot ?? resolve(this.opts.cwd ?? process.cwd()),
      ghBinary: this.opts.ghBinary,
      env: this.opts.env,
    };
  }

  async start(): Promise<boolean> {
    if (!this.enabled) return false;
    if (this.started) return true;
    this.closing = false;

    try {
      if (!this.repoRoot) {
        try {
          this.repoRoot = resolve(
            execFileSync('git', ['rev-parse', '--show-toplevel'], {
              cwd: this.opts.cwd ?? process.cwd(),
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'ignore'],
            }).trim(),
          );
        } catch {
          this.repoRoot = resolve(this.opts.cwd ?? process.cwd());
        }
      }
      this.queueManager ??= new QueueManager({
        onError: (err) => this.onError(err),
        queueOptions: { defaultJobOptions: { attempts: DEFAULT_ATTEMPTS } },
      });

      if (this.queueManager.connection?.ping) {
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            this.queueManager.connection.ping(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('timeout')),
                PING_TIMEOUT_MS,
              );
            }),
          ]);
        } catch {
          this.onError(new Error('Redis nicht erreichbar, V2 deaktiviert'));
          await this.close();
          return false;
        } finally {
          clearTimeout(timer);
        }
      }

      this.ensureSubscriptionPool();
      for (const team of TEAMS) {
        const queue = this.queueManager.getQueue(team);
        if (typeof (queue as { getJobs?: unknown }).getJobs === 'function') {
          const jobs = await queue.getJobs(['delayed', 'active', 'waiting']);
          for (const job of jobs) {
            const q = job.data?.question;
            if (q?.status === 'PENDING') {
              dispatch(
                parseEvent({
                  event: 'QUESTION_PENDING',
                  data: {
                    questionId: q.id,
                    issueId: q.issueId,
                    team: q.team,
                    question: q.question,
                    ...(q.options?.length ? { options: q.options } : {}),
                  },
                }),
              );
            }
          }
        }
        this.workers.set(
          team,
          this.queueManager.createWorker(
            team,
            (job, token) => this.processJob(team, job, token),
            { concurrency: this.concurrency[team] },
          ),
        );
      }

      this.registerExitHandler();
      setQueueManager(this.queueManager);
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
    job: WorkerJob,
    token?: string,
  ): Promise<{ prUrl?: string } | void> {
    if (!this.enabled) return;

    if (job.data.question?.status === 'PENDING') {
      const delayUntil = Date.now() + SEVEN_DAYS_MS;
      await this.guard(() => job.moveToDelayed(delayUntil, token));
      throw new DelayedError();
    }

    const pool = this.ensureSubscriptionPool();
    const restartedProviders = new Set<Agent>();

    const worktree = await this.guard(() =>
      this.prepareWorktreeFn(this.getWorktreeContext(), job.data),
    );

    while (true) {
      const hasAnsweredQuestion = job.data.question?.status === 'ANSWERED';
      const savedSessionId = hasAnsweredQuestion
        ? job.data.sessionId
        : undefined;
      const savedProvider = hasAnsweredQuestion ? job.data.provider : undefined;

      const picked = await this.guard(() => pool.pick(team));
      if (picked.provider === null) {
        const resetAt = Math.max(Date.now(), Date.parse(picked.cooldownUntil));
        await this.guard(() => job.moveToDelayed(resetAt, token));
        throw new DelayedError();
      }

      let provider: Agent = picked.provider;
      if (
        savedSessionId &&
        savedProvider &&
        provider !== savedProvider &&
        typeof pool.status === 'function'
      ) {
        const statuses = await this.guard(() => pool.status!());
        if (statuses[savedProvider]?.status === 'AVAILABLE') {
          provider = savedProvider;
        }
      }

      const script = resolve(
        this.opts.cwd ?? process.cwd(),
        this.opts.delegateScript ?? resolveDefaultDelegateScript(),
      );
      const isResumed =
        hasAnsweredQuestion &&
        Boolean(savedSessionId) &&
        savedProvider === provider;
      const answeredBeforeRun = hasAnsweredQuestion
        ? job.data.question?.id
        : undefined;
      const prompt = isResumed
        ? job.data.question!.answer!
        : buildTaskPrompt(job.data, script);

      const { exitCode, output } = await this.runDelegate(
        team,
        provider,
        prompt,
        job.data,
        worktree.worktreePath,
        isResumed ? savedSessionId : undefined,
        script,
      );

      if (this.queueManager && job.id) {
        const queue = this.queueManager.getQueue(team);
        if (typeof (queue as { getJob?: unknown }).getJob === 'function') {
          const fresh = await queue.getJob(job.id);
          if (fresh?.data) job.data = fresh.data;
        }
      }

      await this.opts.afterProcessExit?.(job);

      const hasUnprocessedQuestion =
        job.data.question?.status === 'PENDING' ||
        (job.data.question?.status === 'ANSWERED' &&
          job.data.question.id !== answeredBeforeRun);

      if (hasUnprocessedQuestion) {
        const extractedSession =
          extractSessionId(output) ?? (isResumed ? savedSessionId : undefined);
        const { sessionId: _s, provider: _p, ...restData } = job.data;
        job.data = extractedSession
          ? { ...restData, sessionId: extractedSession, provider }
          : restData;
        await job.updateData(job.data).catch(this.onError);
        const delayUntil =
          job.data.question!.status === 'PENDING'
            ? Date.now() + SEVEN_DAYS_MS
            : Date.now();
        await this.guard(() => job.moveToDelayed(delayUntil, token));
        throw new DelayedError();
      }

      if (exitCode !== 0 && !this.closing) {
        let rateLimited = false;
        for (const line of output.split(/\r?\n/)) {
          if (
            line.trim() &&
            (await this.guard(() => pool.reportOutput(provider, line)))
          ) {
            rateLimited = true;
          }
        }
        if (rateLimited && !restartedProviders.has(provider)) {
          restartedProviders.add(provider);
          continue;
        }
      }

      const { sessionId: _s, provider: _p, ...cleanedData } = job.data;
      job.data = cleanedData;

      if (exitCode === 0) {
        if (isResumed) {
          await job.updateData(job.data).catch(this.onError);
        }
        const result = await this.guard(() =>
          this.finalizeWorktreeFn(
            this.getWorktreeContext(),
            job.data,
            worktree,
          ),
        );
        job.data = {
          ...job.data,
          prUrl: result.prUrl,
        } as WorkerTaskPayload;
        await job.updateData(job.data).catch(this.onError);
        return result;
      }

      const maxLen = this.opts.maxErrorLength ?? MAX_ERROR_LENGTH;
      const lastError = truncateError(output, exitCode, maxLen);
      job.data = { ...job.data, lastError };
      await job.updateData(job.data).catch(this.onError);
      throw new Error(lastError);
    }
  }

  private ensureSubscriptionPool(): SubscriptionPoolLike {
    const pool = (this.subscriptionPool ??= new SubscriptionPool());
    if (!this.unwireFailover) {
      const onFailover = (data: {
        team: Team;
        from: Agent;
        to: Agent | null;
        cooldownUntil: string;
      }) => {
        try {
          const ev = parseEvent({
            event: 'SUBSCRIPTION_FAILOVER',
            agent: data.from,
            data,
          });
          void recordEvent(ev).catch(this.onError);
        } catch (err) {
          this.onError(err);
        }
      };
      pool.on('SUBSCRIPTION_FAILOVER', onFailover);
      this.unwireFailover = () => pool.off('SUBSCRIPTION_FAILOVER', onFailover);
    }
    return pool;
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.onError(err);
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  private runDelegate(
    team: Team,
    provider: Agent,
    prompt: string,
    payload: TaskPayload,
    cwd?: string,
    sessionId?: string,
    resolvedScript?: string,
  ): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolveRun) => {
      const env = this.opts.env ?? process.env;
      const model =
        env[`AGENT_MODEL_${provider.toUpperCase()}`] ?? env.AGENT_MODEL;
      const logDir =
        this.opts.logDir ?? env.AGENT_HQ_LOG_DIR ?? join(tmpdir(), 'agent-hq');
      const childEnv: NodeJS.ProcessEnv = {
        ...env,
        ...(model ? { AGENT_MODEL: model } : {}),
        AGENT_HQ_LOG_DIR: logDir,
        HQ_ISSUE_ID: String(payload.issueId),
        HQ_TEAM: team,
        ...(sessionId ? { HQ_SESSION_ID: sessionId } : {}),
      };

      let stdout = '';
      let stderr = '';
      let settled = false;

      const script =
        resolvedScript ??
        resolve(
          this.opts.cwd ?? process.cwd(),
          this.opts.delegateScript ?? resolveDefaultDelegateScript(),
        );
      const child = spawn(script, [provider, prompt], {
        cwd: cwd ?? this.opts.cwd ?? process.cwd(),
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      this.children.add(child);
      this.registerExitHandler();

      const gracePeriodMs =
        this.opts.questionGracePeriodMs ??
        (env.AGENT_HQ_QUESTION_GRACE_PERIOD_MS
          ? Number(env.AGENT_HQ_QUESTION_GRACE_PERIOD_MS)
          : DEFAULT_QUESTION_GRACE_PERIOD_MS);

      let graceTimer: NodeJS.Timeout | undefined;
      const unsubscribe = subscribe((_, ev) => {
        if (
          'event' in ev &&
          ev.event === 'QUESTION_PENDING' &&
          ev.data?.issueId === payload.issueId
        ) {
          if (!graceTimer && !settled) {
            graceTimer = setTimeout(() => {
              if (!settled) {
                this.killChild(child, 'SIGTERM');
              }
            }, gracePeriodMs);
          }
        }
      });

      child.stdout?.setEncoding('utf8').on('data', (c: string) => {
        stdout += c;
      });
      child.stderr?.setEncoding('utf8').on('data', (c: string) => {
        stderr += c;
      });

      const finish = (exitCode: number, err?: Error) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        if (graceTimer) clearTimeout(graceTimer);
        this.children.delete(child);
        const output = [stdout, stderr, err?.message]
          .filter(Boolean)
          .join('\n');
        resolveRun({ exitCode, output });
      };

      child.on('error', (err) => finish(1, err));
      child.on('close', (code) => finish(code ?? 1));
    });
  }

  private killChild(child: ChildProcess, signal: NodeJS.Signals): void {
    if (child.pid) {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // ignore ESRCH
      }
    }
    child.kill(signal);
  }

  async close(): Promise<void> {
    this.closing = true;
    this.started = false;
    this.unregisterExitHandler();
    this.unwireFailover?.();
    this.unwireFailover = undefined;

    if (this.children.size > 0) {
      const timer = setTimeout(() => {
        for (const c of this.children) this.killChild(c, 'SIGKILL');
      }, KILL_TIMEOUT_MS);
      await Promise.all(
        [...this.children].map(
          (c) =>
            new Promise<void>((r) => {
              c.once('close', () => r()).once('error', () => r());
              this.killChild(c, 'SIGTERM');
            }),
        ),
      );
      clearTimeout(timer);
      this.children.clear();
    }

    await Promise.all(
      [...this.workers.values()].map((w) => w.close().catch(this.onError)),
    );
    this.workers.clear();
    await this.queueManager?.close().catch(this.onError);
    this.queueManager = undefined;
    resetQuestionsState();
    this.subscriptionPool?.close();
    this.subscriptionPool = undefined;
  }
}

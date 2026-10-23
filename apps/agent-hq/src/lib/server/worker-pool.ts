import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import {
  DelayedError,
  type Job,
  type Processor,
  type Queue,
  type Worker,
  type WorkerOptions,
} from 'bullmq';
import { QueueManager, type TaskPayload, type Team } from '@agent-hq/queue';
import { recordEvent } from './history';
import { parseEvent, type Agent } from './state';
import { subscribe } from './store';
import { SubscriptionPool } from './subscription-pool';
import { setQueueManager, resetQuestionsState } from './questions';

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
export type WorkerJob = Pick<
  Job<TaskPayload>,
  'id' | 'data' | 'updateData' | 'moveToDelayed'
>;

export interface QueueManagerLike {
  connection?: { ping?: () => Promise<string> };
  getQueue(team: Team): Queue<TaskPayload>;
  createWorker(
    team: Team,
    processor: Processor<TaskPayload, unknown, string>,
    options?: Partial<WorkerOptions>,
  ): Worker<TaskPayload>;
  close(): Promise<void>;
}

export type SubscriptionPoolLike = Pick<
  SubscriptionPool,
  'pick' | 'reportOutput' | 'on' | 'off' | 'close'
>;

export interface WorkerPoolOptions {
  enabled?: boolean;
  concurrency?: Partial<Record<Team, number>>;
  delegateScript?: string;
  cwd?: string;
  logDir?: string;
  env?: NodeJS.ProcessEnv;
  queueManager?: QueueManagerLike;
  subscriptionPool?: SubscriptionPoolLike;
  afterProcessExit?: (job: WorkerJob) => Promise<void> | void;
  onError?: (err: unknown) => void;
  maxErrorLength?: number;
  questionGracePeriodMs?: number;
  promptTemplatePath?: string;
  hqAskPrompt?: string;
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

export function loadHqAskPrompt(
  promptPath?: string,
  hqAskPath?: string,
): string {
  const targetPromptPath =
    promptPath ??
    resolve(dirname(resolveDefaultDelegateScript()), 'prompts', 'hq-ask.md');
  const targetHqAskPath =
    hqAskPath ?? resolve(dirname(resolveDefaultDelegateScript()), 'hq-ask.sh');

  if (!existsSync(targetPromptPath)) {
    return '';
  }
  try {
    const content = readFileSync(targetPromptPath, 'utf8');
    return content.replaceAll('{{HQ_ASK}}', targetHqAskPath).trim();
  } catch {
    return '';
  }
}

export interface BuildTaskPromptOptions {
  delegateScript?: string;
  promptTemplatePath?: string;
  hqAskPrompt?: string;
}

export function buildTaskPrompt(
  payload: TaskPayload,
  options?: BuildTaskPromptOptions,
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

  const delegateScript =
    options?.delegateScript ?? resolveDefaultDelegateScript();
  const delegateDir = dirname(resolve(delegateScript));
  const hqAskPath = resolve(delegateDir, 'hq-ask.sh');
  const promptPath =
    options?.promptTemplatePath ?? resolve(delegateDir, 'prompts', 'hq-ask.md');

  const hqAskContent =
    options?.hqAskPrompt !== undefined
      ? options.hqAskPrompt
      : loadHqAskPrompt(promptPath, hqAskPath);

  if (hqAskContent.trim()) {
    sections.push(hqAskContent.trim());
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
    this.queueManager = options.queueManager;
    this.subscriptionPool = options.subscriptionPool;
  }

  async start(): Promise<boolean> {
    if (!this.enabled) return false;
    if (this.started) return true;
    this.closing = false;

    try {
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
        this.queueManager.getQueue(team);
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

  async processJob(team: Team, job: WorkerJob, token?: string): Promise<void> {
    if (!this.enabled) return;

    if (job.data.question?.status === 'PENDING') {
      const delayUntil = Date.now() + SEVEN_DAYS_MS;
      await this.guard(() => job.moveToDelayed(delayUntil, token));
      throw new DelayedError();
    }

    const pool = this.ensureSubscriptionPool();
    const restartedProviders = new Set<Agent>();

    while (true) {
      const picked = await this.guard(() => pool.pick(team));
      if (picked.provider === null) {
        const resetAt = Math.max(Date.now(), Date.parse(picked.cooldownUntil));
        await this.guard(() => job.moveToDelayed(resetAt, token));
        throw new DelayedError();
      }

      const { provider } = picked;
      const script = this.opts.delegateScript ?? resolveDefaultDelegateScript();
      const isResumed =
        Boolean(job.data.sessionId) && job.data.question?.status === 'ANSWERED';
      const prompt = isResumed
        ? job.data.question!.answer!
        : buildTaskPrompt(job.data, {
            delegateScript: script,
            promptTemplatePath: this.opts.promptTemplatePath,
            hqAskPrompt: this.opts.hqAskPrompt,
          });

      const { exitCode, output } = await this.runDelegate(
        team,
        provider,
        prompt,
        job.data,
      );

      if (this.queueManager && job.id) {
        const queue = this.queueManager.getQueue(team);
        if (typeof (queue as { getJob?: unknown }).getJob === 'function') {
          const fresh = await queue.getJob(job.id);
          if (fresh?.data) job.data = fresh.data;
        }
      }

      const extractedSession = extractSessionId(output);
      if (extractedSession) {
        job.data = { ...job.data, sessionId: extractedSession };
        await job.updateData(job.data).catch(this.onError);
      }

      await this.opts.afterProcessExit?.(job);

      if (job.data.question?.status === 'PENDING') {
        const delayUntil = Date.now() + SEVEN_DAYS_MS;
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

      if (exitCode === 0) return;

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
        ...(payload.sessionId
          ? {
              SESSION: payload.sessionId,
              HQ_SESSION_ID: payload.sessionId,
            }
          : {}),
      };

      let stdout = '';
      let stderr = '';
      let settled = false;

      const script = this.opts.delegateScript ?? resolveDefaultDelegateScript();
      const child = spawn(script, [provider, prompt], {
        cwd: this.opts.cwd ?? process.cwd(),
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

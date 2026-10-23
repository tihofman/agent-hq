import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { QueueEvents } from 'bullmq';
import {
  getQueueName,
  jobIdForIssue,
  issueIdFromJobId,
  QueueManager,
  type TaskPayload,
  type Team,
} from '@agent-hq/queue';

export type IssueStatus = 'queued' | 'in-progress' | 'blocked' | 'done';

const execFile = promisify(nodeExecFile);
const teams: Team[] = ['frontend', 'backend', 'qa'];
const statuses: readonly IssueStatus[] = [
  'queued',
  'in-progress',
  'blocked',
  'done',
];
const log = (message: string, error?: unknown) =>
  console.warn(`[issue-ingest] ${message}`, error ?? '');

let activeGhRunner: ((args: string[]) => Promise<string>) | undefined;
const labelEdits = new Map<number, Promise<void>>();

export function setGhRunner(
  runner?: (args: string[]) => Promise<string>,
): void {
  activeGhRunner = runner;
}

export function serializeIssueLabel(
  issueId: number,
  action: () => Promise<void>,
): Promise<void> {
  const next = (labelEdits.get(issueId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(action);
  labelEdits.set(issueId, next);
  void next
    .finally(() => {
      if (labelEdits.get(issueId) === next) labelEdits.delete(issueId);
    })
    .catch(() => undefined);
  return next;
}

export interface IngestIssue {
  number: number;
  title: string;
  body: string | null;
  labels: { name: string }[];
}

interface IngestOptions {
  queueManager: {
    close(): Promise<void>;
    getQueue(team: Team): {
      getJob(
        jobId: string,
      ): Promise<
        { attemptsMade: number; opts: { attempts?: number } } | undefined
      >;
      add(
        name: string,
        data: TaskPayload,
        options: { jobId: string },
      ): Promise<unknown>;
    };
  };
  runGh?: (args: string[]) => Promise<string>;
  intervalMs?: number;
  queueEvents: (team: Team) => Pick<QueueEvents, 'on' | 'close'>;
}

async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFile('gh', args, {
    encoding: 'utf8',
    timeout: 10_000,
  });
  return stdout;
}

async function updateStatus(
  run: (args: string[]) => Promise<string>,
  issueId: number,
  status: IssueStatus,
  knownLabels?: readonly string[],
): Promise<void> {
  let currentLabels = knownLabels;
  if (!currentLabels) {
    const output = await run([
      'issue',
      'view',
      String(issueId),
      '--json',
      'labels',
    ]);
    try {
      const parsed = JSON.parse(output) as { labels?: { name: string }[] };
      currentLabels = Array.isArray(parsed?.labels)
        ? parsed.labels.map(({ name }) => name)
        : [];
    } catch {
      currentLabels = [];
    }
  }
  const toRemove = statuses
    .filter((value) => value !== status)
    .map((value) => `status:${value}`)
    .filter((label) => currentLabels.includes(label));
  const args = [
    'issue',
    'edit',
    String(issueId),
    '--add-label',
    `status:${status}`,
  ];
  if (toRemove.length > 0) {
    args.push('--remove-label', toRemove.join(','));
  }
  await run(args);
}

export function updateIssueStatus(
  issueId: number,
  status: IssueStatus,
  run?: (args: string[]) => Promise<string>,
): Promise<void> {
  return serializeIssueLabel(issueId, () =>
    updateStatus(run ?? activeGhRunner ?? gh, issueId, status),
  );
}

export function startIssueIngest(options: IngestOptions): () => void {
  const run = options.runGh ?? activeGhRunner ?? gh;
  let polling = false;
  let stopped = false;
  const events: Pick<QueueEvents, 'on' | 'close'>[] = [];
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    for (const event of events)
      void event
        .close()
        .catch((error) => log('could not close queue events', error));
    void options.queueManager
      .close()
      .catch((error) => log('could not close queue manager', error));
  };
  let timer: ReturnType<typeof setInterval> | undefined = undefined;
  try {
    for (const team of teams) {
      const event = options.queueEvents(team);
      events.push(event);
      for (const [name, status] of [
        ['active', 'in-progress'],
        ['failed', 'blocked'],
        ['completed', 'done'],
      ] as const) {
        event.on(name, ({ jobId }: { jobId: string }) => {
          const issueId = issueIdFromJobId(jobId);
          if (issueId === undefined || stopped) return;
          void serializeIssueLabel(issueId, async () => {
            if (stopped) return;
            if (name === 'failed') {
              const job = await options.queueManager
                .getQueue(team)
                .getJob(jobId);
              if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
            }
            if (!stopped) await updateStatus(run, issueId, status);
          }).catch((error) =>
            log(`could not set status:${status} on issue #${issueId}`, error),
          );
        });
      }
      event.on('error', (error) =>
        log(`queue events failed for ${team}`, error),
      );
    }
  } catch (error) {
    stop();
    throw error;
  }

  let labelsReady = false;
  const ensureLabels = async () => {
    if (labelsReady) return;
    await Promise.all(
      [
        ...statuses.map((status) => `status:${status}`),
        ...teams.map((team) => `team:${team}`),
      ].map((label) => run(['label', 'create', label, '--force'])),
    );
    labelsReady = true;
  };
  const ingest = async (signal: AbortSignal, expired: Promise<never>) => {
    await ensureLabels();
    for (const team of teams) {
      if (signal.aborted || stopped) return;
      try {
        const output = await run([
          'issue',
          'list',
          '--state',
          'open',
          '--label',
          `team:${team}`,
          '--json',
          'number,title,body,labels',
        ]);
        const issues = JSON.parse(output) as IngestIssue[];
        for (const issue of issues) {
          if (signal.aborted || stopped) return;
          if (issue.labels.some(({ name }) => name.startsWith('status:')))
            continue;
          await serializeIssueLabel(issue.number, async () => {
            if (signal.aborted || stopped) return;
            const queue = options.queueManager.getQueue(team);
            const issueLabels = issue.labels.map(({ name }) => name);
            // Add before labeling so failed adds remain eligible; the stable ID makes retries idempotent while the job exists.
            await Promise.race([
              queue.add(
                issue.title,
                {
                  issueId: issue.number,
                  title: issue.title,
                  team,
                  body: issue.body ?? '',
                  labels: issueLabels,
                },
                { jobId: jobIdForIssue(issue.number) },
              ),
              expired,
            ]);
            if (signal.aborted || stopped) return;
            await updateStatus(run, issue.number, 'queued', issueLabels);
          });
        }
      } catch (error) {
        log(`poll failed for ${team}; retrying next poll`, error);
      }
    }
  };
  const poll = async () => {
    if (polling || stopped) return;
    polling = true;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error('poll timed out after 10 seconds'));
      }, 10_000);
    });
    try {
      await Promise.race([ingest(controller.signal, expired), expired]);
    } catch (error) {
      log('poll failed; server continues running', error);
    } finally {
      clearTimeout(timeout);
      polling = false;
    }
  };

  void poll();
  timer = setInterval(
    () => void poll(),
    (options.intervalMs ??
      Number(process.env.AGENT_HQ_ISSUE_POLL_INTERVAL_MS)) ||
      60_000,
  );
  timer.unref();
  return stop;
}

let stopIngest: (() => void) | undefined;
export function startConfiguredIssueIngest(): void {
  if (process.env.AGENT_HQ_V2_WORKERS !== '1' || stopIngest) return;
  try {
    const manager = new QueueManager();
    stopIngest = startIssueIngest({
      queueManager: manager,
      queueEvents: (team) =>
        new QueueEvents(getQueueName(team), { connection: manager.connection }),
    });
  } catch (error) {
    log('could not start issue ingest; server continues running', error);
  }
}

export function stopConfiguredIssueIngest(): void {
  stopIngest?.();
  stopIngest = undefined;
}

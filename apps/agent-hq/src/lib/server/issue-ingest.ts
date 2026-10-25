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
import {
  HQ_LABELS,
  ISSUE_STATUSES,
  ingestTargets,
  loadRepos,
  type IssueStatus,
  type RepoTarget,
} from './repos';

export type { IssueStatus };

const execFile = promisify(nodeExecFile);
const teams: Team[] = ['frontend', 'backend', 'qa'];
const log = (message: string, error?: unknown) =>
  console.warn(`[issue-ingest] ${message}`, error ?? '');

let activeGhRunner: ((args: string[]) => Promise<string>) | undefined;
const labelEdits = new Map<string, Promise<void>>();

export function setGhRunner(
  runner?: (args: string[]) => Promise<string>,
): void {
  activeGhRunner = runner;
}

/** Serializes label edits per issue; key is the job ID (repo-unique). */
export function serializeIssueLabel(
  key: string,
  action: () => Promise<void>,
): Promise<void> {
  const next = (labelEdits.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(action);
  labelEdits.set(key, next);
  void next
    .finally(() => {
      if (labelEdits.get(key) === next) labelEdits.delete(key);
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
      getJob(jobId: string): Promise<
        | {
            attemptsMade: number;
            opts: { attempts?: number };
            data?: Pick<TaskPayload, 'issueId' | 'repo'>;
          }
        | undefined
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

/** Legacy home repo (no `repo`) keeps today's calls without `--repo`. */
const repoArgs = (repo?: string) => (repo ? ['--repo', repo] : []);

async function updateStatus(
  run: (args: string[]) => Promise<string>,
  issueId: number,
  status: IssueStatus,
  repo?: string,
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
      ...repoArgs(repo),
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
  const toRemove = ISSUE_STATUSES.filter((value) => value !== status)
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
  await run([...args, ...repoArgs(repo)]);
}

export function updateIssueStatus(
  issueId: number,
  status: IssueStatus,
  repo?: string,
  run?: (args: string[]) => Promise<string>,
): Promise<void> {
  return serializeIssueLabel(jobIdForIssue(issueId, repo), () =>
    updateStatus(run ?? activeGhRunner ?? gh, issueId, status, repo),
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
          const legacyIssueId = issueIdFromJobId(jobId);
          // Only our own IDs: legacy `issue-<n>` or `<owner>/<name>#<n>`.
          if (stopped || (legacyIssueId === undefined && !jobId.includes('#')))
            return;
          void serializeIssueLabel(jobId, async () => {
            if (stopped) return;
            let issueId = legacyIssueId;
            let repo: string | undefined;
            if (name === 'failed' || issueId === undefined) {
              const job = await options.queueManager
                .getQueue(team)
                .getJob(jobId);
              if (!job) return;
              if (issueId === undefined) {
                issueId = job.data?.issueId;
                repo = job.data?.repo;
                if (!issueId || !repo) return;
              }
              if (
                name === 'failed' &&
                job.attemptsMade < (job.opts.attempts ?? 1)
              )
                return;
            }
            if (!stopped) await updateStatus(run, issueId, status, repo);
          }).catch((error) =>
            log(`could not set status:${status} on ${jobId}`, error),
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
  // Registered repos get their labels at registration; only the legacy home repo here.
  const ensureLabels = async () => {
    if (labelsReady) return;
    await Promise.all(
      HQ_LABELS.map((label) => run(['label', 'create', label, '--force'])),
    );
    labelsReady = true;
  };
  const ingest = async (
    target: RepoTarget,
    signal: AbortSignal,
    expired: Promise<never>,
  ) => {
    const { repo } = target;
    if (!repo) await ensureLabels();
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
          ...repoArgs(repo),
        ]);
        const issues = JSON.parse(output) as IngestIssue[];
        for (const issue of issues) {
          if (signal.aborted || stopped) return;
          if (issue.labels.some(({ name }) => name.startsWith('status:')))
            continue;
          const jobId = jobIdForIssue(issue.number, repo);
          await serializeIssueLabel(jobId, async () => {
            if (signal.aborted || stopped) return;
            const queue = options.queueManager.getQueue(team);
            const issueLabels = issue.labels.map(({ name }) => name);
            // Add before labeling so failed adds remain eligible; the stable ID makes retries idempotent while the job exists.
            await Promise.race([
              queue.add(
                issue.title,
                {
                  issueId: issue.number,
                  ...(repo ? { repo } : {}),
                  title: issue.title,
                  team,
                  body: issue.body ?? '',
                  labels: issueLabels,
                },
                { jobId },
              ),
              expired,
            ]);
            if (signal.aborted || stopped) return;
            await updateStatus(run, issue.number, 'queued', repo, issueLabels);
          });
        }
      } catch (error) {
        log(
          `poll failed for ${team}${repo ? ` in ${repo}` : ''}; retrying next poll`,
          error,
        );
      }
    }
  };
  // The timeout applies per repo so many repos cannot starve each other.
  const pollTarget = async (target: RepoTarget) => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error('poll timed out after 10 seconds'));
      }, 10_000);
    });
    try {
      await Promise.race([ingest(target, controller.signal, expired), expired]);
    } catch (error) {
      log(
        `poll failed${target.repo ? ` for ${target.repo}` : ''}; server continues running`,
        error,
      );
    } finally {
      clearTimeout(timeout);
    }
  };
  const poll = async () => {
    if (polling || stopped) return;
    polling = true;
    try {
      let targets: RepoTarget[];
      try {
        targets = ingestTargets(loadRepos());
      } catch (error) {
        log('poll failed: could not read repo registry', error);
        return;
      }
      for (const target of targets) {
        if (stopped) return;
        await pollTarget(target);
      }
    } finally {
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

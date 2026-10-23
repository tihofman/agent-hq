import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { QueueEvents } from 'bullmq';
import {
  getQueueName,
  QueueManager,
  type TaskPayload,
  type Team,
} from '@agent-hq/queue';

const execFile = promisify(nodeExecFile);
const teams: Team[] = ['frontend', 'backend', 'qa'];
const statuses = ['queued', 'in-progress', 'blocked', 'done'];
const log = (message: string, error?: unknown) =>
  console.warn(`[issue-ingest] ${message}`, error ?? '');

export interface IngestIssue {
  number: number;
  title: string;
  body: string | null;
  labels: { name: string }[];
}

interface IngestOptions {
  queueManager: {
    getQueue(team: Team): {
      add(
        name: string,
        data: TaskPayload,
        options: { jobId: string },
      ): Promise<unknown>;
    };
  };
  runGh?: (args: string[]) => Promise<string>;
  intervalMs?: number;
  queueEvents?: (team: Team) => Pick<QueueEvents, 'on' | 'close'>;
}

async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFile('gh', args, { encoding: 'utf8' });
  return stdout;
}

async function updateStatus(
  run: (args: string[]) => Promise<string>,
  issueId: number,
  status: string,
) {
  try {
    await run([
      'issue',
      'edit',
      String(issueId),
      '--add-label',
      `status:${status}`,
      '--remove-label',
      statuses
        .filter((value) => value !== status)
        .map((value) => `status:${value}`)
        .join(','),
    ]);
  } catch (error) {
    log(`could not set status:${status} on issue #${issueId}`, error);
  }
}

export function startIssueIngest(options: IngestOptions): () => void {
  const run = options.runGh ?? gh;
  let polling = false;
  let stopped = false;
  const events = teams.map((team) => {
    const queueEvents =
      options.queueEvents?.(team) ??
      new QueueEvents(getQueueName(team), {
        connection: (options.queueManager as QueueManager).connection,
      });
    queueEvents.on('active', ({ jobId }) => {
      if (jobId) void updateStatus(run, Number(jobId), 'in-progress');
    });
    queueEvents.on('failed', ({ jobId }) => {
      if (jobId) void updateStatus(run, Number(jobId), 'blocked');
    });
    queueEvents.on('completed', ({ jobId }) => {
      if (jobId) void updateStatus(run, Number(jobId), 'done');
    });
    queueEvents.on('error', (error) =>
      log(`queue events failed for ${team}`, error),
    );
    return queueEvents;
  });

  const poll = async () => {
    if (polling || stopped) return;
    polling = true;
    try {
      await Promise.all(
        statuses.map((status) =>
          run(['label', 'create', `status:${status}`, '--force']),
        ),
      );
      await Promise.all(
        teams.map((team) =>
          run(['label', 'create', `team:${team}`, '--force']),
        ),
      );
      for (const team of teams) {
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
          if (issue.labels.some(({ name }) => name.startsWith('status:')))
            continue;
          const queue = options.queueManager.getQueue(team);
          await queue.add(
            issue.title,
            {
              issueId: issue.number,
              title: issue.title,
              team,
              body: issue.body ?? '',
              labels: issue.labels.map(({ name }) => name),
            } satisfies TaskPayload,
            { jobId: String(issue.number) },
          );
          await updateStatus(run, issue.number, 'queued');
        }
      }
    } catch (error) {
      log('poll failed; server continues running', error);
    } finally {
      polling = false;
    }
  };

  void poll();
  const timer = setInterval(
    () => void poll(),
    (options.intervalMs ??
      Number(process.env.AGENT_HQ_ISSUE_POLL_INTERVAL_MS)) ||
      60_000,
  );
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
    for (const event of events)
      void event
        .close()
        .catch((error) => log('could not close queue events', error));
  };
}

let stopIngest: (() => void) | undefined;
export function startConfiguredIssueIngest(): void {
  if (process.env.AGENT_HQ_V2_WORKERS !== '1' || stopIngest) return;
  const manager = new QueueManager();
  stopIngest = startIssueIngest({ queueManager: manager });
}

export function stopConfiguredIssueIngest(): void {
  stopIngest?.();
  stopIngest = undefined;
}

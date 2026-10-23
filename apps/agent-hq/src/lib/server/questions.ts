import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  jobIdForIssue,
  QueueManager,
  type QuestionPayload,
  type TaskPayload,
  type Team,
} from '@agent-hq/queue';
import { recordEvent } from './history';
import { parseEvent } from './state';
import { getState } from './store';
import { isV2WorkersEnabled, type QueueManagerLike } from './worker-pool';

const execFile = promisify(nodeExecFile);
const TEAMS: readonly Team[] = ['frontend', 'backend', 'qa'] as const;

export class QuestionNotFoundError extends Error {
  constructor(message = 'Question not found') {
    super(message);
    this.name = 'QuestionNotFoundError';
  }
}

export class QuestionConflictError extends Error {
  constructor(message = 'Conflict') {
    super(message);
    this.name = 'QuestionConflictError';
  }
}

let activeQueueManager: QueueManagerLike | undefined;
let activeGhRunner: ((args: string[]) => Promise<string>) | undefined;

export function setQueueManager(manager?: QueueManagerLike): void {
  activeQueueManager = manager;
}

export function getQueueManager(): QueueManagerLike | undefined {
  if (activeQueueManager) return activeQueueManager;
  if (isV2WorkersEnabled()) {
    try {
      activeQueueManager = new QueueManager();
      return activeQueueManager;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function setGhRunner(
  runner?: (args: string[]) => Promise<string>,
): void {
  activeGhRunner = runner;
}

async function defaultGh(args: string[]): Promise<string> {
  const { stdout } = await execFile('gh', args, {
    encoding: 'utf8',
    timeout: 10_000,
  });
  return stdout;
}

async function runGh(args: string[]): Promise<string> {
  const runner = activeGhRunner ?? defaultGh;
  return runner(args);
}

export function resetQuestionsState(): void {
  activeQueueManager = undefined;
  activeGhRunner = undefined;
}

export interface AskQuestionInput {
  issueId: number;
  team: Team;
  question: string;
  options?: string[];
}

export async function askQuestion(
  input: AskQuestionInput,
): Promise<QuestionPayload> {
  const { issueId, team, question, options } = input;
  const qm = getQueueManager();
  if (!qm) {
    throw new QuestionConflictError(
      'No active job for issue (queue unavailable)',
    );
  }

  const queue = qm.getQueue(team);
  const jobId = jobIdForIssue(issueId);
  const job = await queue.getJob(jobId);

  if (!job) {
    throw new QuestionConflictError(`No active job for issue #${issueId}`);
  }

  const state =
    typeof job.getState === 'function'
      ? await job.getState()
      : (job as unknown as { state?: string }).state;

  if (state !== 'active') {
    throw new QuestionConflictError(
      `Job for issue #${issueId} is not active (state: ${state})`,
    );
  }

  const currentCount =
    (job.data as { questionCount?: number }).questionCount ??
    (job.data.question?.id
      ? Number(job.data.question.id.split('-').pop()) || 0
      : 0);
  const nextCount = currentCount + 1;
  const questionId = `${issueId}-${nextCount}`;

  const questionPayload: QuestionPayload = {
    id: questionId,
    issueId,
    team,
    question,
    status: 'PENDING',
    ...(options && options.length > 0 ? { options } : {}),
  };

  const updatedData: TaskPayload & { questionCount?: number } = {
    ...job.data,
    question: questionPayload,
    questionCount: nextCount,
  };

  await job.updateData(updatedData);

  // Set status:blocked on GitHub issue via gh execFile array
  try {
    await runGh([
      'issue',
      'edit',
      String(issueId),
      '--add-label',
      'status:blocked',
      '--remove-label',
      'status:queued,status:in-progress,status:done',
    ]);
  } catch (err) {
    console.warn(
      `[questions] Failed to set status:blocked on issue #${issueId}:`,
      err,
    );
  }

  // Immediately broadcast QUESTION_PENDING via existing event pipeline (State, SSE, History)
  const event = parseEvent({
    event: 'QUESTION_PENDING',
    data: {
      questionId,
      issueId,
      team,
      question,
      ...(options && options.length > 0 ? { options } : {}),
    },
  });
  await recordEvent(event);

  return questionPayload;
}

export async function getOpenQuestions(): Promise<QuestionPayload[]> {
  const qm = getQueueManager();
  if (qm) {
    const list: QuestionPayload[] = [];
    for (const team of TEAMS) {
      const queue = qm.getQueue(team);
      const jobs = await queue.getJobs(['active', 'delayed', 'waiting']);
      for (const job of jobs) {
        if (job.data?.question?.status === 'PENDING') {
          list.push(job.data.question);
        }
      }
    }
    return list;
  }

  // Fallback to in-memory state if QueueManager is not configured
  return Object.values(getState().questions ?? {}).filter(
    (q) => q.status === 'PENDING',
  );
}

export async function answerQuestion(
  questionId: string,
  answer: string,
): Promise<{ ok: boolean }> {
  const match = questionId.match(/^(\d+)-(\d+)$/);
  if (!match) {
    throw new QuestionNotFoundError(`Invalid question ID: ${questionId}`);
  }
  const issueId = Number(match[1]);
  const trimmedAnswer = answer.trim();
  const qm = getQueueManager();

  if (qm) {
    const jobId = jobIdForIssue(issueId);
    let targetJob:
      | {
          data: TaskPayload;
          updateData: (data: TaskPayload) => Promise<unknown>;
          promote?: () => Promise<unknown>;
        }
      | undefined;

    for (const team of TEAMS) {
      const queue = qm.getQueue(team);
      const job = await queue.getJob(jobId);
      if (job?.data?.question?.id === questionId) {
        targetJob = job;
        break;
      }
    }

    if (!targetJob || !targetJob.data?.question) {
      throw new QuestionNotFoundError(`Question ${questionId} not found`);
    }

    if (targetJob.data.question.status === 'ANSWERED') {
      throw new QuestionConflictError(
        `Question ${questionId} already answered`,
      );
    }

    targetJob.data.question.status = 'ANSWERED';
    targetJob.data.question.answer = trimmedAnswer;
    await targetJob.updateData(targetJob.data);

    if (typeof targetJob.promote === 'function') {
      await targetJob.promote();
    }

    const event = parseEvent({
      event: 'QUESTION_RESOLVED',
      data: {
        questionId,
        issueId,
        team: targetJob.data.team,
        answer: trimmedAnswer,
      },
    });
    await recordEvent(event);

    return { ok: true };
  }

  // Fallback to store if QueueManager not present
  const existing = getState().questions?.[questionId];
  if (!existing) {
    throw new QuestionNotFoundError(`Question ${questionId} not found`);
  }
  if (existing.status === 'ANSWERED') {
    throw new QuestionConflictError(`Question ${questionId} already answered`);
  }

  const event = parseEvent({
    event: 'QUESTION_RESOLVED',
    data: {
      questionId,
      issueId,
      team: existing.team,
      answer: trimmedAnswer,
    },
  });
  await recordEvent(event);

  return { ok: true };
}

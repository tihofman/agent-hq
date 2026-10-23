import {
  jobIdForIssue,
  type QueueManagerLike,
  type QuestionPayload,
  type TaskPayload,
  type Team,
} from '@agent-hq/queue';
import { recordEvent } from './history';
import { setGhRunner, updateIssueStatus } from './issue-ingest';
import { parseEvent } from './state';

export { setGhRunner };

const TEAMS: readonly Team[] = ['frontend', 'backend', 'qa'] as const;

export const MAX_QUESTION_LENGTH = 2000;
export const MAX_OPTIONS_COUNT = 10;
export const MAX_OPTION_LENGTH = 200;
export const MAX_ANSWER_LENGTH = 5000;

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
const answeringIds = new Set<string>();

export function setQueueManager(manager?: QueueManagerLike): void {
  activeQueueManager = manager;
}

export function resetQuestionsState(): void {
  activeQueueManager = undefined;
  answeringIds.clear();
  setGhRunner(undefined);
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
  if (!activeQueueManager) {
    throw new QuestionConflictError(
      'No active job for issue (queue unavailable)',
    );
  }

  const queue = activeQueueManager.getQueue(team);
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

  const prev = Number(job.data.question?.id.split('-')[1]) || 0;
  const questionId = `${issueId}-${prev + 1}`;
  const cleanedOptions = options?.map((o) => o.trim()).filter(Boolean);

  const questionPayload: QuestionPayload = {
    id: questionId,
    issueId,
    team,
    question: question.trim(),
    status: 'PENDING',
    ...(cleanedOptions && cleanedOptions.length > 0
      ? { options: cleanedOptions }
      : {}),
  };

  const updatedData: TaskPayload = {
    ...job.data,
    question: questionPayload,
  };

  await job.updateData(updatedData);

  try {
    await updateIssueStatus(issueId, 'blocked');
  } catch (err) {
    console.warn(
      `[questions] Failed to set status:blocked on issue #${issueId}:`,
      err,
    );
  }

  const event = parseEvent({
    event: 'QUESTION_PENDING',
    data: {
      questionId,
      issueId,
      team,
      question: questionPayload.question,
      ...(questionPayload.options ? { options: questionPayload.options } : {}),
    },
  });
  await recordEvent(event);

  return questionPayload;
}

export async function getOpenQuestions(): Promise<QuestionPayload[]> {
  if (!activeQueueManager) return [];

  const list: QuestionPayload[] = [];
  for (const team of TEAMS) {
    const queue = activeQueueManager.getQueue(team);
    const jobs = await queue.getJobs(['active', 'delayed', 'waiting']);
    for (const job of jobs) {
      if (job.data?.question?.status === 'PENDING') {
        list.push(job.data.question);
      }
    }
  }
  return list;
}

export async function answerQuestion(
  questionId: string,
  answer: string,
): Promise<{ ok: boolean }> {
  const match = questionId.match(/^(\d+)-(\d+)$/);
  if (!match) {
    throw new QuestionNotFoundError(`Invalid question ID: ${questionId}`);
  }
  if (!activeQueueManager) {
    throw new QuestionNotFoundError(`Question ${questionId} not found`);
  }
  if (answeringIds.has(questionId)) {
    throw new QuestionConflictError(`Question ${questionId} already answered`);
  }

  answeringIds.add(questionId);
  try {
    const issueId = Number(match[1]);
    const trimmedAnswer = answer.trim();
    const jobId = jobIdForIssue(issueId);

    let targetTeam: Team | undefined;
    for (const team of TEAMS) {
      const queue = activeQueueManager.getQueue(team);
      const job = await queue.getJob(jobId);
      if (job?.data?.question?.id === questionId) {
        targetTeam = team;
        break;
      }
    }

    if (!targetTeam) {
      throw new QuestionNotFoundError(`Question ${questionId} not found`);
    }

    const queue = activeQueueManager.getQueue(targetTeam);
    const fresh = await queue.getJob(jobId);
    if (fresh?.data?.question?.id !== questionId) {
      throw new QuestionNotFoundError(`Question ${questionId} not found`);
    }
    if (fresh.data.question.status === 'ANSWERED') {
      throw new QuestionConflictError(
        `Question ${questionId} already answered`,
      );
    }

    const updatedData: TaskPayload = {
      ...fresh.data,
      question: {
        ...fresh.data.question,
        status: 'ANSWERED',
        answer: trimmedAnswer,
      },
    };
    await fresh.updateData(updatedData);

    const state =
      typeof fresh.getState === 'function'
        ? await fresh.getState()
        : (fresh as unknown as { state?: string }).state;
    if (state === 'delayed' && typeof fresh.promote === 'function') {
      await fresh.promote();
    }

    try {
      await updateIssueStatus(issueId, 'queued');
    } catch (err) {
      console.warn(
        `[questions] Failed to set status:queued on issue #${issueId}:`,
        err,
      );
    }

    const event = parseEvent({
      event: 'QUESTION_RESOLVED',
      data: {
        questionId,
        issueId,
        team: fresh.data.team,
        answer: trimmedAnswer,
      },
    });
    await recordEvent(event);

    return { ok: true };
  } finally {
    answeringIds.delete(questionId);
  }
}

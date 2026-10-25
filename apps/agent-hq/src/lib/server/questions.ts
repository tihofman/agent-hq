import {
  jobIdForIssue,
  type QueueManagerLike,
  type QuestionPayload,
  type TaskPayload,
  type Team,
} from '@agent-hq/queue';
import { recordEvent } from './history';
import { setGhRunner, updateIssueStatus } from './issue-ingest';
import { getHomeRepoRoot, loadRepos } from './repos';
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
  /** `owner/name`; without it the question belongs to the home repo. */
  repo?: string;
  jobId?: string;
}

async function jobState(job: {
  getState?: () => Promise<string>;
}): Promise<string | undefined> {
  return typeof job.getState === 'function'
    ? await job.getState()
    : (job as { state?: string }).state;
}

/** Job IDs a question may belong to, most specific first. */
function candidateJobIds({ issueId, repo, jobId }: AskQuestionInput): string[] {
  if (jobId) return [jobId];
  if (repo) return [jobIdForIssue(issueId, repo)];
  const home = loadRepos().find((e) => e.path === getHomeRepoRoot());
  return [
    jobIdForIssue(issueId),
    ...(home ? [jobIdForIssue(issueId, home.repo)] : []),
  ];
}

export async function askQuestion(
  input: AskQuestionInput,
): Promise<QuestionPayload> {
  const { issueId, team, question, options, repo } = input;
  if (!activeQueueManager) {
    throw new QuestionConflictError(
      'No active job for issue (queue unavailable)',
    );
  }

  const queue = activeQueueManager.getQueue(team);
  let job: Awaited<ReturnType<typeof queue.getJob>>;
  let state: string | undefined;
  // A finished legacy `issue-<n>` job must not shadow the active one.
  for (const id of candidateJobIds(input)) {
    const candidate = await queue.getJob(id);
    if (!candidate) continue;
    const candidateState = await jobState(candidate);
    if (!job || candidateState === 'active') {
      job = candidate;
      state = candidateState;
    }
    if (state === 'active') break;
  }

  if (
    !job ||
    job.data.issueId !== issueId ||
    (repo !== undefined && job.data.repo !== repo)
  ) {
    throw new QuestionConflictError(`No active job for issue #${issueId}`);
  }
  const jobRepo = job.data.repo;

  if (state !== 'active') {
    throw new QuestionConflictError(
      `Job for issue #${issueId} is not active (state: ${state})`,
    );
  }

  // Repo names contain '-', so the counter is the last segment. Owners never contain '.'.
  const prevId = job.data.question?.id ?? '';
  const prev = Number(prevId.slice(prevId.lastIndexOf('-') + 1)) || 0;
  const questionId = `${jobRepo ? `${jobRepo.replace('/', '.')}.` : ''}${issueId}-${prev + 1}`;
  const trimmedOptions = options?.map((o) => o.trim()).filter(Boolean);
  const cleanedOptions = trimmedOptions
    ? [...new Set(trimmedOptions)]
    : undefined;

  const questionPayload: QuestionPayload = {
    id: questionId,
    issueId,
    ...(jobRepo ? { repo: jobRepo } : {}),
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
    await updateIssueStatus(issueId, 'blocked', jobRepo);
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
      ...(jobRepo ? { repo: jobRepo } : {}),
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
  // Legacy `<n>-<k>` or `<owner>.<name>.<n>-<k>`; the job is found via its data, not the ID.
  if (!/^[A-Za-z0-9_.-]+-\d+$/.test(questionId)) {
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
    const trimmedAnswer = answer.trim();

    let targetTeam: Team | undefined;
    let jobId: string | undefined;
    for (const team of TEAMS) {
      const jobs = await activeQueueManager
        .getQueue(team)
        .getJobs(['active', 'delayed', 'waiting']);
      const job = jobs.find((j) => j?.data?.question?.id === questionId);
      if (job?.id) {
        targetTeam = team;
        jobId = job.id;
        break;
      }
    }

    if (!targetTeam || !jobId) {
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

    const { issueId, repo } = fresh.data;
    try {
      await updateIssueStatus(issueId, 'queued', repo);
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
        ...(repo ? { repo } : {}),
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

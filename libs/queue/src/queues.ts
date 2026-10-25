import type { Team } from './types.js';

/**
 * BullMQ forbids colons (':') in queue names.
 * Therefore, hyphenated names are used: tasks-frontend, tasks-backend, tasks-qa.
 */
export const QUEUE_NAMES = {
  frontend: 'tasks-frontend',
  backend: 'tasks-backend',
  qa: 'tasks-qa',
} as const satisfies Record<Team, string>;

export type QueueName = (typeof QUEUE_NAMES)[Team];

export function getQueueName(team: Team): QueueName {
  return QUEUE_NAMES[team];
}

/** Repo-unique job ID `<owner>/<name>#<n>`; without repo the legacy `issue-<n>`. */
export function jobIdForIssue(issueId: number, repo?: string): string {
  return repo ? `${repo}#${issueId}` : `issue-${issueId}`;
}

/** Only for legacy `issue-<n>` IDs; repo jobs are read via their job data. */
export function issueIdFromJobId(jobId: string): number | undefined {
  if (!/^issue-[1-9]\d*$/.test(jobId)) return undefined;
  const issueId = Number(jobId.slice(6));
  return Number.isSafeInteger(issueId) ? issueId : undefined;
}

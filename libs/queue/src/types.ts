export const TEAMS = ['frontend', 'backend', 'qa'] as const;
export type Team = (typeof TEAMS)[number];

export type Provider = 'claude' | 'agy' | 'codex';

export type QuestionStatus = 'PENDING' | 'ANSWERED';

export interface QuestionPayload {
  id: string;
  issueId: number;
  /** `owner/name`; absent for legacy home-repo jobs. */
  repo?: string;
  team: Team;
  question: string;
  options?: string[];
  status: QuestionStatus;
  answer?: string;
}

export interface TaskPayload {
  issueId: number;
  /** `owner/name`; absent for legacy home-repo jobs (`issue-<n>`). */
  repo?: string;
  title: string;
  team: Team;
  body: string;
  labels: string[];
  question?: QuestionPayload;
  lastError?: string;
}

export interface EventPayload {
  event: string;
  timestamp?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

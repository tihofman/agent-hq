export type Team = 'frontend' | 'backend' | 'qa';

export type Provider = 'claude' | 'agy' | 'codex';

export type QuestionStatus = 'PENDING' | 'ANSWERED';

export interface QuestionPayload {
  id: string;
  issueId: number;
  team: Team;
  question: string;
  options?: string[];
  status: QuestionStatus;
  answer?: string;
}

export interface TaskPayload {
  issueId: number;
  title: string;
  team: Team;
  body: string;
  labels: string[];
  question?: QuestionPayload;
  sessionId?: string;
  provider?: Provider;
  lastError?: string;
}

export interface EventPayload {
  event: string;
  timestamp?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

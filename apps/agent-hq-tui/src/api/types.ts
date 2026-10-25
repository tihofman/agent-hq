import {
  TEAMS,
  type Team,
  type Provider,
  type QuestionPayload,
  type QuestionStatus,
} from '@agent-hq/queue/types';

export {
  TEAMS,
  type Team,
  type Provider,
  type QuestionPayload,
  type QuestionStatus,
};

export type Agent = 'claude' | 'agy' | 'codex';
export const AGENTS: readonly Agent[] = ['claude', 'agy', 'codex'] as const;

export type TeamStatus = 'idle' | 'working' | 'waiting_input' | 'cooldown';

export interface AgentSlotState {
  status: string;
  room?: string;
  runId?: string;
  cooldownUntil?: string;
}

export interface Run {
  runId: string;
  agent: Agent;
  status:
    | 'handover'
    | 'running'
    | 'complete'
    | 'failed'
    | 'aborted'
    | 'cooldown'
    | 'stale';
  ticketId?: string;
  repo?: string;
  timestamp: string;
  logFile?: string;
  data?: {
    title?: string;
    repo?: string;
    branch?: string;
    logChunk?: string;
    issueId?: number;
    [key: string]: unknown;
  };
}

export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

export interface DraftPR {
  number: number;
  title: string;
  url: string;
}

export interface RepoItem {
  repo: string | null;
  home: boolean;
  queues: Record<Team, QueueCounts>;
  draftPRs: DraftPR[];
}

export interface RepoStatsResponse {
  homeRepo: string | null;
  repos: RepoItem[];
}

export interface HQState {
  agents: Record<Agent, AgentSlotState>;
  runs: Record<string, Run>;
  activePR: (DraftPR & { status?: string }) | null;
  questions?: Record<string, QuestionPayload>;
  teams?: Record<Team, { status: TeamStatus }>;
}

export interface SSEMessage {
  event: string;
  data: string;
}

export interface StreamUpdatePayload {
  event: {
    event: string;
    agent?: Agent;
    runId?: string;
    ticketId?: string;
    timestamp: string;
    data?: {
      title?: string;
      logChunk?: string;
      repo?: string;
      branch?: string;
      questionId?: string;
      question?: string;
      options?: string[];
      answer?: string;
      [key: string]: unknown;
    };
  };
  state: HQState;
}

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

// Wire contract of the HQ server API (ADR 0008): shared by server, web UI and TUI.

export type Agent = 'claude' | 'agy' | 'codex';
export type Room = 'ceo' | 'hall' | 'dev' | 'qa' | 'lounge';

export type EventType =
  | 'TASK_HANDOVER'
  | 'TASK_START'
  | 'TASK_PROGRESS'
  | 'TASK_COMPLETE'
  | 'TASK_FAILED'
  | 'TASK_ABORTED'
  | 'RUN_STALE'
  | 'DRAFT_PR_CREATED'
  | 'REVIEW_START'
  | 'PR_READY'
  | 'CI_CHECK_PASS'
  | 'CI_CHECK_FAIL'
  | 'MERGED'
  | 'PR_CLOSED'
  | 'RATE_LIMITED'
  | 'SUBSCRIPTION_FAILOVER'
  | 'QUESTION_PENDING'
  | 'QUESTION_RESOLVED';

export interface EventData {
  title?: string;
  statusText?: string;
  exitCode?: number | null;
  logFile?: string;
  prNumber?: number;
  criteriaTotal?: number;
  criteriaCompleted?: number;
  cooldownUntil?: string;
  logChunk?: string;
  repo?: string;
  branch?: string;
  team?: Team;
  from?: Agent;
  to?: Agent | null;
  questionId?: string;
  issueId?: number;
  question?: string;
  options?: string[];
  answer?: string;
}

export type HQEvent = {
  [T in EventType]: {
    event: T;
    agent?: Agent;
    timestamp: string;
    room: Room;
    runId?: string;
    ticketId?: string;
    pid?: number | null;
    cwd?: string;
    data: EventData;
  };
}[EventType];

export type AgentStatus =
  | 'idle'
  | 'walking'
  | 'handover'
  | 'coding'
  | 'testing'
  | 'reviewing'
  | 'errorAlert'
  | 'cooldown';
export interface AgentState {
  status: AgentStatus;
  room: Room;
  runId?: string;
  cooldownUntil?: string;
}

export type RunStatus =
  | 'handover'
  | 'running'
  | 'complete'
  | 'failed'
  | 'aborted'
  | 'cooldown'
  | 'stale';
export interface Run {
  runId: string;
  agent: Agent;
  pid?: number | null;
  ticketId?: string;
  cwd?: string;
  logFile?: string;
  exitCode?: number | null;
  status: RunStatus;
  room?: Room;
  timestamp: string;
  data: EventData;
  repo?: string;
}

export type TeamStatus = 'idle' | 'working' | 'waiting_input';
export interface TeamState {
  status: TeamStatus;
}

export type ActivePR = EventData & {
  status?: 'draft' | 'reviewing' | 'ready' | 'merged' | 'closed';
  ci?: 'pass' | 'fail';
};

/** `INIT_STATE` payload of `/api/stream`. */
export interface HQState {
  agents: Record<Agent, AgentState>;
  runs: Record<string, Run>;
  activePR: ActivePR | null;
  questions?: Record<string, QuestionPayload>;
  teams?: Record<Team, TeamState>;
}

// Animation, test-parser and timer callbacks supply actions instead of reducer side effects.
export type InternalAction =
  | {
      type: 'ARRIVED' | 'TEST_STARTED' | 'TEST_FINISHED' | 'DISMISS_ERROR';
      agent: Agent;
    }
  | { type: 'TICK'; timestamp: string }
  | { type: 'SET_TEAM_STATUSES'; teams: Partial<Record<Team, TeamStatus>> };

/** `UPDATE` payload of `/api/stream`. */
export interface StreamUpdatePayload {
  event: HQEvent | InternalAction;
  state: HQState;
}

/** `/api/repos` item. */
export interface RepoEntry {
  repo: string;
  path: string;
  enabled: boolean;
}

export type QueueState = 'waiting' | 'active' | 'delayed' | 'failed';
export type QueueCounts = Record<QueueState, number>;

export interface DraftPR {
  number: number;
  title: string;
  url: string;
}

export interface RepoStats {
  /** `owner/name`; null for the home repo when `gh` cannot name it. */
  repo: string | null;
  home: boolean;
  queues: Record<Team, QueueCounts>;
  draftPRs: DraftPR[];
}

/** `/api/repos/stats` response. */
export interface RepoStatsResponse {
  homeRepo: string | null;
  repos: RepoStats[];
}

export interface HistoryRun extends Run {
  startedAt: string;
  durationMs: number;
  events: HQEvent[];
}

/** `/api/history` item. */
export interface HistoryRunItem extends HistoryRun {
  logExists: boolean;
  prUrl?: string | null;
}

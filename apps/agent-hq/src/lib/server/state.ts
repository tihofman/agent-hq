import type { QuestionPayload } from '@agent-hq/queue';

export type Agent = 'claude' | 'agy' | 'codex';
export type Room = 'ceo' | 'hall' | 'dev' | 'qa' | 'lounge';

const eventRooms = {
  TASK_HANDOVER: 'hall',
  TASK_START: 'dev',
  TASK_PROGRESS: 'dev',
  TASK_COMPLETE: 'dev',
  TASK_FAILED: 'dev',
  TASK_ABORTED: 'lounge',
  RUN_STALE: 'lounge',
  DRAFT_PR_CREATED: 'qa',
  REVIEW_START: 'qa',
  PR_READY: 'qa',
  CI_CHECK_PASS: 'qa',
  CI_CHECK_FAIL: 'qa',
  MERGED: 'ceo',
  PR_CLOSED: 'lounge',
  RATE_LIMITED: 'lounge',
  SUBSCRIPTION_FAILOVER: 'lounge',
  QUESTION_PENDING: 'dev',
  QUESTION_RESOLVED: 'dev',
} as const satisfies Record<string, Room>;
export type EventType = keyof typeof eventRooms;
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
  team?: 'frontend' | 'backend' | 'qa';
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
    agent: Agent;
    timestamp: string;
    room: Room;
    runId?: string;
    ticketId?: string;
    pid?: number | null;
    cwd?: string;
    data: EventData;
  };
}[EventType];

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}
function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

/** Normalizes the wire format; the runner sends null PID/exitCode before launch. */
export function parseEvent(
  input: unknown,
  now: () => string = () => new Date().toISOString(),
): HQEvent {
  const raw = object(input, 'event input');
  if (typeof raw.event !== 'string' || !Object.hasOwn(eventRooms, raw.event))
    throw new Error('event must be a supported event type');
  const data = raw.data === undefined ? {} : object(raw.data, 'data');
  const rawAgent =
    raw.agent === undefined && raw.event === 'SUBSCRIPTION_FAILOVER'
      ? data.from
      : raw.agent === undefined &&
          (raw.event === 'QUESTION_PENDING' ||
            raw.event === 'QUESTION_RESOLVED')
        ? 'claude'
        : raw.agent;
  if (!['claude', 'agy', 'codex'].includes(rawAgent as string))
    throw new Error('agent must be claude, agy or codex');
  if (
    raw.room !== undefined &&
    !['ceo', 'hall', 'dev', 'qa', 'lounge'].includes(raw.room as string)
  )
    throw new Error('room must be ceo, hall, dev, qa or lounge');
  const timestamp = raw.timestamp === undefined ? now() : raw.timestamp;
  if (!validDate(timestamp))
    throw new Error('timestamp must be an ISO timestamp');
  const result: HQEvent = {
    event: raw.event as EventType,
    agent: rawAgent as Agent,
    timestamp,
    room: (raw.room as Room | undefined) ?? eventRooms[raw.event as EventType],
    data: {},
  };
  for (const field of ['runId', 'ticketId', 'cwd'] as const) {
    const value = raw[field];
    if (value !== undefined) {
      if (typeof value !== 'string' || (field === 'runId' && !value.trim()))
        throw new Error(
          `${field} must be a${field === 'runId' ? ' non-empty' : ''} string`,
        );
      result[field] = value;
    }
  }
  if (raw.pid !== undefined) {
    if (
      raw.pid !== null &&
      !(Number.isSafeInteger(raw.pid) && (raw.pid as number) > 0)
    )
      throw new Error('pid must be a positive integer or null');
    result.pid = raw.pid as number | null;
  }
  for (const field of [
    'title',
    'statusText',
    'logFile',
    'logChunk',
    'cooldownUntil',
    'repo',
    'branch',
  ] as const) {
    const value = data[field];
    if (value !== undefined) {
      if (
        typeof value !== 'string' ||
        (field === 'cooldownUntil' && !validDate(value))
      )
        throw new Error(
          `data.${field} must be ${field === 'cooldownUntil' ? 'an ISO timestamp' : 'a string'}`,
        );
      result.data[field] = value;
    }
  }
  if (data.team !== undefined) {
    if (!['frontend', 'backend', 'qa'].includes(data.team as string))
      throw new Error('data.team must be frontend, backend or qa');
    result.data.team = data.team as 'frontend' | 'backend' | 'qa';
  }
  if (data.from !== undefined) {
    if (!['claude', 'agy', 'codex'].includes(data.from as string))
      throw new Error('data.from must be claude, agy or codex');
    result.data.from = data.from as Agent;
  }
  if (data.to !== undefined) {
    if (
      data.to !== null &&
      !['claude', 'agy', 'codex'].includes(data.to as string)
    )
      throw new Error('data.to must be claude, agy, codex or null');
    result.data.to = data.to as Agent | null;
  }
  for (const field of [
    'exitCode',
    'prNumber',
    'criteriaTotal',
    'criteriaCompleted',
  ] as const) {
    const value = data[field];
    if (value !== undefined) {
      if (field === 'exitCode' && value === null) {
        result.data.exitCode = null;
        continue;
      }
      if (
        !Number.isSafeInteger(value) ||
        (value as number) < (field === 'prNumber' ? 1 : 0)
      )
        throw new Error(
          `data.${field} must be ${field === 'prNumber' ? 'a positive' : 'a non-negative'} integer`,
        );
      result.data[field] = value as number;
    }
  }
  for (const field of ['questionId', 'question', 'answer'] as const) {
    const value = data[field];
    if (value !== undefined) {
      if (typeof value !== 'string' || !value.trim())
        throw new Error(`data.${field} must be a non-empty string`);
      result.data[field] = value;
    }
  }
  if (data.issueId !== undefined) {
    if (!Number.isSafeInteger(data.issueId) || (data.issueId as number) <= 0)
      throw new Error('data.issueId must be a positive integer');
    result.data.issueId = data.issueId as number;
  }
  if (data.options !== undefined) {
    if (
      !Array.isArray(data.options) ||
      data.options.some((o) => typeof o !== 'string')
    )
      throw new Error('data.options must be an array of strings');
    result.data.options = [...data.options];
  }
  return result;
}

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
}
export interface State {
  agents: Record<Agent, AgentState>;
  runs: Record<string, Run>;
  activePR:
    | (EventData & {
        status?: 'draft' | 'reviewing' | 'ready' | 'merged' | 'closed';
        ci?: 'pass' | 'fail';
      })
    | null;
  questions?: Record<string, QuestionPayload>;
}
export const initialState: State = {
  agents: {
    claude: { status: 'idle', room: 'lounge' },
    agy: { status: 'idle', room: 'lounge' },
    codex: { status: 'idle', room: 'lounge' },
  },
  runs: {},
  activePR: null,
  questions: {},
};

// Animation, test-parser and timer callbacks supply actions instead of reducer side effects.
export type InternalAction =
  | {
      type: 'ARRIVED' | 'TEST_STARTED' | 'TEST_FINISHED' | 'DISMISS_ERROR';
      agent: Agent;
    }
  | { type: 'TICK'; timestamp: string };

export function reduce(state: State, event: HQEvent | InternalAction): State {
  if ('type' in event) {
    if (event.type === 'TICK') {
      let next = state;
      for (const agent of ['claude', 'agy', 'codex'] as const) {
        const current = next.agents[agent];
        if (
          current.status === 'cooldown' &&
          current.cooldownUntil &&
          Date.parse(event.timestamp) >= Date.parse(current.cooldownUntil)
        ) {
          const { cooldownUntil, ...rest } = current;
          next = {
            ...next,
            agents: {
              ...next.agents,
              [agent]: { ...rest, status: 'idle', room: 'lounge' },
            },
          };
        }
      }
      return next;
    }
    const current = state.agents[event.agent];
    const transitions = {
      ARRIVED: ['walking', 'handover'],
      TEST_STARTED: ['coding', 'testing'],
      TEST_FINISHED: ['testing', 'coding'],
      DISMISS_ERROR: ['errorAlert', 'idle'],
    } as const;
    const [from, to] = transitions[event.type];
    if (current.status !== from) return state;
    return {
      ...state,
      agents: {
        ...state.agents,
        [event.agent]: {
          ...current,
          status: to,
          room: to === 'idle' ? 'lounge' : current.room,
        },
      },
    };
  }
  if (event.event === 'QUESTION_PENDING') {
    const q: QuestionPayload = {
      id: event.data.questionId ?? `${event.data.issueId ?? 0}-1`,
      issueId: event.data.issueId ?? 0,
      team: event.data.team ?? 'frontend',
      question: event.data.question ?? '',
      ...(event.data.options ? { options: event.data.options } : {}),
      status: 'PENDING',
    };
    return {
      ...state,
      questions: {
        ...(state.questions ?? {}),
        [q.id]: q,
      },
    };
  }
  if (event.event === 'QUESTION_RESOLVED') {
    const id = event.data.questionId;
    if (id && state.questions && Object.hasOwn(state.questions, id)) {
      const { [id]: _, ...remaining } = state.questions;
      return {
        ...state,
        questions: remaining,
      };
    }
    return state;
  }
  const previousRun =
    event.runId && Object.hasOwn(state.runs, event.runId)
      ? state.runs[event.runId]
      : undefined;
  if (previousRun?.status === 'aborted') return state;
  const current = state.agents[event.agent];
  const statuses: Partial<Record<EventType, AgentStatus>> = {
    TASK_HANDOVER: 'walking',
    TASK_START: 'coding',
    TASK_COMPLETE: 'idle',
    TASK_FAILED: 'errorAlert',
    TASK_ABORTED: 'idle',
    RUN_STALE: 'idle',
    DRAFT_PR_CREATED: 'reviewing',
    REVIEW_START: 'reviewing',
    PR_READY: 'idle',
    MERGED: 'idle',
    PR_CLOSED: 'idle',
    RATE_LIMITED: 'cooldown',
    SUBSCRIPTION_FAILOVER: 'cooldown',
  };
  const runStatuses: Partial<Record<EventType, RunStatus>> = {
    TASK_HANDOVER: 'handover',
    TASK_START: 'running',
    TASK_COMPLETE: 'complete',
    TASK_FAILED: 'failed',
    TASK_ABORTED: 'aborted',
    RUN_STALE: 'stale',
    RATE_LIMITED: 'cooldown',
  };
  // Progress after an elapsed (or open-ended) cooldown means the run resumed.
  const resumed = (status?: string, until?: string) =>
    event.event === 'TASK_PROGRESS' &&
    status === 'cooldown' &&
    (!until || Date.parse(event.timestamp) >= Date.parse(until));
  const runResumed = resumed(
    previousRun?.status,
    previousRun?.data.cooldownUntil,
  );
  let runs = state.runs;
  if (event.runId) {
    const run: Run = {
      ...previousRun,
      runId: event.runId,
      agent: previousRun?.agent ?? event.agent,
      status: runResumed
        ? 'running'
        : (runStatuses[event.event] ?? previousRun?.status ?? 'running'),
      room: event.room,
      timestamp: event.timestamp,
      data: { ...previousRun?.data, ...event.data },
    };
    for (const field of ['pid', 'ticketId', 'cwd'] as const) {
      if (event[field] !== undefined && event[field] !== null)
        Object.assign(run, { [field]: event[field] });
    }
    if (event.data.logFile !== undefined) run.logFile = event.data.logFile;
    if (event.data.exitCode !== undefined && event.data.exitCode !== null)
      run.exitCode = event.data.exitCode;
    runs = { ...runs, [event.runId]: run };
  }
  let agents = state.agents;
  // Late completion of another run must not move an agent off its current task.
  if (
    !event.runId ||
    (!current.runId && event.event !== 'RUN_STALE') ||
    current.runId === event.runId ||
    event.event === 'TASK_START' ||
    event.event === 'TASK_HANDOVER'
  ) {
    const { cooldownUntil, ...rest } = current;
    const agent: AgentState = {
      ...rest,
      status:
        runResumed || resumed(current.status, current.cooldownUntil)
          ? 'coding'
          : (statuses[event.event] ?? current.status),
      room: event.room,
    };
    if (event.runId) agent.runId = event.runId;
    if (agent.status === 'cooldown') {
      const until = event.data.cooldownUntil ?? cooldownUntil;
      if (until) agent.cooldownUntil = until;
    }
    agents = { ...agents, [event.agent]: agent };
  }
  let activePR = state.activePR;
  const prStatuses = {
    DRAFT_PR_CREATED: 'draft',
    REVIEW_START: 'reviewing',
    PR_READY: 'ready',
    MERGED: 'merged',
    PR_CLOSED: 'closed',
  } as const;
  if (
    Object.hasOwn(prStatuses, event.event) ||
    event.event === 'CI_CHECK_PASS' ||
    event.event === 'CI_CHECK_FAIL'
  ) {
    const samePR =
      event.data.prNumber === undefined ||
      event.data.prNumber === activePR?.prNumber;
    activePR = { ...(samePR ? activePR : null), ...event.data };
    if (Object.hasOwn(prStatuses, event.event))
      activePR.status = prStatuses[event.event as keyof typeof prStatuses];
    if (event.event === 'CI_CHECK_PASS' || event.event === 'CI_CHECK_FAIL')
      activePR.ci = event.event === 'CI_CHECK_PASS' ? 'pass' : 'fail';
  }
  return { agents, runs, activePR, questions: state.questions };
}

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  parseEvent,
  type Agent,
  type EventData,
  type EventType,
  type HQEvent,
  type RunStatus,
} from './state';

const runStatuses: Partial<Record<EventType, RunStatus>> = {
  TASK_HANDOVER: 'handover',
  TASK_START: 'running',
  TASK_COMPLETE: 'complete',
  TASK_FAILED: 'failed',
  TASK_ABORTED: 'aborted',
  RATE_LIMITED: 'cooldown',
};

export interface HistoryRun {
  runId: string;
  agent: Agent;
  status: RunStatus;
  timestamp: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  pid?: number | null;
  ticketId?: string;
  cwd?: string;
  logFile?: string;
  exitCode?: number | null;
  prNumber?: number;
  data: EventData;
  events: HQEvent[];
}

export type RunHistoryEntry = HistoryRun;
export type HistoricalRun = HistoryRun;

export function getHistoryDir(): string {
  const env = process.env.AGENT_HQ_HOME?.trim();
  if (env) return env;
  return join(homedir(), '.agent-hq');
}

export function getHistoryPath(): string {
  return join(getHistoryDir(), 'history.jsonl');
}

export async function appendHistory(event: HQEvent): Promise<void> {
  try {
    const dir = getHistoryDir();
    if (
      (process.env.VITEST || process.env.NODE_ENV === 'test') &&
      !process.env.AGENT_HQ_HOME?.trim()
    ) {
      console.error(
        'Refusing to write to history: AGENT_HQ_HOME not set in test environment',
      );
      return;
    }
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify(event) + '\n';
    await appendFile(getHistoryPath(), line, 'utf8');
  } catch (err) {
    console.error('Failed to append event to history:', err);
  }
}

export async function readHistory(): Promise<HQEvent[]> {
  const filePath = getHistoryPath();
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const events: HQEvent[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const event = parseEvent(parsed);
      events.push(event);
    } catch {
      // Skip corrupt or invalid lines
      continue;
    }
  }
  return events;
}

export async function readRecentRuns(limit = 20): Promise<HistoryRun[]> {
  const events = await readHistory();
  const runsMap = new Map<string, HistoryRun>();

  for (const event of events) {
    if (!event.runId) continue;

    let run = runsMap.get(event.runId);
    if (!run) {
      run = {
        runId: event.runId,
        agent: event.agent,
        status: runStatuses[event.event] ?? 'running',
        timestamp: event.timestamp,
        startedAt: event.timestamp,
        endedAt: event.timestamp,
        durationMs: 0,
        data: {},
        events: [],
      };
      runsMap.set(event.runId, run);
    }

    run.events.push(event);
    run.timestamp = event.timestamp;
    run.endedAt = event.timestamp;
    const duration = Date.parse(run.endedAt) - Date.parse(run.startedAt);
    run.durationMs = Number.isNaN(duration) ? 0 : Math.max(0, duration);

    if (runStatuses[event.event]) {
      run.status = runStatuses[event.event]!;
    }
    if (event.ticketId !== undefined) run.ticketId = event.ticketId;
    if (event.cwd !== undefined) run.cwd = event.cwd;
    if (event.pid !== undefined) run.pid = event.pid;
    if (event.data.logFile !== undefined) run.logFile = event.data.logFile;
    if (event.data.exitCode !== undefined) run.exitCode = event.data.exitCode;
    if (event.data.prNumber !== undefined) run.prNumber = event.data.prNumber;
    run.data = { ...run.data, ...event.data };
  }

  const runs = Array.from(runsMap.values());
  runs.sort((a, b) => {
    const diff = Date.parse(b.startedAt) - Date.parse(a.startedAt);
    if (diff !== 0 && !Number.isNaN(diff)) return diff;
    return b.runId.localeCompare(a.runId);
  });

  if (limit !== undefined) {
    return runs.slice(0, Math.max(0, limit));
  }
  return runs;
}

export const getRecentRuns = readRecentRuns;

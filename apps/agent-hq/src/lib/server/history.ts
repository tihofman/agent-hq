import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  initialState,
  parseEvent,
  reduce,
  type HQEvent,
  type Run,
} from './state';

export interface HistoryRun extends Run {
  startedAt: string;
  durationMs: number;
  events: HQEvent[];
}

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
  const state = events.reduce((s, e) => reduce(s, e), initialState);

  const eventsByRun = new Map<string, HQEvent[]>();
  for (const event of events) {
    if (!event.runId) continue;
    let list = eventsByRun.get(event.runId);
    if (!list) {
      list = [];
      eventsByRun.set(event.runId, list);
    }
    list.push(event);
  }

  const runs: HistoryRun[] = Object.values(state.runs).map((run) => {
    const runEvents = eventsByRun.get(run.runId) ?? [];
    const startedAt = runEvents[0]?.timestamp ?? run.timestamp;
    const duration = Date.parse(run.timestamp) - Date.parse(startedAt);
    const durationMs = Number.isNaN(duration) ? 0 : Math.max(0, duration);

    return {
      ...run,
      startedAt,
      durationMs,
      events: runEvents,
    };
  });

  runs.sort((a, b) => {
    const diff = Date.parse(b.startedAt) - Date.parse(a.startedAt);
    if (diff !== 0 && !Number.isNaN(diff)) return diff;
    return b.runId.localeCompare(a.runId);
  });

  return runs.slice(0, Math.max(0, limit));
}

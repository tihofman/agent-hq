import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  initialState,
  parseEvent,
  reduce,
  type HQEvent,
  type Run,
} from './state';
import { dispatch, getState } from './store';
import { isRunStale, type RunStaleOptions } from '../runs';

export interface HistoryRun extends Run {
  startedAt: string;
  durationMs: number;
  events: HQEvent[];
}

function isBlockedHistoryDir(dir: string): boolean {
  const home = resolve(homedir());
  const agentHqDir = resolve(home, '.agent-hq');
  const target = resolve(dir);

  if (target === home) return true;
  const rel = relative(agentHqDir, target);
  return (
    rel === '' ||
    (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel))
  );
}

export function getHistoryDir(): string {
  const env = process.env.AGENT_HQ_HOME?.trim();
  const dir = env || join(homedir(), '.agent-hq');
  if (process.env.VITEST && isBlockedHistoryDir(dir)) {
    throw new Error(
      `Refusing to use ~/.agent-hq during tests (process.env.VITEST is set). Set AGENT_HQ_HOME to an isolated test directory.`,
    );
  }
  return dir;
}

export function getHistoryPath(): string {
  return join(getHistoryDir(), 'history.jsonl');
}

export async function appendHistory(event: HQEvent): Promise<void> {
  const dir = getHistoryDir();
  const filePath = join(dir, 'history.jsonl');
  try {
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify(event) + '\n';
    await appendFile(filePath, line, 'utf8');
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

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return false;
    }
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

let writeQueue: Promise<void> = Promise.resolve();

export function recordEvent(event: HQEvent): Promise<void> {
  dispatch(event);
  writeQueue = writeQueue.then(() => appendHistory(event));
  return writeQueue;
}

export async function sweepStaleRuns(options?: RunStaleOptions): Promise<void> {
  const isAlive = options?.isAlive ?? isProcessAlive;
  const nowClock =
    options?.now !== undefined
      ? () => new Date(options.now!).toISOString()
      : undefined;
  const writes: Promise<void>[] = [];
  for (const run of Object.values(getState().runs)) {
    if (isRunStale(run, { ...options, isAlive })) {
      const event = parseEvent(
        {
          event: 'RUN_STALE',
          agent: run.agent,
          runId: run.runId,
        },
        nowClock,
      );
      writes.push(recordEvent(event));
    }
  }
  await Promise.all(writes);
}

export async function readRecentRuns(
  limit = 20,
  options?: RunStaleOptions,
): Promise<HistoryRun[]> {
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

    const isStale = isRunStale(run, {
      ...options,
      isAlive: options?.isAlive ?? isProcessAlive,
    });
    const status = isStale ? 'stale' : run.status;

    return {
      ...run,
      status,
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

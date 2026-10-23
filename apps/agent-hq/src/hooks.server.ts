import type { ServerInit } from '@sveltejs/kit/hooks';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sweepStaleRuns } from './lib/server/history';
import {
  startConfiguredIssueIngest,
  stopConfiguredIssueIngest,
} from './lib/server/issue-ingest';
import { dispatch, getState } from './lib/server/store';
import { startTail } from './lib/server/tail';
import {
  WorkerPool,
  isV2WorkersEnabled,
  deriveAllTeamStatuses,
  TEAMS,
  type WorkerPoolOptions,
  type QueueManagerLike,
  type TeamStatus,
} from './lib/server/worker-pool';
import type { Team, TeamState } from './lib/server/state';

export { sweepStaleRuns };

export const GLOBAL_TAILER_KEY = '__agent_hq_tailer__';
export const GLOBAL_WORKER_POOL_KEY = '__agent_hq_worker_pool__';

type TailerGlobal = typeof globalThis & {
  [GLOBAL_TAILER_KEY]?: () => void;
  [GLOBAL_WORKER_POOL_KEY]?: () => Promise<void>;
};

export function getLogDir(): string {
  return process.env['AGENT_HQ_LOG_DIR'] || join(tmpdir(), 'agent-hq');
}

export function startServerTail(options?: {
  dir?: string;
  isAlive?: (pid: number) => boolean;
  now?: () => number;
}): () => void {
  const globalRef = globalThis as TailerGlobal;
  globalRef[GLOBAL_TAILER_KEY]?.();

  const dir = options?.dir ?? getLogDir();

  const stopTail = startTail({
    dir,
    onEvent: (event) => {
      dispatch(event);
    },
    resolveAgent: (runId) => getState().runs[runId]?.agent,
    isRunActive: (runId) => {
      const status = getState().runs[runId]?.status;
      return (
        status === 'handover' || status === 'running' || status === 'cooldown'
      );
    },
  });

  const timer = setInterval(() => {
    if (
      Object.values(getState().agents).some(
        (agent) => agent.status === 'cooldown',
      )
    ) {
      dispatch({ type: 'TICK', timestamp: new Date().toISOString() });
    }
  }, 5_000);
  timer.unref();

  const staleTimer = setInterval(() => {
    void sweepStaleRuns({
      isAlive: options?.isAlive,
      now: options?.now?.(),
    });
  }, 30_000);
  staleTimer.unref();

  const stop = () => {
    clearInterval(timer);
    clearInterval(staleTimer);
    stopTail();
    if (globalRef[GLOBAL_TAILER_KEY] === stop) {
      delete globalRef[GLOBAL_TAILER_KEY];
    }
  };

  globalRef[GLOBAL_TAILER_KEY] = stop;
  return stop;
}

export function stopServerTail(): void {
  const globalRef = globalThis as TailerGlobal;
  globalRef[GLOBAL_TAILER_KEY]?.();
}

export function hasTeamStatusesChanged(
  current: Record<Team, TeamState> | undefined,
  next: Record<Team, TeamStatus>,
): boolean {
  if (!current) return true;
  return TEAMS.some((team) => current[team]?.status !== next[team]);
}

export function createTeamStatusPoller(
  getQueueManager: () => QueueManagerLike | undefined,
  getCurrentTeams: () => Record<Team, TeamState> | undefined,
  onDispatch: (statuses: Record<Team, TeamStatus>) => void,
  logError: (msg: string, err: unknown) => void = (msg, err) =>
    console.error(msg, err),
): () => Promise<void> {
  let isPolling = false;
  let lastLoggedError: string | null = null;

  return async () => {
    if (isPolling) return;
    isPolling = true;
    try {
      const qm = getQueueManager();
      if (!qm) return;
      const statuses = await deriveAllTeamStatuses(qm);
      lastLoggedError = null;
      if (hasTeamStatusesChanged(getCurrentTeams(), statuses)) {
        onDispatch(statuses);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== lastLoggedError) {
        lastLoggedError = msg;
        logError('Failed to poll team statuses:', err);
      }
    } finally {
      isPolling = false;
    }
  };
}

export async function startServerWorkers(
  options?: WorkerPoolOptions,
): Promise<WorkerPool | null> {
  const globalRef = globalThis as TailerGlobal;
  await globalRef[GLOBAL_WORKER_POOL_KEY]?.();

  const pool = new WorkerPool({
    logDir: getLogDir(),
    ...options,
  });
  if (!pool.enabled || !(await pool.start())) {
    return null;
  }

  const pollStatuses = createTeamStatusPoller(
    () => pool.queueManager,
    () => getState().teams,
    (statuses) => dispatch({ type: 'SET_TEAM_STATUSES', teams: statuses }),
  );

  const statusTimer = setInterval(pollStatuses, 2_000);
  statusTimer.unref();

  await pollStatuses();

  const stop = async () => {
    clearInterval(statusTimer);
    await pool.close();
    if (globalRef[GLOBAL_WORKER_POOL_KEY] === stop) {
      delete globalRef[GLOBAL_WORKER_POOL_KEY];
    }
  };
  globalRef[GLOBAL_WORKER_POOL_KEY] = stop;
  return pool;
}

export async function stopServerWorkers(): Promise<void> {
  const globalRef = globalThis as TailerGlobal;
  const stop = globalRef[GLOBAL_WORKER_POOL_KEY];
  delete globalRef[GLOBAL_WORKER_POOL_KEY];
  try {
    await stop?.();
  } catch (err) {
    console.warn('[hooks] could not stop server workers:', err);
  }
}

export const init: ServerInit = () => {
  try {
    startServerTail();
  } catch (err) {
    console.warn('[hooks] could not start server tail:', err);
  }

  if (isV2WorkersEnabled()) {
    try {
      startConfiguredIssueIngest();
    } catch (err) {
      console.warn('[hooks] could not start issue ingest:', err);
    }
    try {
      void startServerWorkers().catch((err) => {
        console.warn('[hooks] could not start server workers:', err);
      });
    } catch (err) {
      console.warn('[hooks] could not start server workers:', err);
    }
  }
};

async function stopServer(): Promise<void> {
  try {
    await stopConfiguredIssueIngest();
  } catch (err) {
    console.warn('[hooks] could not stop issue ingest:', err);
  }
  try {
    await stopServerWorkers();
  } catch (err) {
    console.warn('[hooks] could not stop server workers:', err);
  }
  try {
    await stopServerTail();
  } catch (err) {
    console.warn('[hooks] could not stop server tail:', err);
  }
}

process.on('sveltekit:shutdown', stopServer);

(
  import.meta as ImportMeta & {
    hot?: { dispose(cb: () => void | Promise<void>): void };
  }
).hot?.dispose(async () => {
  process.off('sveltekit:shutdown', stopServer);
  await stopServer();
});

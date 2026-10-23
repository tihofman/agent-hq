import type { ServerInit } from '@sveltejs/kit/hooks';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sweepStaleRuns } from './lib/server/history';
import { dispatch, getState } from './lib/server/store';
import { startTail } from './lib/server/tail';
import {
  WorkerPool,
  isV2WorkersEnabled,
  type WorkerPoolOptions,
} from './lib/server/worker-pool';

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
  void stopServerWorkers();
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
  if (!pool.enabled) {
    return null;
  }

  const started = await pool.start();
  if (!started) {
    return null;
  }

  const stop = async () => {
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
  await stop?.();
}

export const init: ServerInit = () => {
  startServerTail();
  if (isV2WorkersEnabled()) {
    void startServerWorkers();
  }
};

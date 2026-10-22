import type { ServerInit } from '@sveltejs/kit/hooks';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatch, getState } from './lib/server/store';
import { startTail } from './lib/server/tail';

export const GLOBAL_TAILER_KEY = '__agent_hq_tailer__';

type TailerGlobal = typeof globalThis & {
  [GLOBAL_TAILER_KEY]?: () => void;
};

export function getLogDir(): string {
  return process.env['AGENT_HQ_LOG_DIR'] || join(tmpdir(), 'agent-hq');
}

export function startServerTail(options?: { dir?: string }): () => void {
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
  }, 30_000);
  timer.unref();

  const stop = () => {
    clearInterval(timer);
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

export const init: ServerInit = () => {
  startServerTail();
};

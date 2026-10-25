import type { Run } from '@agent-hq/queue/types';

export const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

export interface RunStaleOptions {
  now?: number;
  isAlive?: (pid: number) => boolean;
}

export function isRunStale(run: Run, options?: RunStaleOptions): boolean {
  if (
    run.status !== 'handover' &&
    run.status !== 'running' &&
    run.status !== 'cooldown'
  ) {
    return false;
  }

  if (
    typeof run.pid === 'number' &&
    Number.isSafeInteger(run.pid) &&
    run.pid > 0
  ) {
    return options?.isAlive ? !options.isAlive(run.pid) : false;
  }

  const nowMs = options?.now ?? Date.now();
  const eventTime = Date.parse(run.timestamp);
  if (Number.isNaN(eventTime)) {
    return true;
  }

  return nowMs - eventTime > STALE_THRESHOLD_MS;
}

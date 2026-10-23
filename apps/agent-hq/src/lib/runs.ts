import type { Run } from './server/state';

export const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

export interface RunStaleOptions {
  now?: number | string | Date;
  staleThresholdMs?: number;
  isPidAlive?: (pid: number) => boolean;
}

export function isProcessAlive(pid: number): boolean {
  if (typeof process === 'undefined' || typeof process.kill !== 'function') {
    return true;
  }
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

export function isRunStale(run: Run, options?: RunStaleOptions): boolean {
  if (run.status === 'stale') {
    return true;
  }

  const isActive =
    run.status === 'handover' ||
    run.status === 'running' ||
    run.status === 'cooldown';

  if (!isActive) {
    return false;
  }

  const isPidAlive = options?.isPidAlive ?? isProcessAlive;

  if (
    typeof run.pid === 'number' &&
    Number.isSafeInteger(run.pid) &&
    run.pid > 0
  ) {
    return !isPidAlive(run.pid);
  }

  const nowMs =
    options?.now !== undefined
      ? typeof options.now === 'number'
        ? options.now
        : Date.parse(
            options.now instanceof Date
              ? options.now.toISOString()
              : String(options.now),
          )
      : Date.now();

  const thresholdMs = options?.staleThresholdMs ?? STALE_THRESHOLD_MS;

  const eventTime = Date.parse(run.timestamp);
  if (Number.isNaN(eventTime)) {
    return true;
  }

  return nowMs - eventTime > thresholdMs;
}

import type { Run, HQEvent } from '../../server/state';

export const RELOAD_EVENTS = new Set([
  'TASK_HANDOVER',
  'REVIEW_START',
  'PR_READY',
  'MERGED',
]);

export function hasReloadEvent(
  feed: readonly HQEvent[],
  lastSeen?: HQEvent,
): boolean {
  for (let i = feed.length - 1; i >= 0; i--) {
    const ev = feed[i];
    if (ev === lastSeen) {
      break;
    }
    if (RELOAD_EVENTS.has(ev.event)) {
      return true;
    }
  }
  return false;
}

export function getCurrentRun(runs: Record<string, Run>): Run | undefined {
  const list = Object.values(runs);
  if (list.length === 0) return undefined;

  const active = list.filter(
    (r) => r.status === 'handover' || r.status === 'running',
  );
  if (active.length > 0) {
    return active.reduce((latest, current) => {
      const currentTs = Date.parse(current.timestamp) || 0;
      const latestTs = Date.parse(latest.timestamp) || 0;
      return currentTs >= latestTs ? current : latest;
    });
  }

  return list.reduce((latest, current) => {
    const currentTs = Date.parse(current.timestamp) || 0;
    const latestTs = Date.parse(latest.timestamp) || 0;
    return currentTs >= latestTs ? current : latest;
  });
}

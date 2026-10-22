import type { Run } from '../../server/state';

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

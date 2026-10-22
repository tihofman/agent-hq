import type { State, HQEvent, Run } from './server/state';
import { detectPendingInput } from './feed';

export interface NotificationPayload {
  title: string;
  body: string;
}

/**
 * Pure evaluation function returning notification details for relevant events.
 *
 * Scenarios:
 * 1. TASK_FAILED -> Failure alert
 * 2. PR_READY -> Pull request ready for manual review/merge
 * 3. Waiting for input -> Prompt detected via detectPendingInput
 */
export function notificationFor(
  entry: unknown,
  state?: State,
  nowMs?: number,
): NotificationPayload | null {
  if (!entry || typeof entry !== 'object' || !('event' in entry)) {
    return null;
  }

  const item = entry as HQEvent;

  if (item.event === 'TASK_FAILED') {
    const title = item.ticketId
      ? `Task fehlgeschlagen (${item.ticketId})`
      : 'Task fehlgeschlagen';
    const body =
      item.data?.statusText ||
      (item.ticketId
        ? `Task für ${item.ticketId} ist fehlgeschlagen.`
        : 'Ein Task ist fehlgeschlagen.');
    return { title, body };
  }

  if (item.event === 'PR_READY') {
    const prNum = item.data?.prNumber ?? state?.activePR?.prNumber;
    const title = prNum
      ? `PR #${prNum} bereit zum Merge`
      : 'PR bereit zum Merge';
    const body =
      item.data?.title ||
      'Der Pull Request ist bereit für den manuellen Merge.';
    return { title, body };
  }

  if (item.event === 'TASK_PROGRESS') {
    const runs = state?.runs ?? {};
    const effectiveRuns: Record<string, Run> = { ...runs };
    if (
      item.runId &&
      (!effectiveRuns[item.runId] ||
        effectiveRuns[item.runId].status !== 'running')
    ) {
      if (!state?.runs?.[item.runId]) {
        effectiveRuns[item.runId] = {
          runId: item.runId,
          agent: item.agent,
          status: 'running',
          timestamp: item.timestamp,
          data: item.data,
        };
      }
    }

    const checkTime =
      nowMs !== undefined
        ? nowMs
        : Number.isFinite(Date.parse(item.timestamp))
          ? Date.parse(item.timestamp) + 10_000
          : Date.now();

    const pending = detectPendingInput([item], effectiveRuns, checkTime);
    if (pending.isPending) {
      return {
        title: 'Agent wartet auf Eingabe',
        body:
          pending.promptText ||
          'Bestätigung oder Eingabe im Terminal erforderlich.',
      };
    }
  }

  return null;
}

/**
 * Identifies new entries added to a feed since the last processed item object.
 *
 * Safe against feed capping (e.g. constant 1000 items length).
 */
export function findNewEntries<T>(
  feed: T[],
  lastSeen: T | null | undefined,
  options?: { isInitial?: boolean },
): T[] {
  if (!feed || feed.length === 0) return [];
  if (options?.isInitial) return [];
  if (lastSeen === null || lastSeen === undefined) {
    return feed.slice();
  }
  const index = feed.lastIndexOf(lastSeen);
  if (index === -1) {
    return feed.slice();
  }
  return feed.slice(index + 1);
}

/**
 * Requests browser notification permission. Must ONLY be triggered by user action (e.g. click).
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') {
    return 'denied';
  }
  if (
    Notification.permission === 'granted' ||
    Notification.permission === 'denied'
  ) {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/**
 * Dispatches a native browser notification if permissions are granted.
 */
export function showNotification(
  title: string,
  options?: NotificationOptions,
): Notification | null {
  if (
    typeof Notification === 'undefined' ||
    Notification.permission !== 'granted'
  ) {
    return null;
  }
  try {
    return new Notification(title, options);
  } catch {
    return null;
  }
}

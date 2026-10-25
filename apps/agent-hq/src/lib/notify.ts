import type { HQState, HQEvent } from '@agent-hq/queue/types';

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
 */
export function notificationFor(
  entry: unknown,
  state?: HQState,
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

  return null;
}

/**
 * Identifies new entries added to a feed since the last processed item object.
 *
 * Safe against feed capping (e.g. constant 1000 items length).
 * If lastSeen was evicted from the capped feed (index === -1), returns at most
 * the latest single entry (feed.slice(-1)) to prevent an old notification/audio flood.
 */
export function findNewEntries<T>(
  feed: T[],
  lastSeen: T | null | undefined,
): T[] {
  if (!feed || feed.length === 0) return [];
  if (lastSeen === null || lastSeen === undefined) {
    return feed.slice();
  }
  const index = feed.lastIndexOf(lastSeen);
  if (index === -1) {
    return feed.slice(-1);
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

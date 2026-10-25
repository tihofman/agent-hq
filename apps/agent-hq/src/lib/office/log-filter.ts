import type {
  Agent,
  HQEvent,
  InternalAction,
  Run,
} from '@agent-hq/queue/types';

export interface CharacterTarget {
  agent: Agent;
  runId?: string;
}

/**
 * Filters the feed for a character sprite.
 * - When target has an active runId: returns TASK_PROGRESS log chunks for that exact run.
 * - When target has no runId (e.g. claude or idle agent): returns all feed events for that agent.
 */
export function filterCharacterLog(
  feed: readonly (HQEvent | InternalAction)[],
  target: CharacterTarget,
): (HQEvent | InternalAction)[] {
  if (target.runId) {
    return filterRunLogChunks(feed, target.runId);
  }
  return filterAgentFeed(feed, target.agent);
}

/**
 * Returns only TASK_PROGRESS events that contain non-empty logChunk data for the given runId.
 */
export function filterRunLogChunks(
  feed: readonly (HQEvent | InternalAction)[],
  runId: string,
): HQEvent[] {
  return feed.filter(
    (item): item is HQEvent =>
      'event' in item &&
      item.event === 'TASK_PROGRESS' &&
      item.runId === runId &&
      typeof item.data?.logChunk === 'string' &&
      item.data.logChunk.length > 0,
  );
}

/**
 * Returns all events in the feed associated with the specified agent.
 */
export function filterAgentFeed(
  feed: readonly (HQEvent | InternalAction)[],
  agent: Agent,
): (HQEvent | InternalAction)[] {
  return feed.filter((item) => 'agent' in item && item.agent === agent);
}

/**
 * Resolves the logFile path from a run if present (e.g. for fallback display).
 */
export function getLogFileFallback(run?: Run | null): string | undefined {
  return run?.logFile ?? run?.data?.logFile;
}

/**
 * Formats the aria-label for a character sprite button.
 * Contains both Agent and Ticket if ticketId is present.
 */
export function formatCharacterAriaLabel(
  displayName: string,
  ticketId?: string,
): string {
  if (!ticketId || !ticketId.trim()) {
    return displayName;
  }
  const formattedTicket = ticketId.trim().startsWith('#')
    ? ticketId.trim()
    : `#${ticketId.trim()}`;
  return `${displayName} - Ticket ${formattedTicket}`;
}

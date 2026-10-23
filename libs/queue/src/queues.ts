import type { Team } from './types.js';

/**
 * BullMQ forbids colons (':') in queue names.
 * Therefore, hyphenated names are used: tasks-frontend, tasks-backend, tasks-qa.
 */
export const QUEUE_NAMES = {
  frontend: 'tasks-frontend',
  backend: 'tasks-backend',
  qa: 'tasks-qa',
} as const satisfies Record<Team, string>;

export type QueueTeam = keyof typeof QUEUE_NAMES;
export type QueueName = (typeof QUEUE_NAMES)[QueueTeam];

export function getQueueName(team: Team): QueueName {
  const name = QUEUE_NAMES[team];
  if (!name) {
    throw new Error(
      `Unknown team: "${team}". Must be one of: frontend, backend, qa.`,
    );
  }
  return name;
}

export const ALL_QUEUE_NAMES: readonly QueueName[] = [
  QUEUE_NAMES.frontend,
  QUEUE_NAMES.backend,
  QUEUE_NAMES.qa,
] as const;

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

export type QueueName = (typeof QUEUE_NAMES)[Team];

export function getQueueName(team: Team): QueueName {
  return QUEUE_NAMES[team];
}

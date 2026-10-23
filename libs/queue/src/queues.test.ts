import { describe, expect, it } from 'vitest';
import { ALL_QUEUE_NAMES, getQueueName, QUEUE_NAMES } from './queues.js';
import type { Team } from './types.js';

describe('Queue Names', () => {
  it('maps each team to a BullMQ-compatible name without colons', () => {
    expect.assertions(6);
    expect(QUEUE_NAMES.frontend).toBe('tasks-frontend');
    expect(QUEUE_NAMES.backend).toBe('tasks-backend');
    expect(QUEUE_NAMES.qa).toBe('tasks-qa');

    // BullMQ explicitly forbids ':' in queue names
    expect(QUEUE_NAMES.frontend.includes(':')).toBe(false);
    expect(QUEUE_NAMES.backend.includes(':')).toBe(false);
    expect(QUEUE_NAMES.qa.includes(':')).toBe(false);
  });

  it('getQueueName returns the correct queue name for each team', () => {
    expect.assertions(3);
    expect(getQueueName('frontend')).toBe('tasks-frontend');
    expect(getQueueName('backend')).toBe('tasks-backend');
    expect(getQueueName('qa')).toBe('tasks-qa');
  });

  it('getQueueName throws for invalid teams', () => {
    expect.assertions(1);
    expect(() => getQueueName('unknown' as unknown as Team)).toThrow(
      'Unknown team: "unknown"',
    );
  });

  it('ALL_QUEUE_NAMES contains exactly the three team queues', () => {
    expect.assertions(2);
    expect(ALL_QUEUE_NAMES).toHaveLength(3);
    expect(ALL_QUEUE_NAMES).toEqual([
      'tasks-frontend',
      'tasks-backend',
      'tasks-qa',
    ]);
  });
});

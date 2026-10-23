import { describe, expect, it } from 'vitest';
import { getQueueName, QUEUE_NAMES } from './queues.js';

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
});

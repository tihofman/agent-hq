import { describe, expect, it } from 'vitest';
import {
  getQueueName,
  QUEUE_NAMES,
  jobIdForIssue,
  issueIdFromJobId,
} from './queues.js';

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

describe('issue job IDs', () => {
  it('uses a nonnumeric BullMQ job ID and parses it back', () => {
    expect(jobIdForIssue(99)).toBe('issue-99');
    expect(issueIdFromJobId(jobIdForIssue(99))).toBe(99);
  });
  it.each([
    '99',
    'other-99',
    'issue-',
    'issue-1x',
    'issue-0',
    'issue-01',
    'issue-9007199254740992',
  ])('ignores foreign or invalid ID %s', (id) => {
    expect(issueIdFromJobId(id)).toBeUndefined();
  });
});

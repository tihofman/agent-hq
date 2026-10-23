import { describe, expect, it } from 'vitest';
import {
  type TaskPayload,
  type QuestionPayload,
  type EventPayload,
  type Team,
  QUEUE_NAMES,
  getQueueName,
  DEFAULT_REDIS_URL,
} from '@agent-hq/queue';

describe('apps/agent-hq integration with @agent-hq/queue', () => {
  it('imports types and constants from @agent-hq/queue', () => {
    expect.assertions(6);

    const team: Team = 'frontend';
    expect(team).toBe('frontend');

    const question: QuestionPayload = {
      id: '95-1',
      issueId: 95,
      team: 'frontend',
      question: 'Should we use hyphenated queue names?',
      options: ['Yes', 'No'],
      status: 'PENDING',
    };

    const task: TaskPayload = {
      issueId: 95,
      title: 'BullMQ Queue-Core',
      team: 'frontend',
      body: 'Implement libs/queue',
      labels: ['agent:agy', 'team:frontend'],
      question,
      sessionId: 'session-xyz',
    };

    const event: EventPayload = {
      event: 'QUESTION_PENDING',
      timestamp: new Date().toISOString(),
      data: {
        questionId: question.id,
        issueId: question.issueId,
        team: question.team,
        question: question.question,
      },
    };

    expect(task.issueId).toBe(95);
    expect(task.question?.status).toBe('PENDING');
    expect(event.event).toBe('QUESTION_PENDING');
    expect(getQueueName('frontend')).toBe(QUEUE_NAMES.frontend);
    expect(DEFAULT_REDIS_URL).toBe('redis://127.0.0.1:6379');
  });
});

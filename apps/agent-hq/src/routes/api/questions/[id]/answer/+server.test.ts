import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { POST } from './+server';
import {
  resetStore,
  getState,
  dispatch,
} from '../../../../../lib/server/store';
import {
  setQueueManager,
  setGhRunner,
  resetQuestionsState,
} from '../../../../../lib/server/questions';
import type {
  QueueManagerLike,
  WorkerJob,
} from '../../../../../lib/server/worker-pool';
import type { TaskPayload, Team } from '@agent-hq/queue';
import { jobIdForIssue } from '@agent-hq/queue';
import { parseEvent } from '../../../../../lib/server/state';
import type { Queue, Worker } from 'bullmq';

function createEvent(request: Request, id: string): RequestEvent {
  return {
    request,
    url: new URL(request.url),
    params: { id },
  } as unknown as RequestEvent;
}

interface MockJobRecord extends WorkerJob {
  id: string;
  state: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed';
  promote: ReturnType<typeof vi.fn>;
}

class MockQueueManager implements QueueManagerLike {
  readonly jobs = new Map<string, MockJobRecord>();

  addJob(
    team: Team,
    issueId: number,
    state: 'waiting' | 'active' | 'delayed' = 'delayed',
  ): MockJobRecord {
    const data: TaskPayload = {
      issueId,
      title: `Task #${issueId}`,
      team,
      body: 'Task body',
      labels: [`team:${team}`],
    };
    const id = jobIdForIssue(issueId);
    const job: MockJobRecord = {
      id,
      data,
      state,
      updateData: vi.fn(async (next: TaskPayload) => {
        job.data = next;
      }),
      moveToDelayed: vi.fn(async () => {
        job.state = 'delayed';
      }),
      promote: vi.fn(async () => {
        job.state = 'waiting';
      }),
    };
    this.jobs.set(id, job);
    return job;
  }

  getQueue(team: Team): Queue<TaskPayload> {
    return {
      getJob: async (jobId: string) => this.jobs.get(jobId),
      getJobs: async (types: string[] = ['active', 'delayed', 'waiting']) => {
        return Array.from(this.jobs.values()).filter(
          (j) => j.data.team === team && types.includes(j.state),
        );
      },
    } as unknown as Queue<TaskPayload>;
  }

  createWorker(): Worker<TaskPayload> {
    return {} as unknown as Worker<TaskPayload>;
  }

  close = vi.fn(async () => {});
}

describe('POST /api/questions/:id/answer', () => {
  let tempDir: string;
  let manager: MockQueueManager;
  let ghCalls: string[][];
  const originalHome = process.env.AGENT_HQ_HOME;

  beforeEach(async () => {
    resetStore();
    resetQuestionsState();
    tempDir = await mkdtemp(join(tmpdir(), 'hq-answer-test-'));
    process.env.AGENT_HQ_HOME = tempDir;

    manager = new MockQueueManager();
    setQueueManager(manager);

    ghCalls = [];
    setGhRunner(async (args) => {
      ghCalls.push(args);
      if (args[1] === 'view') {
        return JSON.stringify({
          labels: [{ name: 'team:frontend' }, { name: 'status:blocked' }],
        });
      }
      return '';
    });
  });

  afterEach(async () => {
    resetQuestionsState();
    resetStore();
    if (originalHome !== undefined) {
      process.env.AGENT_HQ_HOME = originalHome;
    } else {
      delete process.env.AGENT_HQ_HOME;
    }
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('rejects foreign origin with 403', async () => {
    const request = new Request(
      'http://localhost:3333/api/questions/101-1/answer',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://malicious.org',
        },
        body: JSON.stringify({ answer: 'Option A' }),
      },
    );

    const response = await POST(createEvent(request, '101-1'));
    expect(response.status).toBe(403);
  });

  it('rejects invalid answer and length limits with 400', async () => {
    const tests = [
      'not json',
      {},
      { answer: '' },
      { answer: 123 },
      { answer: 'a'.repeat(5001) },
    ];

    for (const testBody of tests) {
      const request = new Request(
        'http://localhost:3333/api/questions/101-1/answer',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body:
            typeof testBody === 'string' ? testBody : JSON.stringify(testBody),
        },
      );

      const response = await POST(createEvent(request, '101-1'));
      expect(response.status).toBe(400);
    }
  });

  it('returns 404 when question ID is unknown', async () => {
    const request = new Request(
      'http://localhost:3333/api/questions/999-1/answer',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'My answer' }),
      },
    );

    const response = await POST(createEvent(request, '999-1'));
    expect(response.status).toBe(404);
  });

  it('answers pending question, promotes job and broadcasts QUESTION_RESOLVED', async () => {
    const job = manager.addJob('frontend', 101, 'delayed');
    job.data.question = {
      id: '101-1',
      issueId: 101,
      team: 'frontend',
      question: 'Use Svelte 5 snippets?',
      status: 'PENDING',
    };

    // Pre-populate question in state to verify resolution
    dispatch(
      parseEvent({
        event: 'QUESTION_PENDING',
        data: {
          questionId: '101-1',
          issueId: 101,
          team: 'frontend',
          question: 'Use Svelte 5 snippets?',
        },
      }),
    );
    expect(getState().questions?.['101-1']).toBeDefined();

    const request = new Request(
      'http://localhost:3333/api/questions/101-1/answer',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'Yes, use snippets' }),
      },
    );

    const response = await POST(createEvent(request, '101-1'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // Job updated
    expect(job.data.question?.status).toBe('ANSWERED');
    expect(job.data.question?.answer).toBe('Yes, use snippets');
    expect(job.updateData).toHaveBeenCalled();

    // Job promoted back to queue
    expect(job.promote).toHaveBeenCalled();

    // Label updated: status:blocked removed and status:queued added
    expect(ghCalls).toEqual([
      ['issue', 'view', '101', '--json', 'labels'],
      [
        'issue',
        'edit',
        '101',
        '--add-label',
        'status:queued',
        '--remove-label',
        'status:blocked',
      ],
    ]);

    // QUESTION_RESOLVED emitted -> removed from open questions in state
    expect(getState().questions?.['101-1']).toBeUndefined();
  });

  it('accepts answer while job is still active (grace period) without calling promote()', async () => {
    const job = manager.addJob('frontend', 101, 'active');
    job.data.question = {
      id: '101-1',
      issueId: 101,
      team: 'frontend',
      question: 'Answer during grace period?',
      status: 'PENDING',
    };

    const request = new Request(
      'http://localhost:3333/api/questions/101-1/answer',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'Quick answer' }),
      },
    );

    const response = await POST(createEvent(request, '101-1'));
    expect(response.status).toBe(200);
    expect(job.data.question?.status).toBe('ANSWERED');
    expect(job.data.question?.answer).toBe('Quick answer');
    expect(job.promote).not.toHaveBeenCalled();
  });

  it('atomically prevents concurrent double answers with 409', async () => {
    const job = manager.addJob('frontend', 101, 'delayed');
    job.data.question = {
      id: '101-1',
      issueId: 101,
      team: 'frontend',
      question: 'Concurrent answer?',
      status: 'PENDING',
    };

    const makeReq = (answer: string) =>
      POST(
        createEvent(
          new Request('http://localhost:3333/api/questions/101-1/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer }),
          }),
          '101-1',
        ),
      );

    const [res1, res2] = await Promise.all([
      makeReq('First'),
      makeReq('Second'),
    ]);
    expect([res1.status, res2.status].sort()).toEqual([200, 409]);
    expect(job.data.question?.answer).toBe('First');
  });

  it('returns 409 when answering a question that was already answered', async () => {
    const job = manager.addJob('frontend', 101, 'delayed');
    job.data.question = {
      id: '101-1',
      issueId: 101,
      team: 'frontend',
      question: 'Already answered?',
      status: 'ANSWERED',
      answer: 'First answer',
    };

    const request = new Request(
      'http://localhost:3333/api/questions/101-1/answer',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'Second answer' }),
      },
    );

    const response = await POST(createEvent(request, '101-1'));
    expect(response.status).toBe(409);
  });
});

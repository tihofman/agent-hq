import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { GET, POST } from './+server';
import { resetStore, getState } from '../../../lib/server/store';
import {
  setQueueManager,
  setGhRunner,
  resetQuestionsState,
} from '../../../lib/server/questions';
import type {
  QueueManagerLike,
  WorkerJob,
} from '../../../lib/server/worker-pool';
import type { QuestionPayload, TaskPayload, Team } from '@agent-hq/queue';
import { jobIdForIssue } from '@agent-hq/queue';
import type { Queue, Worker } from 'bullmq';

function createEvent(request: Request): RequestEvent {
  return {
    request,
    url: new URL(request.url),
    params: {},
  } as unknown as RequestEvent;
}

interface MockJobRecord extends WorkerJob {
  id: string;
  state: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed';
}

class MockQueueManager implements QueueManagerLike {
  readonly jobs = new Map<string, MockJobRecord>();

  addJob(
    team: Team,
    issueId: number,
    state: 'waiting' | 'active' | 'delayed' | 'completed' = 'active',
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

describe('Questions API: POST & GET /api/questions', () => {
  let tempDir: string;
  let manager: MockQueueManager;
  let ghCalls: string[][];
  const originalHome = process.env.AGENT_HQ_HOME;

  beforeEach(async () => {
    resetStore();
    resetQuestionsState();
    tempDir = await mkdtemp(join(tmpdir(), 'hq-questions-test-'));
    process.env.AGENT_HQ_HOME = tempDir;

    manager = new MockQueueManager();
    setQueueManager(manager);

    ghCalls = [];
    setGhRunner(async (args) => {
      ghCalls.push(args);
      if (args[1] === 'view') {
        return JSON.stringify({
          labels: [{ name: 'team:frontend' }, { name: 'status:in-progress' }],
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

  it('rejects forbidden browser origin with 403', async () => {
    const request = new Request('http://localhost:3333/api/questions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://malicious-site.com',
      },
      body: JSON.stringify({
        issueId: 101,
        team: 'frontend',
        question: 'What is this?',
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(403);
  });

  it('allows CLI request without Origin header and creates question on active job', async () => {
    const job = manager.addJob('frontend', 101, 'active');

    const request = new Request('http://localhost:3333/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issueId: 101,
        team: 'frontend',
        question: 'Should we use tabs or spaces?',
        options: ['Tabs', 'Spaces'],
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      ok: boolean;
      question: QuestionPayload;
    };
    expect(body.ok).toBe(true);
    expect(body.question).toEqual({
      id: '101-1',
      issueId: 101,
      team: 'frontend',
      question: 'Should we use tabs or spaces?',
      options: ['Tabs', 'Spaces'],
      status: 'PENDING',
    });

    // Verified in job data
    expect(job.updateData).toHaveBeenCalled();
    expect(job.data.question?.id).toBe('101-1');
    expect(job.data.question?.status).toBe('PENDING');

    // Verified GitHub CLI calls (view then edit removing only present status:in-progress)
    expect(ghCalls).toEqual([
      ['issue', 'view', '101', '--json', 'labels'],
      [
        'issue',
        'edit',
        '101',
        '--add-label',
        'status:blocked',
        '--remove-label',
        'status:in-progress',
      ],
    ]);

    // Verified QUESTION_PENDING in state
    expect(getState().questions?.['101-1']).toBeDefined();
    expect(getState().questions?.['101-1'].status).toBe('PENDING');
  });

  it('increments question counter if job already had a question', async () => {
    const job = manager.addJob('frontend', 101, 'active');
    job.data.question = {
      id: '101-1',
      issueId: 101,
      team: 'frontend',
      question: 'First question',
      status: 'ANSWERED',
      answer: 'First answer',
    };

    const request = new Request('http://localhost:3333/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issueId: 101,
        team: 'frontend',
        question: 'Second question?',
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      ok: boolean;
      question: QuestionPayload;
    };
    expect(body.question.id).toBe('101-2');
  });

  it('deduplicates options after trimming whitespace', async () => {
    manager.addJob('frontend', 105, 'active');

    const request = new Request('http://localhost:3333/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issueId: 105,
        team: 'frontend',
        question: 'Which option?',
        options: ['  Retry  ', 'Abort', 'Retry', '  Abort  ', 'Ignore'],
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      ok: boolean;
      question: QuestionPayload;
    };
    expect(body.question.options).toEqual(['Retry', 'Abort', 'Ignore']);
  });

  it('returns 409 when no active job is found for issue', async () => {
    // Job exists but is waiting, not active
    manager.addJob('frontend', 102, 'waiting');

    const request = new Request('http://localhost:3333/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issueId: 102,
        team: 'frontend',
        question: 'Wait for me?',
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(409);
  });

  it('returns 400 for invalid body payloads and length limits', async () => {
    const tests = [
      'invalid json',
      {},
      { issueId: 'invalid', team: 'frontend', question: 'Valid' },
      { issueId: 101, team: 'unknown-team', question: 'Valid' },
      { issueId: 101, team: 'frontend', question: '' },
      { issueId: 101, team: 'frontend', question: 'x'.repeat(2001) },
      { issueId: 101, team: 'frontend', question: 'Valid', options: [123] },
      {
        issueId: 101,
        team: 'frontend',
        question: 'Valid',
        options: Array.from({ length: 11 }, (_, i) => `Opt ${i}`),
      },
      {
        issueId: 101,
        team: 'frontend',
        question: 'Valid',
        options: ['y'.repeat(201)],
      },
    ];

    for (const testBody of tests) {
      const request = new Request('http://localhost:3333/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:
          typeof testBody === 'string' ? testBody : JSON.stringify(testBody),
      });

      const response = await POST(createEvent(request));
      expect(response.status).toBe(400);
    }
  });

  it('GET /api/questions lists all open pending questions across team queues', async () => {
    const job1 = manager.addJob('frontend', 101, 'delayed');
    job1.data.question = {
      id: '101-1',
      issueId: 101,
      team: 'frontend',
      question: 'Question 1',
      status: 'PENDING',
    };

    const job2 = manager.addJob('backend', 102, 'active');
    job2.data.question = {
      id: '102-1',
      issueId: 102,
      team: 'backend',
      question: 'Question 2',
      status: 'PENDING',
    };

    const job3 = manager.addJob('qa', 103, 'completed');
    job3.data.question = {
      id: '103-1',
      issueId: 103,
      team: 'qa',
      question: 'Question 3',
      status: 'ANSWERED',
    };

    const request = new Request('http://localhost:3333/api/questions');
    const response = await GET(createEvent(request));
    expect(response.status).toBe(200);

    const questions = (await response.json()) as QuestionPayload[];
    expect(questions).toHaveLength(2);
    expect(questions.map((q) => q.id)).toContain('101-1');
    expect(questions.map((q) => q.id)).toContain('102-1');
    expect(questions.map((q) => q.id)).not.toContain('103-1');
  });
});

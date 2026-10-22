import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { POST } from './+server';
import { clearGitCache } from '../../../lib/server/git';
import { getState, resetStore } from '../../../lib/server/store';
import { getHistoryPath } from '../../../lib/server/history';

function createEvent(request: Request): RequestEvent {
  return {
    request,
    url: new URL(request.url),
  } as unknown as RequestEvent;
}

describe('POST /api/events', () => {
  let tempDir: string;
  const originalEnv = process.env.AGENT_HQ_HOME;

  beforeEach(async () => {
    clearGitCache();
    resetStore();
    tempDir = await mkdtemp(join(tmpdir(), 'hq-events-test-'));
    process.env.AGENT_HQ_HOME = tempDir;
  });

  afterEach(async () => {
    clearGitCache();
    if (originalEnv !== undefined) {
      process.env.AGENT_HQ_HOME = originalEnv;
    } else {
      delete process.env.AGENT_HQ_HOME;
    }
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('accepts valid event and responds with 202', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
        runId: 'run-1',
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(202);
    expect(getState().agents.codex.status).toBe('coding');
  });

  it('accepts RequestEvent with { request, url }', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-2',
      }),
    });

    const event = {
      request,
      url: new URL(request.url),
    } as unknown as RequestEvent;
    const response = await POST(event);
    expect(response.status).toBe(202);
    expect(getState().agents.agy.status).toBe('coding');
  });

  it('rejects broken JSON with 400 and error message', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not json {',
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string };
    expect(body.error).toBeDefined();
    expect(typeof body.error).toBe('string');
  });

  it('rejects invalid event schema with 400 and error message', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'INVALID_EVENT_TYPE',
        agent: 'codex',
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('event must be a supported event type');
  });

  it('allows curl requests without Origin header', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'TASK_HANDOVER',
        agent: 'codex',
      }),
    });

    expect(request.headers.get('origin')).toBeNull();
    const response = await POST(createEvent(request));
    expect(response.status).toBe(202);
  });

  it('allows requests with origin http://127.0.0.1:3333', async () => {
    const request = new Request('http://127.0.0.1:3333/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:3333',
      },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(202);
  });

  it('allows requests with origin http://localhost:3333', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3333',
      },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(202);
  });

  it('allows requests with dev port from url.port (e.g. 5173)', async () => {
    const devRequestLocalhost = new Request(
      'http://localhost:5173/api/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({
          event: 'TASK_START',
          agent: 'codex',
        }),
      },
    );

    const res1 = await POST(createEvent(devRequestLocalhost));
    expect(res1.status).toBe(202);

    const devRequestIp = new Request('http://127.0.0.1:5173/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:5173',
      },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
      }),
    });

    const res2 = await POST(createEvent(devRequestIp));
    expect(res2.status).toBe(202);
  });

  it('rejects requests with foreign host even if port matches url.port', async () => {
    const request = new Request('http://localhost:5173/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://evil-site.com:5173',
      },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Forbidden');
  });

  it('rejects requests where Origin port does not match url.port', async () => {
    const request = new Request('http://localhost:5173/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3333',
      },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Forbidden');
  });

  it('rejects requests with malformed Origin header', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'not-a-valid-url',
      },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(403);
  });

  it('responds in under 50 ms locally', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
      }),
    });

    const start = performance.now();
    const response = await POST(createEvent(request));
    const duration = performance.now() - start;

    expect(response.status).toBe(202);
    expect(duration).toBeLessThan(50);
  });

  it('appends event as a JSON line to history upon successful POST', async () => {
    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-post-history',
        ticketId: '6',
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(202);

    const historyFile = getHistoryPath();
    const content = await vi.waitFor(() => readFile(historyFile, 'utf8'));
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.event).toBe('TASK_START');
    expect(parsed.agent).toBe('agy');
    expect(parsed.runId).toBe('run-post-history');
    expect(parsed.ticketId).toBe('6');
  });

  it('automatically resolves repo and branch when cwd points to a git repository', async () => {
    const repoPath = join(tempDir, 'sample-app');
    execFileSync('git', ['init', '-b', 'main', repoPath]);
    execFileSync('git', ['-C', repoPath, 'config', 'user.name', 'Tester']);
    execFileSync('git', [
      '-C',
      repoPath,
      'config',
      'user.email',
      'tester@example.com',
    ]);
    execFileSync('git', [
      '-C',
      repoPath,
      'commit',
      '--allow-empty',
      '-m',
      'init',
    ]);

    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
        runId: 'run-git-1',
        cwd: repoPath,
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(202);

    const run = getState().runs['run-git-1'];
    expect(run).toBeDefined();
    expect(run.data.repo).toBe('sample-app');
    expect(run.data.branch).toBe('main');
  });

  it('resolves main repo name and feature branch for a git worktree cwd', async () => {
    const mainRepoPath = join(tempDir, 'main-repo');
    const worktreePath = join(tempDir, 'worktree-feat-13');
    execFileSync('git', ['init', '-b', 'main', mainRepoPath]);
    execFileSync('git', ['-C', mainRepoPath, 'config', 'user.name', 'Tester']);
    execFileSync('git', [
      '-C',
      mainRepoPath,
      'config',
      'user.email',
      'tester@example.com',
    ]);
    execFileSync('git', [
      '-C',
      mainRepoPath,
      'commit',
      '--allow-empty',
      '-m',
      'init',
    ]);
    execFileSync('git', [
      '-C',
      mainRepoPath,
      'worktree',
      'add',
      '-b',
      'feat/13-test',
      worktreePath,
    ]);

    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-wt-1',
        cwd: worktreePath,
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(202);

    const run = getState().runs['run-wt-1'];
    expect(run).toBeDefined();
    expect(run.data.repo).toBe('main-repo');
    expect(run.data.branch).toBe('feat/13-test');
  });

  it('accepts event with invalid/non-git cwd, returning 202 without setting repo/branch', async () => {
    const nonGitPath = join(tempDir, 'not-a-git-repo');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(nonGitPath);

    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
        runId: 'run-nongit-1',
        cwd: nonGitPath,
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(202);

    const run = getState().runs['run-nongit-1'];
    expect(run).toBeDefined();
    expect(run.data.repo).toBeUndefined();
    expect(run.data.branch).toBeUndefined();
  });

  it('preserves explicitly supplied repo and branch without overriding from cwd', async () => {
    const repoPath = join(tempDir, 'explicit-repo');
    execFileSync('git', ['init', '-b', 'main', repoPath]);
    execFileSync('git', ['-C', repoPath, 'config', 'user.name', 'Tester']);
    execFileSync('git', [
      '-C',
      repoPath,
      'config',
      'user.email',
      'tester@example.com',
    ]);
    execFileSync('git', [
      '-C',
      repoPath,
      'commit',
      '--allow-empty',
      '-m',
      'init',
    ]);

    const request = new Request('http://localhost:3333/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'TASK_START',
        agent: 'codex',
        runId: 'run-explicit-1',
        cwd: repoPath,
        data: {
          repo: 'custom-repo',
          branch: 'custom-branch',
        },
      }),
    });

    const response = await POST(createEvent(request));
    expect(response.status).toBe(202);

    const run = getState().runs['run-explicit-1'];
    expect(run).toBeDefined();
    expect(run.data.repo).toBe('custom-repo');
    expect(run.data.branch).toBe('custom-branch');
  });
});

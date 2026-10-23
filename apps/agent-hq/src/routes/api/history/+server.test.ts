import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { RequestEvent } from '@sveltejs/kit';
import { GET } from './+server';
import { appendHistory } from '../../../lib/server/history';
import { parseEvent } from '../../../lib/server/state';
import type { HistoryRunItem } from '../../../lib/history-format';

const execFileAsync = promisify(execFile);

function createRequest(path = '/api/history', origin?: string): RequestEvent {
  const headers = new Headers();
  if (origin) {
    headers.set('Origin', origin);
  }
  const request = new Request(`http://127.0.0.1:3333${path}`, {
    method: 'GET',
    headers,
  });
  return {
    request,
    url: new URL(request.url),
  } as unknown as RequestEvent;
}

describe('GET /api/history', () => {
  let tempDir: string;
  let logDir: string;
  const originalEnvHome = process.env.AGENT_HQ_HOME;
  const originalEnvLog = process.env.AGENT_HQ_LOG_DIR;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'hq-history-route-test-'));
    logDir = join(tempDir, 'logs');
    await mkdir(logDir, { recursive: true });
    process.env.AGENT_HQ_HOME = tempDir;
    process.env.AGENT_HQ_LOG_DIR = logDir;
  });

  afterEach(async () => {
    if (originalEnvHome !== undefined) {
      process.env.AGENT_HQ_HOME = originalEnvHome;
    } else {
      delete process.env.AGENT_HQ_HOME;
    }
    if (originalEnvLog !== undefined) {
      process.env.AGENT_HQ_LOG_DIR = originalEnvLog;
    } else {
      delete process.env.AGENT_HQ_LOG_DIR;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects forbidden origin with 403', async () => {
    const res = await GET(
      createRequest('/api/history', 'http://malicious-site.com:3333'),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Forbidden origin');
  });

  it('returns empty array when history is empty', async () => {
    const res = await GET(createRequest('/api/history'));
    expect(res.status).toBe(200);
    const runs = (await res.json()) as HistoryRunItem[];
    expect(runs).toEqual([]);
  });

  it('returns runs with logExists: false when logFile does not exist', async () => {
    const nonExistentLog = join(logDir, 'does-not-exist.log');
    await appendHistory(
      parseEvent({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-1',
        ticketId: '18',
        data: { logFile: nonExistentLog },
      }),
    );
    await appendHistory(
      parseEvent({
        event: 'TASK_COMPLETE',
        agent: 'agy',
        runId: 'run-1',
        data: { exitCode: 0, prNumber: 42, repo: 'agent-hq' },
      }),
    );

    const res = await GET(createRequest('/api/history'));
    expect(res.status).toBe(200);
    const runs = (await res.json()) as HistoryRunItem[];
    expect(runs).toHaveLength(1);

    const run = runs[0];
    expect(run.runId).toBe('run-1');
    expect(run.agent).toBe('agy');
    expect(run.ticketId).toBe('18');
    expect(run.status).toBe('complete');
    expect(run.exitCode).toBe(0);
    expect(run.logExists).toBe(false);
    expect(run.logFile).toBe(nonExistentLog);
    expect(run.data.prNumber).toBe(42);
    expect(run.data.repo).toBe('agent-hq');
    expect(run.events).toHaveLength(2);
  });

  it('returns logExists: true when logFile exists on disk inside logDir', async () => {
    const realLog = join(logDir, 'run-2.log');
    await writeFile(realLog, 'some log lines...\n', 'utf8');

    await appendHistory(
      parseEvent({
        event: 'TASK_START',
        agent: 'codex',
        runId: 'run-2',
        ticketId: '20',
        data: { logFile: realLog },
      }),
    );
    await appendHistory(
      parseEvent({
        event: 'TASK_FAILED',
        agent: 'codex',
        runId: 'run-2',
        data: { exitCode: 2 },
      }),
    );

    const res = await GET(createRequest('/api/history'));
    expect(res.status).toBe(200);
    const runs = (await res.json()) as HistoryRunItem[];
    expect(runs).toHaveLength(1);

    const run = runs[0];
    expect(run.runId).toBe('run-2');
    expect(run.agent).toBe('codex');
    expect(run.status).toBe('failed');
    expect(run.exitCode).toBe(2);
    expect(run.logExists).toBe(true);
    expect(run.logFile).toBe(realLog);
  });

  it('returns logExists: false when logFile is outside logDir or is a directory', async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), 'hq-outside-'));
    const outsideFile = join(outsideDir, 'secret.log');
    await writeFile(outsideFile, 'secret\n', 'utf8');

    const subDir = join(logDir, 'subfolder');
    await mkdir(subDir, { recursive: true });

    await appendHistory(
      parseEvent({
        event: 'TASK_START',
        agent: 'claude',
        runId: 'run-outside',
        data: { logFile: outsideFile },
      }),
    );
    await appendHistory(
      parseEvent({
        event: 'TASK_START',
        agent: 'claude',
        runId: 'run-dir',
        data: { logFile: subDir },
      }),
    );

    const res = await GET(createRequest('/api/history'));
    expect(res.status).toBe(200);
    const runs = (await res.json()) as HistoryRunItem[];
    expect(runs).toHaveLength(2);

    const outsideRun = runs.find((r) => r.runId === 'run-outside');
    expect(outsideRun?.logExists).toBe(false);

    const dirRun = runs.find((r) => r.runId === 'run-dir');
    expect(dirRun?.logExists).toBe(false);

    await rm(outsideDir, { recursive: true, force: true });
  });

  it('returns logExists: false when logFile is a symlink in logDir pointing outside', async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), 'hq-outside-symlink-'));
    const outsideFile = join(outsideDir, 'secret.log');
    await writeFile(outsideFile, 'outside content\n', 'utf8');

    const symlinkPath = join(logDir, 'symlink-outside.log');
    await symlink(outsideFile, symlinkPath);

    await appendHistory(
      parseEvent({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-symlink-outside',
        data: { logFile: symlinkPath },
      }),
    );

    const res = await GET(createRequest('/api/history'));
    expect(res.status).toBe(200);
    const runs = (await res.json()) as HistoryRunItem[];
    const run = runs.find((r) => r.runId === 'run-symlink-outside');
    expect(run?.logExists).toBe(false);

    await rm(outsideDir, { recursive: true, force: true });
  });

  it('returns logExists: false for <logdir>/../x and <logdir>-evil/x', async () => {
    const parentFile = join(tempDir, 'x.log');
    await writeFile(parentFile, 'parent content\n', 'utf8');

    const evilDir = `${logDir}-evil`;
    await mkdir(evilDir, { recursive: true });
    const evilFile = join(evilDir, 'x.log');
    await writeFile(evilFile, 'evil content\n', 'utf8');

    await appendHistory(
      parseEvent({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-parent-x',
        data: { logFile: join(logDir, '../x.log') },
      }),
    );
    await appendHistory(
      parseEvent({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-evil-x',
        data: { logFile: evilFile },
      }),
    );

    const res = await GET(createRequest('/api/history'));
    expect(res.status).toBe(200);
    const runs = (await res.json()) as HistoryRunItem[];

    const parentRun = runs.find((r) => r.runId === 'run-parent-x');
    expect(parentRun?.logExists).toBe(false);

    const evilRun = runs.find((r) => r.runId === 'run-evil-x');
    expect(evilRun?.logExists).toBe(false);

    await rm(evilDir, { recursive: true, force: true });
  });

  it('returns logExists: true for a file named "..foo" inside logDir', async () => {
    const dotDotFoo = join(logDir, '..foo');
    await writeFile(dotDotFoo, 'dot-dot-foo content\n', 'utf8');

    await appendHistory(
      parseEvent({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-dot-dot-foo',
        data: { logFile: dotDotFoo },
      }),
    );

    const res = await GET(createRequest('/api/history'));
    expect(res.status).toBe(200);
    const runs = (await res.json()) as HistoryRunItem[];
    const run = runs.find((r) => r.runId === 'run-dot-dot-foo');
    expect(run?.logExists).toBe(true);
  });

  it('resolves prUrl server-side using git remote get-url origin with realistic data', async () => {
    const gitRepoDir = join(tempDir, 'agent-hq');
    await mkdir(gitRepoDir, { recursive: true });
    await execFileAsync('git', ['init', '-q'], { cwd: gitRepoDir });
    await execFileAsync(
      'git',
      ['remote', 'add', 'origin', 'https://github.com/tihofman/agent-hq.git'],
      { cwd: gitRepoDir },
    );

    await appendHistory(
      parseEvent({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-pr-1',
        cwd: gitRepoDir,
        data: { repo: 'agent-hq', prNumber: 7 },
      }),
    );

    const res = await GET(createRequest('/api/history'));
    expect(res.status).toBe(200);
    const runs = (await res.json()) as HistoryRunItem[];
    expect(runs).toHaveLength(1);

    const run = runs[0];
    expect(run.runId).toBe('run-pr-1');
    expect(run.prUrl).toBe('https://github.com/tihofman/agent-hq/pull/7');
  });

  it('returns prUrl: null when origin remote is not GitHub or cwd is invalid', async () => {
    const nonGithubRepo = join(tempDir, 'other-repo');
    await mkdir(nonGithubRepo, { recursive: true });
    await execFileAsync('git', ['init', '-q'], { cwd: nonGithubRepo });
    await execFileAsync(
      'git',
      ['remote', 'add', 'origin', 'https://gitlab.com/user/project.git'],
      { cwd: nonGithubRepo },
    );

    await appendHistory(
      parseEvent({
        event: 'TASK_START',
        agent: 'codex',
        runId: 'run-non-github',
        cwd: nonGithubRepo,
        data: { repo: 'other-repo', prNumber: 15 },
      }),
    );
    await appendHistory(
      parseEvent({
        event: 'TASK_START',
        agent: 'claude',
        runId: 'run-no-cwd',
        data: { repo: 'agent-hq', prNumber: 99 },
      }),
    );

    const res = await GET(createRequest('/api/history'));
    expect(res.status).toBe(200);
    const runs = (await res.json()) as HistoryRunItem[];
    expect(runs).toHaveLength(2);

    const gitlabRun = runs.find((r) => r.runId === 'run-non-github');
    expect(gitlabRun?.prUrl).toBeNull();

    const noCwdRun = runs.find((r) => r.runId === 'run-no-cwd');
    expect(noCwdRun?.prUrl).toBeNull();
  });

  it('returns at most 20 runs sorted descending by startedAt', async () => {
    for (let i = 1; i <= 25; i++) {
      const pad = i.toString().padStart(2, '0');
      await appendHistory(
        parseEvent({
          event: 'TASK_START',
          agent: 'claude',
          runId: `run-${pad}`,
          timestamp: `2026-10-22T10:${pad}:00.000Z`,
        }),
      );
    }

    const res = await GET(createRequest('/api/history'));
    expect(res.status).toBe(200);
    const runs = (await res.json()) as HistoryRunItem[];
    expect(runs).toHaveLength(20);
    expect(runs[0].runId).toBe('run-25');
    expect(runs[19].runId).toBe('run-06');
  });
});

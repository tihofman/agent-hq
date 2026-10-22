import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';

const { exec } = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: exec }) };
});

import { POST } from './+server';
import { dispatch, getState, resetStore } from '../../../lib/server/store';
import { parseEvent } from '../../../lib/server/state';

function request(pid: number, message?: unknown, logFile?: string) {
  dispatch(
    parseEvent({
      event: 'TASK_START',
      agent: 'agy',
      runId: 'test',
      pid,
      data: { logFile },
    }),
  );
  const request = new Request('http://localhost:3333/api/kill', {
    method: 'POST',
    body: JSON.stringify({ runId: 'test', message }),
  });
  return POST({ request, url: new URL(request.url) } as RequestEvent);
}

beforeEach(() => {
  resetStore();
  exec.mockReset();
  exec.mockImplementation(async (command, args) => ({
    stdout:
      command === 'ps'
        ? args[1] === 'ppid='
          ? '456\n'
          : 'bash scripts/delegate.sh agy test\n'
        : '',
    stderr: '',
  }));
  vi.spyOn(process, 'kill').mockReturnValue(true);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each([1, process.pid, process.ppid])(
  'rejects protected pid %s without any process commands or signals',
  async (pid) => {
    const response = await request(pid);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Refusing to kill protected pid',
    });
    expect(exec).not.toHaveBeenCalled();
    expect(process.kill).not.toHaveBeenCalled();
  },
);

it('returns 409 on EPERM without broadcasting abort', async () => {
  vi.mocked(process.kill).mockImplementation(() => {
    throw Object.assign(new Error('denied'), { code: 'EPERM' });
  });
  const response = await request(12345);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'Cannot signal pid' });
  expect(getState().runs.test.status).toBe('running');
});

it('rechecks worker identity before escalation signals', async () => {
  expect((await request(12345)).status).toBe(202);
  exec.mockResolvedValue({ stdout: 'unrelated', stderr: '' });
  vi.mocked(process.kill).mockClear();
  exec.mockClear();
  await vi.advanceTimersByTimeAsync(1500);
  expect(process.kill).not.toHaveBeenCalled();
  expect(exec.mock.calls.some(([command]) => command === 'pkill')).toBe(false);
});

it('rejects an unrelated parent without signalling any process', async () => {
  exec.mockImplementation(async (_command, args) => ({
    stdout: args[1] === 'ppid=' ? '456\n' : 'sleep 30\n',
    stderr: '',
  }));
  const response = await request(12345);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: 'Process is no longer a delegate.sh worker',
  });
  expect(process.kill).not.toHaveBeenCalled();
  expect(exec.mock.calls.some(([command]) => command === 'pkill')).toBe(false);
});

it('accepts a worker that already exited after TERM to its children', async () => {
  const commands = exec.getMockImplementation()!;
  exec.mockImplementation(async (command, args) => {
    if (command === 'pkill') {
      exec.mockResolvedValue({ stdout: '', stderr: '' });
    }
    return commands(command, args);
  });
  expect((await request(12345)).status).toBe(202);
  expect(getState().runs.test.status).toBe('aborted');
  expect(process.kill).not.toHaveBeenCalled();
});

it('checks identity again between TERM to children and TERM to worker', async () => {
  const commands = exec.getMockImplementation()!;
  exec.mockImplementation(async (command, args) => {
    if (command === 'pkill') {
      exec.mockResolvedValue({ stdout: 'unrelated', stderr: '' });
    }
    return commands(command, args);
  });
  const response = await request(12345);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: 'Process is no longer a delegate.sh worker',
  });
  expect(process.kill).not.toHaveBeenCalled();
});

it('writes the instruction before signalling in the configured log directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hq-message-'));
  vi.stubEnv('AGENT_HQ_LOG_DIR', dir);
  try {
    exec.mockImplementation(async (command, args) => {
      if (command === 'pkill')
        expect(await readFile(join(dir, 'run.msg'), 'utf8')).toBe(
          'correct this',
        );
      return {
        stdout:
          command === 'ps'
            ? args[1] === 'ppid='
              ? '456'
              : 'bash delegate.sh'
            : '',
      };
    });
    expect(
      (await request(12345, 'correct this', join(dir, 'run.log'))).status,
    ).toBe(202);
    expect(await readFile(join(dir, 'run.msg'), 'utf8')).toBe('correct this');
  } finally {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});
it.each([42, 'x'.repeat(4001)])(
  'rejects invalid instructions before signalling',
  async (message) => {
    expect((await request(12345, message)).status).toBe(400);
    expect(process.kill).not.toHaveBeenCalled();
  },
);
it('rejects paths outside the log directory and message symlinks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hq-message-'));
  vi.stubEnv('AGENT_HQ_LOG_DIR', dir);
  try {
    for (const path of [
      undefined,
      join(tmpdir(), 'outside.log'),
      join(dir, '..', 'outside.log'),
      join(dir, 'run.txt'),
    ]) {
      expect((await request(12345, 'correct', path)).status).toBe(400);
    }
    await writeFile(join(dir, 'target'), 'untouched');
    await symlink(join(dir, 'target'), join(dir, 'run.msg'));
    expect((await request(12345, 'correct', join(dir, 'run.log'))).status).toBe(
      409,
    );
    expect(await readFile(join(dir, 'target'), 'utf8')).toBe('untouched');
    expect(process.kill).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});

it('removes an unconsumed instruction after EPERM and leaves the run active', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hq-message-'));
  vi.stubEnv('AGENT_HQ_LOG_DIR', dir);
  vi.mocked(process.kill).mockImplementation(() => {
    throw Object.assign(new Error('denied'), { code: 'EPERM' });
  });
  try {
    expect((await request(12345, 'correct', join(dir, 'run.log'))).status).toBe(
      409,
    );
    await expect(readFile(join(dir, 'run.msg'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(getState().runs.test.status).toBe('running');
  } finally {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});
it('keeps plain cancellation behavior for whitespace instructions without a log path', async () => {
  expect((await request(12345, '  \n ')).status).toBe(202);
  expect(getState().runs.test.status).toBe('aborted');
});

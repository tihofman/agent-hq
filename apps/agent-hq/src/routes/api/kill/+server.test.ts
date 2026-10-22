import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RequestEvent } from '@sveltejs/kit';
import { POST } from './+server';
import {
  dispatch,
  getState,
  resetStore,
  subscribe,
} from '../../../lib/server/store';
import { parseEvent } from '../../../lib/server/state';

function request(body: unknown, origin?: string) {
  const req = new Request('http://localhost:3333/api/kill', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: origin ? { Origin: origin } : {},
  });
  return POST({ request: req, url: new URL(req.url) } as RequestEvent);
}

beforeEach(() => resetStore());

describe('POST /api/kill', () => {
  it('validates the body and origin before accessing a process', async () => {
    for (const body of [null, [], {}, { runId: '' }, { runId: 4 }]) {
      expect((await request(body)).status).toBe(400);
    }
    const req = new Request('http://localhost:3333/api/kill', {
      method: 'POST',
      body: '{',
    });
    expect(
      (await POST({ request: req, url: new URL(req.url) } as RequestEvent))
        .status,
    ).toBe(400);
    expect(
      (await request({ runId: 'missing' }, 'http://evil.test:3333')).status,
    ).toBe(403);
    expect((await request({ runId: 'missing' })).status).toBe(404);
    expect((await request({ runId: '__proto__' })).status).toBe(404);
    dispatch(
      parseEvent({ event: 'TASK_HANDOVER', agent: 'agy', runId: 'no-pid' }),
    );
    expect((await request({ runId: 'no-pid' })).status).toBe(404);
    dispatch(
      parseEvent({
        event: 'TASK_COMPLETE',
        agent: 'agy',
        runId: 'done',
        pid: process.pid,
      }),
    );
    expect((await request({ runId: 'done' })).status).toBe(404);
  });

  it('leaves a process without a delegate.sh parent alive', async () => {
    const worker = spawn('sleep', ['30']);
    const exited = new Promise((resolve) => worker.once('exit', resolve));
    try {
      dispatch(
        parseEvent({
          event: 'TASK_START',
          agent: 'agy',
          runId: 'unrelated',
          pid: worker.pid,
        }),
      );
      const response = await request({ runId: 'unrelated' });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: 'Process is no longer a delegate.sh worker',
      });
      expect(process.kill(worker.pid!, 0)).toBe(true);
      expect(getState().runs.unrelated.status).toBe('running');
    } finally {
      worker.kill('SIGKILL');
      await exited;
    }
  });

  it.each([
    ['a plain child', 'sleep 30 &'],
    // Ignored signals survive exec, so this child only dies by SIGKILL after the worker is gone.
    ['a TERM-ignoring child', `bash -c 'trap "" TERM; exec sleep 30' &`],
  ])(
    'kills delegate worker and %s, broadcasts abort, and returns before escalation',
    async (_name, spawnChild) => {
      const dir = await mkdtemp(join(tmpdir(), 'hq-kill-'));
      const pidsFile = join(dir, 'pids');
      await writeFile(
        join(dir, 'agy'),
        `#!/usr/bin/env bash\n${spawnChild}\nchild=$!\nprintf '%s %s' "$$" "$child" > "$KILL_TEST_PIDS"\nwait "$child"\n`,
        { mode: 0o755 },
      );
      const delegate = spawn(
        'bash',
        [
          fileURLToPath(
            new URL('../../../../../../scripts/delegate.sh', import.meta.url),
          ),
          'agy',
          'test',
        ],
        {
          env: {
            ...process.env,
            PATH: `${dir}:${process.env.PATH}`,
            TMPDIR: dir,
            KILL_TEST_PIDS: pidsFile,
            AGENT_HQ_URL: 'http://127.0.0.1:1',
          },
          stdio: ['ignore', 'ignore', 'inherit'],
        },
      );
      const exited = new Promise<number | null>((resolve) =>
        delegate.once('exit', resolve),
      );
      let pids: number[] = [];
      try {
        await vi.waitFor(async () => {
          pids = (await readFile(pidsFile, 'utf8')).split(' ').map(Number);
          expect(pids).toHaveLength(2);
        });
        const [worker, child] = pids;
        dispatch(
          parseEvent({
            event: 'TASK_START',
            agent: 'agy',
            runId: 'test',
            pid: worker,
          }),
        );
        const listener = vi.fn();
        subscribe(listener);
        const start = performance.now();
        // A supplied PID must never override the registered worker.
        expect(
          (await request({ runId: 'test', pid: process.pid })).status,
        ).toBe(202);
        expect(performance.now() - start).toBeLessThan(1500);
        expect(getState().runs.test.status).toBe('aborted');
        expect(listener.mock.calls[0][1].event).toBe('TASK_ABORTED');
        expect(await exited).not.toBe(0);
        await vi.waitFor(
          () => {
            expect(() => process.kill(worker, 0)).toThrow();
            expect(() => process.kill(child, 0)).toThrow();
          },
          { timeout: 4000 },
        );
        expect((await request({ runId: 'test' })).status).toBe(404);
        dispatch(
          parseEvent({ event: 'TASK_FAILED', agent: 'agy', runId: 'test' }),
        );
        expect(getState().runs.test.status).toBe('aborted');
        await new Promise((resolve) => setTimeout(resolve, 1600));
      } finally {
        for (const pid of pids) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            /* exited */
          }
        }
        delegate.kill('SIGKILL');
        await rm(dir, { recursive: true, force: true });
      }
    },
    10000,
  );
});

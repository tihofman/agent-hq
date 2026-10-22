import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { json, type RequestHandler } from '@sveltejs/kit';
import { isOriginAllowed } from '../../../lib/server/origin';
import { parseEvent } from '../../../lib/server/state';
import { dispatch, getState } from '../../../lib/server/store';

const exec = promisify(execFile);

async function childrenCommand(command: string, args: string[]) {
  try {
    return (await exec(command, args)).stdout;
  } catch (error) {
    if ((error as { code?: string | number }).code === 1) return '';
    throw error;
  }
}

class WorkerConflict extends Error {}

async function assertWorker(pid: number) {
  let parent: string;
  let command: string;
  try {
    parent = (
      await childrenCommand('ps', ['-o', 'ppid=', '-p', String(pid)])
    ).trim();
    if (!parent) return false;
    command = /^\d+$/.test(parent)
      ? await childrenCommand('ps', ['-o', 'command=', '-p', parent])
      : '';
  } catch {
    throw new WorkerConflict('Process is no longer a delegate.sh worker');
  }
  if (!command.includes('delegate.sh')) {
    throw new WorkerConflict('Process is no longer a delegate.sh worker');
  }
  return true;
}

async function signal(worker: number, pid: number, value: NodeJS.Signals | 0) {
  if (!(await assertWorker(worker))) return false;
  try {
    process.kill(pid, value);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

export const POST: RequestHandler = async ({ request, url }) => {
  if (!isOriginAllowed(request, url)) {
    return json({ error: 'Forbidden origin' }, { status: 403 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    typeof body.runId !== 'string' ||
    !body.runId.trim()
  ) {
    return json({ error: 'runId must be a non-empty string' }, { status: 400 });
  }
  const run = Object.hasOwn(getState().runs, body.runId)
    ? getState().runs[body.runId]
    : undefined;
  if (
    !run ||
    !['handover', 'running'].includes(run.status) ||
    run.pid == null
  ) {
    return json({ error: 'Active run not found' }, { status: 404 });
  }
  const pid = run.pid;
  if (pid <= 1 || pid === process.pid || pid === process.ppid) {
    return json({ error: 'Refusing to kill protected pid' }, { status: 409 });
  }
  try {
    if (!(await assertWorker(pid))) {
      throw new WorkerConflict('Process is no longer a delegate.sh worker');
    }
    // Remember children before TERM: they may be reparented when the worker exits.
    const children = (await childrenCommand('pgrep', ['-P', String(pid)]))
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);
    if (!(await assertWorker(pid))) {
      throw new WorkerConflict('Process is no longer a delegate.sh worker');
    }
    await childrenCommand('pkill', ['-TERM', '-P', String(pid)]);
    await signal(pid, pid, 'SIGTERM');
    const timer = setTimeout(async () => {
      try {
        // Children were verified at kill time; the worker may be gone by now, so skip its identity check.
        for (const child of children) {
          try {
            process.kill(child, 'SIGKILL');
          } catch {
            // already exited
          }
        }
        if (await signal(pid, pid, 0)) {
          if (!(await assertWorker(pid))) return;
          await childrenCommand('pkill', ['-KILL', '-P', String(pid)]);
          await signal(pid, pid, 'SIGKILL');
        }
      } catch (error) {
        if (!(error instanceof WorkerConflict)) {
          console.error('Kill switch escalation failed:', error);
        }
      }
    }, 1500);
    timer.unref();
  } catch (error) {
    if (error instanceof WorkerConflict) {
      return json({ error: error.message }, { status: 409 });
    }
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      return json({ error: 'Cannot signal pid' }, { status: 409 });
    }
    throw error;
  }
  dispatch(
    parseEvent({ event: 'TASK_ABORTED', agent: run.agent, runId: run.runId }),
  );
  return json({ ok: true }, { status: 202 });
};

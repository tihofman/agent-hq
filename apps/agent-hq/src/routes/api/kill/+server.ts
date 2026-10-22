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

function signal(pid: number, value: NodeJS.Signals | 0) {
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
  if (!run || !['handover', 'running'].includes(run.status) || !run.pid) {
    return json({ error: 'Active run not found' }, { status: 404 });
  }
  const pid = run.pid;
  // Remember children before TERM: they may be reparented when the worker exits.
  const children = (await childrenCommand('pgrep', ['-P', String(pid)]))
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
  await childrenCommand('pkill', ['-TERM', '-P', String(pid)]);
  signal(pid, 'SIGTERM');
  const timer = setTimeout(async () => {
    try {
      for (const child of children) {
        if (signal(child, 0)) signal(child, 'SIGKILL');
      }
      if (signal(pid, 0)) {
        await childrenCommand('pkill', ['-KILL', '-P', String(pid)]);
        signal(pid, 'SIGKILL');
      }
    } catch (error) {
      console.error('Kill switch escalation failed:', error);
    }
  }, 1500);
  timer.unref();
  dispatch(
    parseEvent({ event: 'TASK_ABORTED', agent: run.agent, runId: run.runId }),
  );
  return json({ ok: true }, { status: 202 });
};

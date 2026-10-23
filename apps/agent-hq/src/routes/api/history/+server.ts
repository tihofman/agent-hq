import { json, type RequestHandler } from '@sveltejs/kit';
import { execFile } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { readRecentRuns } from '../../../lib/server/history';
import { isOriginAllowed } from '../../../lib/server/origin';
import type { HistoryRunItem } from '../../../lib/history-format';

const execFileAsync = promisify(execFile);
const GITHUB_REMOTE_REGEX = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/;

function isInsideDir(childPath: string, parentDir: string): boolean {
  const rel = relative(parentDir, childPath);
  return (
    rel !== '' &&
    rel !== '..' &&
    !rel.startsWith('..' + sep) &&
    !isAbsolute(rel)
  );
}

function isLogFileValid(filePath?: string | null): boolean {
  if (!filePath || typeof filePath !== 'string' || !isAbsolute(filePath)) {
    return false;
  }
  const logDir = resolve(
    process.env.AGENT_HQ_LOG_DIR?.trim() || join(tmpdir(), 'agent-hq'),
  );
  try {
    const realFile = realpathSync(filePath);
    const realLogDir = realpathSync(logDir);
    const stat = statSync(realFile, { throwIfNoEntry: false });
    if (!stat?.isFile()) return false;

    return isInsideDir(realFile, realLogDir);
  } catch {
    return false;
  }
}

async function getOriginRemoteUrl(cwd: string): Promise<string | null> {
  if (!cwd || typeof cwd !== 'string' || !isAbsolute(cwd.trim())) {
    return null;
  }
  try {
    const { stdout } = await execFileAsync(
      'git',
      [
        '-c',
        'core.fsmonitor=false',
        '-C',
        cwd.trim(),
        'remote',
        'get-url',
        'origin',
      ],
      { timeout: 1000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

function parseGitHubPrUrl(
  remoteUrl: string | null,
  prNumber?: number,
): string | null {
  if (!remoteUrl || !prNumber || !Number.isInteger(prNumber) || prNumber <= 0) {
    return null;
  }
  const match = remoteUrl.match(GITHUB_REMOTE_REGEX);
  if (!match) return null;
  return `https://github.com/${match[1]}/pull/${prNumber}`;
}

export const GET: RequestHandler = async ({ request, url }) => {
  if (!isOriginAllowed(request, url)) {
    return json({ error: 'Forbidden origin' }, { status: 403 });
  }

  const runs = await readRecentRuns(20);
  const remoteUrlCache = new Map<string, Promise<string | null>>();

  function resolveRemoteUrl(cwd: string): Promise<string | null> {
    const key = cwd.trim();
    let promise = remoteUrlCache.get(key);
    if (!promise) {
      promise = getOriginRemoteUrl(key);
      remoteUrlCache.set(key, promise);
    }
    return promise;
  }

  const items: HistoryRunItem[] = await Promise.all(
    runs.map(async (run) => {
      const logExists = isLogFileValid(run.logFile);

      let prUrl: string | null = null;
      const prNumber = run.data?.prNumber;
      const cwd = run.cwd;

      if (
        typeof prNumber === 'number' &&
        Number.isInteger(prNumber) &&
        prNumber > 0 &&
        cwd &&
        typeof cwd === 'string' &&
        isAbsolute(cwd.trim())
      ) {
        const remoteUrl = await resolveRemoteUrl(cwd);
        prUrl = parseGitHubPrUrl(remoteUrl, prNumber);
      }

      return {
        ...run,
        logExists,
        prUrl,
      };
    }),
  );

  return json(items);
};

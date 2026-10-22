import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitInfo {
  repo: string;
  branch: string;
}

interface CacheEntry {
  result: GitInfo | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<GitInfo | null>>();

export function clearGitCache(): void {
  cache.clear();
  inflight.clear();
}

const MAX_CACHE_ENTRIES = 500;

// cwd comes from events: never let the inspected repo's config run commands.
async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['-c', 'core.fsmonitor=false', '-C', cwd, ...args],
    { timeout: 1000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
  );
  return stdout.trim();
}

async function getCommonDir(cwd: string): Promise<string> {
  return git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
}

async function getBranch(cwd: string): Promise<string> {
  try {
    return await git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
  } catch {
    // Unborn branch (repo without commits)
    return git(cwd, 'symbolic-ref', '--short', 'HEAD');
  }
}

function extractRepoName(commonDir: string): string {
  const normalized = path.resolve(commonDir);
  const base = path.basename(normalized);
  if (base === '.git') {
    return path.basename(path.dirname(normalized));
  }
  if (base.endsWith('.git')) {
    return base.slice(0, -4);
  }
  return base;
}

export async function resolveRepo(
  cwd: string,
  options?: { ttlMs?: number; now?: () => number },
): Promise<GitInfo | null> {
  if (!cwd || typeof cwd !== 'string' || !path.isAbsolute(cwd.trim())) {
    return null;
  }

  const cacheKey = path.resolve(cwd.trim());
  if (cache.size > MAX_CACHE_ENTRIES) cache.clear();
  const now = options?.now ? options.now() : Date.now();
  const ttlMs = options?.ttlMs ?? 10_000;

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.result;
  }

  const existingInflight = inflight.get(cacheKey);
  if (existingInflight) {
    return existingInflight;
  }

  const promise = (async () => {
    try {
      const [commonDir, branch] = await Promise.all([
        getCommonDir(cacheKey),
        getBranch(cacheKey),
      ]);
      const repo = extractRepoName(commonDir);
      if (!repo || !branch) {
        cache.set(cacheKey, { result: null, expiresAt: now + ttlMs });
        return null;
      }
      const result: GitInfo = { repo, branch };
      cache.set(cacheKey, { result, expiresAt: now + ttlMs });
      return result;
    } catch {
      cache.set(cacheKey, { result: null, expiresAt: now + ttlMs });
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  return promise;
}

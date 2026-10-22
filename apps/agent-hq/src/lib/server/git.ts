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

async function getCommonDir(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { timeout: 1000 },
    );
    return path.resolve(stdout.trim());
  } catch {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', cwd, 'rev-parse', '--git-common-dir'],
      { timeout: 1000 },
    );
    return path.resolve(cwd, stdout.trim());
  }
}

async function getBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { timeout: 1000 },
    );
    return stdout.trim();
  } catch {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', cwd, 'symbolic-ref', '--short', 'HEAD'],
      { timeout: 1000 },
    );
    return stdout.trim();
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
  if (!cwd || typeof cwd !== 'string' || !cwd.trim()) {
    return null;
  }

  const cacheKey = path.resolve(cwd.trim());
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

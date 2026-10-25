import { execFile as nodeExecFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  appendFile,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { TEAMS } from '@agent-hq/queue';
import { getHistoryDir } from './history';

const execFile = promisify(nodeExecFile);

export const ISSUE_STATUSES = [
  'queued',
  'in-progress',
  'blocked',
  'done',
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const HQ_LABELS = [
  ...ISSUE_STATUSES.map((status) => `status:${status}`),
  ...TEAMS.map((team) => `team:${team}`),
];

/** GitHub owners are alphanumeric with inner hyphens; repo names add `.` and `_`. */
const REPO_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9_.-]+$/;

export interface RepoEntry {
  repo: string;
  path: string;
  enabled: boolean;
}

/** Where a job runs; `repo` is absent for the legacy home repo (no `--repo`). */
export interface RepoTarget {
  repo?: string;
  path: string;
}

export class RepoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepoValidationError';
  }
}

export function isValidRepoName(repo: unknown): repo is string {
  return (
    typeof repo === 'string' &&
    REPO_NAME.test(repo) &&
    !['.', '..'].includes(repo.split('/')[1])
  );
}

export function getReposPath(): string {
  return join(getHistoryDir(), 'repos.json');
}

let homeRepoRoot: string | undefined;
/** Toplevel of the repo the server runs from (cached). */
export function getHomeRepoRoot(): string {
  if (!homeRepoRoot) {
    try {
      homeRepoRoot = resolve(
        execFileSync('git', ['rev-parse', '--show-toplevel'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim(),
      );
    } catch {
      homeRepoRoot = process.cwd();
    }
  }
  return homeRepoRoot;
}

/** Synchronous: tiny file, read once per poll and per job. */
export function loadRepos(): RepoEntry[] {
  let content: string;
  try {
    content = readFileSync(getReposPath(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const parsed: unknown = JSON.parse(content);
  if (!Array.isArray(parsed)) throw new Error('repos.json must be an array');
  return parsed.filter(
    (e): e is RepoEntry =>
      e !== null &&
      typeof e === 'object' &&
      isValidRepoName(e.repo) &&
      typeof e.path === 'string' &&
      isAbsolute(e.path) &&
      typeof e.enabled === 'boolean',
  );
}

/** Empty registry: only the home repo, exactly as before (ADR 0007). */
export function ingestTargets(entries: RepoEntry[]): RepoTarget[] {
  if (entries.length === 0) return [{ path: getHomeRepoRoot() }];
  return entries
    .filter((e) => e.enabled)
    .map(({ repo, path }) => ({ repo, path }));
}

/** Target of a job: legacy jobs without `repo` belong to the home repo. */
export function targetForRepo(repo?: string): RepoTarget {
  if (!repo) return { path: getHomeRepoRoot() };
  const entry = loadRepos().find((e) => e.repo === repo);
  if (!entry) throw new Error(`Repo ${repo} is not registered`);
  return { repo: entry.repo, path: entry.path };
}

let writeLock: Promise<unknown> = Promise.resolve();
function updateRepos<T>(
  mutate: (entries: RepoEntry[]) => { entries: RepoEntry[]; result: T },
): Promise<T> {
  const next = writeLock.then(async () => {
    const { entries, result } = mutate(loadRepos());
    const file = getReposPath();
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(entries, null, 2) + '\n', 'utf8');
    await rename(tmp, file);
    return result;
  });
  writeLock = next.catch(() => undefined);
  return next;
}

export type RepoCommandRunner = (
  args: string[],
  cwd: string,
) => Promise<string>;
const run =
  (bin: string): RepoCommandRunner =>
  async (args, cwd) =>
    (await execFile(bin, args, { cwd, encoding: 'utf8', timeout: 15_000 }))
      .stdout;
let ghRunner: RepoCommandRunner = run('gh');
const git = run('git');

export function setRepoGhRunner(runner?: RepoCommandRunner): void {
  ghRunner = runner ?? run('gh');
}

export const runRepoGh: RepoCommandRunner = (args, cwd) => ghRunner(args, cwd);

export async function registerRepo(input: {
  repo: unknown;
  path: unknown;
  enabled?: unknown;
}): Promise<RepoEntry> {
  const { repo, path, enabled = true } = input;
  if (!isValidRepoName(repo))
    throw new RepoValidationError('repo must be owner/name');
  if (typeof path !== 'string' || !isAbsolute(path))
    throw new RepoValidationError('path must be an absolute path');
  if (typeof enabled !== 'boolean')
    throw new RepoValidationError('enabled must be a boolean');
  if (!(await stat(path).catch(() => undefined))?.isDirectory())
    throw new RepoValidationError(`path ${path} does not exist`);

  let root: string;
  try {
    root = await realpath(
      (await git(['rev-parse', '--show-toplevel'], path)).trim(),
    );
  } catch {
    throw new RepoValidationError(`path ${path} is not a git repository`);
  }
  let actual: string;
  try {
    actual = (
      await ghRunner(
        ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
        root,
      )
    ).trim();
  } catch {
    throw new RepoValidationError(
      `gh repo view failed in ${root}; is it a GitHub repository?`,
    );
  }
  if (actual.toLowerCase() !== repo.toLowerCase() || !isValidRepoName(actual))
    throw new RepoValidationError(
      `path ${root} belongs to ${actual || 'no GitHub repo'}, not ${repo}`,
    );

  await Promise.all(
    HQ_LABELS.map((label) =>
      ghRunner(['label', 'create', label, '--force', '--repo', actual], root),
    ),
  );
  const exclude = resolve(
    root,
    (await git(['rev-parse', '--git-path', 'info/exclude'], root)).trim(),
  );
  const current = await readFile(exclude, 'utf8').catch(() => '');
  if (!/^\/?\.worktrees\/?$/m.test(current)) {
    await mkdir(dirname(exclude), { recursive: true });
    await appendFile(
      exclude,
      `${current && !current.endsWith('\n') ? '\n' : ''}.worktrees/\n`,
    );
  }

  const entry: RepoEntry = { repo: actual, path: root, enabled };
  return updateRepos((entries) => ({
    entries: [
      ...entries.filter((e) => e.repo.toLowerCase() !== actual.toLowerCase()),
      entry,
    ],
    result: entry,
  }));
}

export function removeRepo(repo: string): Promise<boolean> {
  return updateRepos((entries) => {
    const rest = entries.filter(
      (e) => e.repo.toLowerCase() !== repo.toLowerCase(),
    );
    return { entries: rest, result: rest.length !== entries.length };
  });
}

export function setRepoEnabled(
  repo: string,
  enabled: boolean,
): Promise<RepoEntry | null> {
  return updateRepos((entries) => {
    let updated: RepoEntry | null = null;
    const next = entries.map((e) => {
      if (e.repo.toLowerCase() === repo.toLowerCase()) {
        updated = { ...e, enabled };
        return updated;
      }
      return e;
    });
    return { entries: next, result: updated };
  });
}

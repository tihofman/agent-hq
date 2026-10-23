import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { TaskPayload } from '@agent-hq/queue';

const defaultExecFileAsync = promisify(execFile);

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
    maxBuffer?: number;
  },
) => Promise<{ stdout: string; stderr: string }>;

export interface PrepareWorktreeOptions {
  repoRoot: string;
  issueId: number;
  title: string;
  baseBranch?: string;
  env?: NodeJS.ProcessEnv;
  execFileFn?: ExecFileFn;
}

export interface PreparedWorktree {
  worktreePath: string;
  branch: string;
  slug: string;
}

export interface FinishWorktreeOptions {
  repoRoot: string;
  worktreePath: string;
  branch: string;
  issueId: number;
  title: string;
  remote?: string;
  ghBinary?: string;
  env?: NodeJS.ProcessEnv;
  execFileFn?: ExecFileFn;
}

export interface FinishWorktreeResult {
  prUrl: string;
}

export interface WorktreeManagerLike {
  prepare(payload: TaskPayload): Promise<PreparedWorktree>;
  finalizeSuccess(
    payload: TaskPayload,
    worktree: PreparedWorktree,
  ): Promise<FinishWorktreeResult>;
}

export interface GitWorktreeManagerOptions {
  repoRoot?: string;
  remote?: string;
  ghBinary?: string;
  baseBranch?: string;
  env?: NodeJS.ProcessEnv;
  execFileFn?: ExecFileFn;
}

export function slugify(title: string, maxLength = 40): string {
  const normalized = title
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const sliced = normalized.slice(0, maxLength).replace(/-+$/, '');
  return sliced || 'task';
}

export function getBranchName(issueId: number, slug: string): string {
  return `feat/${issueId}-${slug}`;
}

export function getWorktreeRelPath(issueId: number, slug: string): string {
  return `.worktrees/feat-${issueId}-${slug}`;
}

export function getWorktreePath(
  repoRoot: string,
  issueId: number,
  slug: string,
): string {
  return resolve(repoRoot, getWorktreeRelPath(issueId, slug));
}

function formatGitError(err: unknown): string {
  if (!err) return 'Unknown error';
  if (err instanceof Error) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    return stderr ? `${err.message}: ${stderr}` : err.message;
  }
  return String(err);
}

export async function resolveServerRepoRoot(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  execFileFn: ExecFileFn = defaultExecFileAsync,
): Promise<string> {
  if (env.AGENT_HQ_REPO_ROOT) {
    return resolve(env.AGENT_HQ_REPO_ROOT);
  }
  try {
    const { stdout } = await execFileFn(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd, env, timeout: 3_000 },
    );
    const gitDir = resolve(cwd, stdout.trim());
    return dirname(gitDir);
  } catch {
    return cwd;
  }
}

export async function prepareWorktree(
  options: PrepareWorktreeOptions,
): Promise<PreparedWorktree> {
  const {
    repoRoot,
    issueId,
    title,
    baseBranch = 'main',
    env = process.env,
    execFileFn = defaultExecFileAsync,
  } = options;

  const slug = slugify(title);
  const branch = getBranchName(issueId, slug);
  const worktreePath = getWorktreePath(repoRoot, issueId, slug);

  // 1. git worktree prune
  try {
    await execFileFn('git', ['worktree', 'prune'], { cwd: repoRoot, env });
  } catch (err) {
    throw new Error(`git worktree prune failed: ${formatGitError(err)}`, {
      cause: err,
    });
  }

  // 2. Check if worktree directory already exists (Retry)
  if (existsSync(worktreePath)) {
    try {
      await execFileFn('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: worktreePath,
        env,
      });
      return { worktreePath, branch, slug };
    } catch {
      try {
        await execFileFn('git', ['worktree', 'prune'], { cwd: repoRoot, env });
      } catch {
        // ignore
      }
    }
  }

  // 3. Check if branch already exists in git
  let branchExists = false;
  try {
    await execFileFn(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      { cwd: repoRoot, env },
    );
    branchExists = true;
  } catch {
    // branch does not exist
  }

  // 4. Add worktree
  try {
    if (branchExists) {
      await execFileFn('git', ['worktree', 'add', worktreePath, branch], {
        cwd: repoRoot,
        env,
      });
    } else {
      await execFileFn(
        'git',
        ['worktree', 'add', '-b', branch, worktreePath, baseBranch],
        { cwd: repoRoot, env },
      );
    }
  } catch (err) {
    throw new Error(
      `git worktree add failed for ${branch} at ${worktreePath}: ${formatGitError(err)}`,
      { cause: err },
    );
  }

  return { worktreePath, branch, slug };
}

export async function finishWorktree(
  options: FinishWorktreeOptions,
): Promise<FinishWorktreeResult> {
  const {
    repoRoot,
    worktreePath,
    branch,
    issueId,
    title,
    remote = 'origin',
    ghBinary = process.env.GH_BIN ?? 'gh',
    env = process.env,
    execFileFn = defaultExecFileAsync,
  } = options;

  const cleanTitle = title.replace(/[\r\n]+/g, ' ').trim();

  // 1. Check for uncommitted changes left by worker
  let statusOut: string;
  try {
    const res = await execFileFn('git', ['status', '--porcelain'], {
      cwd: worktreePath,
      env,
    });
    statusOut = res.stdout;
  } catch (err) {
    throw new Error(`git status failed: ${formatGitError(err)}`, {
      cause: err,
    });
  }

  if (statusOut.trim().length > 0) {
    try {
      await execFileFn('git', ['add', '-A'], { cwd: worktreePath, env });
    } catch (err) {
      throw new Error(`git add failed: ${formatGitError(err)}`, { cause: err });
    }

    const commitMsg = `feat(#${issueId}): ${cleanTitle}`;

    let hasAuthor = false;
    try {
      await execFileFn('git', ['config', 'user.name'], {
        cwd: worktreePath,
        env,
      });
      hasAuthor = true;
    } catch {
      // no author configured
    }

    const commitArgs = hasAuthor
      ? ['commit', '-m', commitMsg]
      : [
          '-c',
          'user.name=Agent-HQ',
          '-c',
          'user.email=agent-hq@local',
          'commit',
          '-m',
          commitMsg,
        ];

    try {
      await execFileFn('git', commitArgs, { cwd: worktreePath, env });
    } catch (err) {
      throw new Error(`git commit failed: ${formatGitError(err)}`, {
        cause: err,
      });
    }
  }

  // 2. Push branch to remote
  try {
    await execFileFn('git', ['push', '-u', remote, branch], {
      cwd: worktreePath,
      env,
    });
  } catch (err) {
    throw new Error(
      `git push -u ${remote} ${branch} failed: ${formatGitError(err)}`,
      { cause: err },
    );
  }

  // 3. Draft PR creation / lookup
  let prUrl: string | null = null;
  try {
    const { stdout } = await execFileFn(
      ghBinary,
      ['pr', 'view', branch, '--json', 'url', '-q', '.url'],
      { cwd: worktreePath, env },
    );
    const trimmed = stdout.trim();
    if (trimmed) {
      prUrl = trimmed;
    }
  } catch {
    // No PR exists yet
  }

  if (!prUrl) {
    try {
      const { stdout } = await execFileFn(
        ghBinary,
        [
          'pr',
          'create',
          '--draft',
          '--title',
          `feat(#${issueId}): ${cleanTitle}`,
          '--body',
          `Closes #${issueId}`,
        ],
        { cwd: worktreePath, env },
      );
      prUrl = stdout.trim();
    } catch (err) {
      const errMsg = formatGitError(err);
      const urlMatch = errMsg.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        prUrl = urlMatch[0];
      } else {
        throw new Error(`gh pr create failed: ${errMsg}`, { cause: err });
      }
    }
  }

  // 4. Remove worktree (branch remains)
  try {
    await execFileFn('git', ['worktree', 'remove', worktreePath], {
      cwd: repoRoot,
      env,
    });
  } catch {
    try {
      await execFileFn('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoRoot,
        env,
      });
    } catch (err) {
      throw new Error(
        `git worktree remove failed for ${worktreePath}: ${formatGitError(err)}`,
        { cause: err },
      );
    }
  }

  return { prUrl };
}

export class GitWorktreeManager implements WorktreeManagerLike {
  private readonly configuredRepoRoot?: string;
  private readonly remote: string;
  private readonly ghBinary: string;
  private readonly baseBranch: string;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly execFileFn: ExecFileFn;

  constructor(options: GitWorktreeManagerOptions = {}) {
    this.configuredRepoRoot = options.repoRoot;
    this.remote = options.remote ?? 'origin';
    this.ghBinary = options.ghBinary ?? process.env.GH_BIN ?? 'gh';
    this.baseBranch = options.baseBranch ?? 'main';
    this.env = options.env;
    this.execFileFn = options.execFileFn ?? defaultExecFileAsync;
  }

  private async getRepoRoot(): Promise<string> {
    if (this.configuredRepoRoot) {
      return resolve(this.configuredRepoRoot);
    }
    return resolveServerRepoRoot(process.cwd(), this.env, this.execFileFn);
  }

  async prepare(payload: TaskPayload): Promise<PreparedWorktree> {
    const repoRoot = await this.getRepoRoot();
    return prepareWorktree({
      repoRoot,
      issueId: payload.issueId,
      title: payload.title,
      baseBranch: this.baseBranch,
      env: this.env,
      execFileFn: this.execFileFn,
    });
  }

  async finalizeSuccess(
    payload: TaskPayload,
    worktree: PreparedWorktree,
  ): Promise<FinishWorktreeResult> {
    const repoRoot = await this.getRepoRoot();
    return finishWorktree({
      repoRoot,
      worktreePath: worktree.worktreePath,
      branch: worktree.branch,
      issueId: payload.issueId,
      title: payload.title,
      remote: this.remote,
      ghBinary: this.ghBinary,
      env: this.env,
      execFileFn: this.execFileFn,
    });
  }
}

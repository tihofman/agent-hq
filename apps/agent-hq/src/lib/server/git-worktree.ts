import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { TaskPayload } from '@agent-hq/queue';

const defaultExecFileAsync = promisify(execFile);

export interface WorktreeContext {
  repoRoot: string;
  remote?: string;
  baseBranch?: string;
  ghBinary?: string;
  env?: NodeJS.ProcessEnv;
}

export interface PreparedWorktree {
  worktreePath: string;
  branch: string;
  slug: string;
}

export interface FinishWorktreeResult {
  prUrl: string;
}

const COMMIT_PREFIX =
  /^\s*(feat|fix|refactor|test|docs|chore|enhancement|bug)(\([^)]*\))?!?:\s*/i;

const TYPE_ALIASES: Record<string, string> = {
  enhancement: 'feat',
  bug: 'fix',
};

export function parseTitle(title: string): { type: string; subject: string } {
  const match = title.match(COMMIT_PREFIX);
  if (!match) return { type: 'feat', subject: title.trim() };
  const prefix = match[1].toLowerCase();
  return {
    type: TYPE_ALIASES[prefix] ?? prefix,
    subject: title.slice(match[0].length).trim(),
  };
}

export function slugify(title: string, maxLength = 40): string {
  const normalized = parseTitle(title)
    .subject.replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const sliced = normalized.slice(0, maxLength).replace(/-+$/, '');
  return sliced || 'task';
}

function getWorktreeTarget(repoRoot: string, issueId: number, title: string) {
  const slug = slugify(title);
  const branch = `feat/${issueId}-${slug}`;
  const worktreePath = resolve(repoRoot, `.worktrees/feat-${issueId}-${slug}`);
  return { slug, branch, worktreePath };
}

function formatGitError(err: unknown): string {
  if (!err) return 'Unknown error';
  if (err instanceof Error) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    return stderr ? `${err.message}: ${stderr}` : err.message;
  }
  return String(err);
}

async function git(
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  try {
    const { stdout } = await defaultExecFileAsync('git', args, { cwd, env });
    return stdout;
  } catch (err) {
    throw new Error(`git ${args[0]} failed: ${formatGitError(err)}`, {
      cause: err,
    });
  }
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

export async function prepareWorktree(
  ctx: WorktreeContext,
  payload: TaskPayload,
): Promise<PreparedWorktree> {
  const { slug, branch, worktreePath } = getWorktreeTarget(
    ctx.repoRoot,
    payload.issueId,
    payload.title,
  );
  const remote = ctx.remote ?? 'origin';
  const baseBranch = ctx.baseBranch ?? 'main';
  const baseRef = `${remote}/${baseBranch}`;

  // 1. Prune stale worktree metadata
  await git(['worktree', 'prune'], ctx.repoRoot, ctx.env);

  // 2. Retry check: reuse worktree only if porcelain lists it AND HEAD matches branch
  if (existsSync(worktreePath)) {
    const listOut = await git(
      ['worktree', 'list', '--porcelain'],
      ctx.repoRoot,
      ctx.env,
    );
    const targetReal = safeRealpath(worktreePath);
    const isRegistered = listOut
      .split('\n')
      .filter((l) => l.startsWith('worktree '))
      .some(
        (l) => safeRealpath(l.slice('worktree '.length).trim()) === targetReal,
      );

    let currentBranch: string | null = null;
    try {
      const { stdout } = await defaultExecFileAsync(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd: worktreePath, env: ctx.env },
      );
      currentBranch = stdout.trim();
    } catch {
      // not inside a valid worktree
    }

    if (isRegistered && currentBranch === branch) {
      return { worktreePath, branch, slug };
    }

    throw new Error(
      `Path ${worktreePath} exists but is not a valid worktree for branch ${branch}`,
    );
  }

  // 3. Basis: fetch remote baseBranch and branch off origin/main
  await git(['fetch', remote, baseBranch], ctx.repoRoot, ctx.env);

  let branchExists = false;
  try {
    await defaultExecFileAsync(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      { cwd: ctx.repoRoot, env: ctx.env },
    );
    branchExists = true;
  } catch {
    // branch does not exist yet
  }

  if (branchExists) {
    await git(['worktree', 'add', worktreePath, branch], ctx.repoRoot, ctx.env);
  } else {
    await git(
      ['worktree', 'add', '-b', branch, worktreePath, baseRef],
      ctx.repoRoot,
      ctx.env,
    );
  }

  return { worktreePath, branch, slug };
}

export async function finalizeWorktree(
  ctx: WorktreeContext,
  payload: TaskPayload,
  wt: PreparedWorktree,
): Promise<FinishWorktreeResult> {
  const remote = ctx.remote ?? 'origin';
  const baseBranch = ctx.baseBranch ?? 'main';
  const baseRef = `${remote}/${baseBranch}`;
  const ghBinary = ctx.ghBinary ?? process.env.GH_BIN ?? 'gh';
  const cleanTitle = payload.title.replace(/[\r\n]+/g, ' ').trim();
  const { type, subject } = parseTitle(cleanTitle);
  const prTitle = `${type}(#${payload.issueId}): ${subject || cleanTitle}`;

  // 1. Commit uncommitted changes left by worker
  const statusOut = await git(
    ['status', '--porcelain'],
    wt.worktreePath,
    ctx.env,
  );
  if (statusOut.trim().length > 0) {
    await git(['add', '-A'], wt.worktreePath, ctx.env);
    await git(
      [
        '-c',
        'user.name=agent-hq',
        '-c',
        'user.email=agent-hq@localhost',
        'commit',
        '-m',
        prTitle,
      ],
      wt.worktreePath,
      ctx.env,
    );
  }

  // 2. Check for changes / commits against base before gh pr create
  const revListOut = await git(
    ['rev-list', '--count', `${baseRef}..HEAD`],
    wt.worktreePath,
    ctx.env,
  );
  const commitCount = Number.parseInt(revListOut.trim(), 10) || 0;
  if (commitCount === 0) {
    throw new Error(
      `No changes or commits against ${baseRef} for branch ${wt.branch}`,
    );
  }

  // 3. Push branch to remote
  await git(['push', '-u', remote, wt.branch], wt.worktreePath, ctx.env);

  // 4. Draft PR creation / lookup
  let prUrl: string | null = null;
  try {
    const { stdout } = await defaultExecFileAsync(
      ghBinary,
      ['pr', 'view', wt.branch, '--json', 'url', '-q', '.url'],
      { cwd: wt.worktreePath, env: ctx.env },
    );
    const trimmed = stdout.trim();
    if (trimmed) prUrl = trimmed;
  } catch {
    // PR does not exist yet
  }

  if (!prUrl) {
    try {
      const { stdout } = await defaultExecFileAsync(
        ghBinary,
        [
          'pr',
          'create',
          '--draft',
          '--title',
          prTitle,
          '--body',
          `Closes #${payload.issueId}`,
        ],
        { cwd: wt.worktreePath, env: ctx.env },
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

  // 5. Worktree removal is best-effort (no --force)
  try {
    await git(['worktree', 'remove', wt.worktreePath], ctx.repoRoot, ctx.env);
  } catch (err) {
    console.warn(
      `[git-worktree] Failed to remove worktree ${wt.worktreePath}: ${formatGitError(err)}`,
    );
  }

  return { prUrl };
}

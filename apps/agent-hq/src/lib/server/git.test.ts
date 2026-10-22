import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearGitCache, resolveRepo } from './git';

describe('git: resolveRepo', () => {
  let tempBase: string;
  let repoDir: string;

  beforeEach(async () => {
    clearGitCache();
    tempBase = await mkdtemp(join(tmpdir(), 'hq-git-test-'));
    repoDir = join(tempBase, 'my-test-repo');
    execFileSync('git', ['init', '-b', 'main', repoDir]);
    execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'Tester']);
    execFileSync('git', [
      '-C',
      repoDir,
      'config',
      'user.email',
      'tester@example.com',
    ]);
    execFileSync('git', [
      '-C',
      repoDir,
      'commit',
      '--allow-empty',
      '-m',
      'initial commit',
    ]);
  });

  afterEach(async () => {
    clearGitCache();
    await rm(tempBase, { recursive: true, force: true });
  });

  it('resolves repo name and current branch for a standard git repository', async () => {
    const info = await resolveRepo(repoDir);
    expect(info).toEqual({
      repo: 'my-test-repo',
      branch: 'main',
    });
  });

  it('resolves main repo name and feature branch in a git worktree', async () => {
    const worktreeDir = join(tempBase, 'wt-feat-13');
    execFileSync('git', [
      '-C',
      repoDir,
      'worktree',
      'add',
      '-b',
      'feat/13-repo-branch',
      worktreeDir,
    ]);

    const info = await resolveRepo(worktreeDir);
    expect(info).toEqual({
      repo: 'my-test-repo',
      branch: 'feat/13-repo-branch',
    });
  });

  it('handles detached HEAD as branch name HEAD', async () => {
    execFileSync('git', ['-C', repoDir, 'checkout', '--detach', 'HEAD']);
    const info = await resolveRepo(repoDir);
    expect(info).toEqual({
      repo: 'my-test-repo',
      branch: 'HEAD',
    });
  });

  it('caches the result for repeated calls within TTL', async () => {
    let clock = 1000;
    const now = () => clock;

    const first = await resolveRepo(repoDir, { ttlMs: 10_000, now });
    expect(first).toEqual({ repo: 'my-test-repo', branch: 'main' });

    // Switch branch behind the back of the cache
    execFileSync('git', ['-C', repoDir, 'checkout', '-b', 'renamed-branch']);

    // Within TTL (5s later): should return cached 'main'
    clock += 5000;
    const cached = await resolveRepo(repoDir, { ttlMs: 10_000, now });
    expect(cached?.branch).toBe('main');

    // After TTL expires (11s later): should fetch new branch 'renamed-branch'
    clock += 6000;
    const refreshed = await resolveRepo(repoDir, { ttlMs: 10_000, now });
    expect(refreshed?.branch).toBe('renamed-branch');
  });

  it('returns null and does not throw for non-git directory', async () => {
    const nonGitDir = join(tempBase, 'plain-dir');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(nonGitDir);

    const info = await resolveRepo(nonGitDir);
    expect(info).toBeNull();
  });

  it('returns null for non-existent directory', async () => {
    const nonExistent = join(tempBase, 'does-not-exist');
    const info = await resolveRepo(nonExistent);
    expect(info).toBeNull();
  });

  it('returns null for empty or whitespace-only cwd', async () => {
    expect(await resolveRepo('')).toBeNull();
    expect(await resolveRepo('   ')).toBeNull();
  });
});

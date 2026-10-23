import { execFileSync } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  finishWorktree,
  getBranchName,
  getWorktreePath,
  getWorktreeRelPath,
  GitWorktreeManager,
  prepareWorktree,
  resolveServerRepoRoot,
  slugify,
} from './git-worktree';

describe('git-worktree (#100)', () => {
  let tempBase: string;
  let bareRemoteDir: string;
  let serverRepoDir: string;
  let fakeGhScript: string;
  let fakeGhLog: string;

  beforeEach(async () => {
    tempBase = await mkdtemp(join(tmpdir(), 'hq-wt-test-'));
    bareRemoteDir = join(tempBase, 'remote.git');
    serverRepoDir = join(tempBase, 'server-repo');
    fakeGhLog = join(tempBase, 'fake-gh.log');
    fakeGhScript = join(tempBase, 'fake-gh.sh');

    // 1. Initialize bare remote repository
    execFileSync('git', ['init', '--bare', '-b', 'main', bareRemoteDir]);

    // 2. Initialize server repository and configure
    execFileSync('git', ['init', '-b', 'main', serverRepoDir]);
    execFileSync('git', ['-C', serverRepoDir, 'config', 'user.name', 'Tester']);
    execFileSync('git', [
      '-C',
      serverRepoDir,
      'config',
      'user.email',
      'tester@example.com',
    ]);
    execFileSync('git', [
      '-C',
      serverRepoDir,
      'remote',
      'add',
      'origin',
      bareRemoteDir,
    ]);

    // Create initial commit on main and push to bare remote
    await writeFile(join(serverRepoDir, 'README.md'), '# Test Repo\n');
    execFileSync('git', ['-C', serverRepoDir, 'add', 'README.md']);
    execFileSync('git', [
      '-C',
      serverRepoDir,
      'commit',
      '-m',
      'initial main commit',
    ]);
    execFileSync('git', ['-C', serverRepoDir, 'push', '-u', 'origin', 'main']);

    // 3. Create fake gh CLI script
    const fakeGhContent = `#!/usr/bin/env bash
set -euo pipefail
LOG="${fakeGhLog}"
echo "$*" >> "$LOG"

if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  BRANCH="$3"
  PR_FILE="${tempBase}/prs.json"
  if [ -f "$PR_FILE" ]; then
    URL="$(node -e "const fs = require('fs'); const prs = JSON.parse(fs.readFileSync('$PR_FILE')); console.log(prs['$BRANCH'] || '');")"
    if [ -n "$URL" ]; then
      echo "$URL"
      exit 0
    fi
  fi
  echo "no pull requests found for branch $BRANCH" >&2
  exit 1
fi

if [ "$1" = "pr" ] && [ "$2" = "create" ]; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  PR_FILE="${tempBase}/prs.json"
  URL="https://github.com/fake-org/fake-repo/pull/123"
  node -e "const fs = require('fs'); let prs = {}; try { prs = JSON.parse(fs.readFileSync('$PR_FILE')); } catch {} prs['$BRANCH'] = '$URL'; fs.writeFileSync('$PR_FILE', JSON.stringify(prs));"
  echo "$URL"
  exit 0
fi

echo "unknown fake-gh command: $*" >&2
exit 1
`;
    await writeFile(fakeGhScript, fakeGhContent);
    await chmod(fakeGhScript, 0o755);
  });

  afterEach(async () => {
    await rm(tempBase, { recursive: true, force: true });
  });

  describe('slugify & path helpers', () => {
    it('converts titles to lowercase a-z0-9 and hyphens, strips umlauts, truncates cleanly to max 40 chars', () => {
      expect(
        slugify(
          'Automatisches Worktree- und Draft-PR-Handling im Worker-Slot',
          40,
        ),
      ).toBe('automatisches-worktree-und-draft-pr-hand');
      expect(
        slugify('Automatisches Worktree- und Draft-PR-Handling im Worker-Slot')
          .length,
      ).toBeLessThanOrEqual(40);
      expect(slugify('Ärger über Übergröße')).toBe('arger-uber-ubergrosse');
      expect(slugify('Special --- chars &&& spaces   here')).toBe(
        'special-chars-spaces-here',
      );
      expect(slugify('---')).toBe('task');
      expect(slugify('')).toBe('task');
    });

    it('generates standardized branch and worktree paths', () => {
      const slug = slugify('My Task');
      expect(getBranchName(42, slug)).toBe('feat/42-my-task');
      expect(getWorktreeRelPath(42, slug)).toBe('.worktrees/feat-42-my-task');
      expect(getWorktreePath('/tmp/repo', 42, slug)).toBe(
        join('/tmp/repo', '.worktrees/feat-42-my-task'),
      );
    });

    it('resolves server repo root from within a worktree or standard checkout', async () => {
      const root = await resolveServerRepoRoot(serverRepoDir);
      expect(root).toBe(await realpath(serverRepoDir));
    });
  });

  describe('prepareWorktree', () => {
    it('prunes and creates a new worktree on a new branch from main', async () => {
      const prepared = await prepareWorktree({
        repoRoot: serverRepoDir,
        issueId: 100,
        title: 'Worktree Handling',
      });

      expect(prepared.branch).toBe('feat/100-worktree-handling');
      expect(prepared.worktreePath).toBe(
        join(serverRepoDir, '.worktrees', 'feat-100-worktree-handling'),
      );

      // Verify worktree exists and branch is correct
      const currentBranch = execFileSync('git', [
        '-C',
        prepared.worktreePath,
        'rev-parse',
        '--abbrev-ref',
        'HEAD',
      ])
        .toString()
        .trim();
      expect(currentBranch).toBe('feat/100-worktree-handling');

      // Verify worktree list includes it
      const wtList = execFileSync('git', [
        '-C',
        serverRepoDir,
        'worktree',
        'list',
      ]).toString();
      expect(wtList).toContain('feat-100-worktree-handling');
      expect(wtList).toContain('[feat/100-worktree-handling]');
    });

    it('reuses existing worktree on retry without error', async () => {
      const first = await prepareWorktree({
        repoRoot: serverRepoDir,
        issueId: 101,
        title: 'Retry Scenario',
      });

      // Write a file in the worktree
      await writeFile(
        join(first.worktreePath, 'scratch.txt'),
        'in progress data',
      );

      // Retry: prepare again
      const second = await prepareWorktree({
        repoRoot: serverRepoDir,
        issueId: 101,
        title: 'Retry Scenario',
      });

      expect(second.worktreePath).toBe(first.worktreePath);
      expect(second.branch).toBe(first.branch);
      // Data in scratch.txt remains intact
      expect(
        await readFile(join(second.worktreePath, 'scratch.txt'), 'utf8'),
      ).toBe('in progress data');
    });

    it('reuses existing branch when worktree folder was previously removed', async () => {
      const first = await prepareWorktree({
        repoRoot: serverRepoDir,
        issueId: 102,
        title: 'Recreate Worktree',
      });

      // Manually remove worktree but keep branch
      execFileSync('git', [
        '-C',
        serverRepoDir,
        'worktree',
        'remove',
        first.worktreePath,
      ]);

      // Branch still exists
      const branchRef = execFileSync('git', [
        '-C',
        serverRepoDir,
        'rev-parse',
        '--verify',
        'refs/heads/feat/102-recreate-worktree',
      ])
        .toString()
        .trim();
      expect(branchRef).toBeTruthy();

      // Second prepare attaches new worktree to existing branch
      const second = await prepareWorktree({
        repoRoot: serverRepoDir,
        issueId: 102,
        title: 'Recreate Worktree',
      });

      expect(second.worktreePath).toBe(first.worktreePath);
      const currentBranch = execFileSync('git', [
        '-C',
        second.worktreePath,
        'rev-parse',
        '--abbrev-ref',
        'HEAD',
      ])
        .toString()
        .trim();
      expect(currentBranch).toBe('feat/102-recreate-worktree');
    });
  });

  describe('finishWorktree', () => {
    it('commits uncommitted worker changes as feat(#<ID>): <Title>, pushes to origin, creates draft PR with Closes #<ID>, and removes worktree', async () => {
      const prepared = await prepareWorktree({
        repoRoot: serverRepoDir,
        issueId: 100,
        title: 'Automatisches Worktree- und Draft-PR-Handling',
      });

      // Simulate codex/worker leaving uncommitted changes
      await writeFile(
        join(prepared.worktreePath, 'solution.ts'),
        'export const answer = 42;\n',
      );

      const result = await finishWorktree({
        repoRoot: serverRepoDir,
        worktreePath: prepared.worktreePath,
        branch: prepared.branch,
        issueId: 100,
        title: 'Automatisches Worktree- und Draft-PR-Handling',
        ghBinary: fakeGhScript,
      });

      expect(result.prUrl).toBe(
        'https://github.com/fake-org/fake-repo/pull/123',
      );

      // Verify commit was created with Conventional Commit feat(#100): ...
      const lastCommitMsg = execFileSync('git', [
        '-C',
        serverRepoDir,
        'log',
        '-1',
        '--format=%s',
        prepared.branch,
      ])
        .toString()
        .trim();
      expect(lastCommitMsg).toBe(
        'feat(#100): Automatisches Worktree- und Draft-PR-Handling',
      );

      // Verify branch was pushed to bare origin
      const remoteHead = execFileSync('git', [
        '--git-dir',
        bareRemoteDir,
        'rev-parse',
        `refs/heads/${prepared.branch}`,
      ])
        .toString()
        .trim();
      expect(remoteHead).toBeTruthy();

      // Verify gh was invoked with --draft and Closes #100
      const ghLog = await readFile(fakeGhLog, 'utf8');
      expect(ghLog).toContain('pr view feat/100-');
      expect(ghLog).toContain(
        'pr create --draft --title feat(#100): Automatisches Worktree- und Draft-PR-Handling --body Closes #100',
      );

      // Verify worktree is removed
      const wtList = execFileSync('git', [
        '-C',
        serverRepoDir,
        'worktree',
        'list',
      ]).toString();
      expect(wtList).not.toContain(prepared.worktreePath);

      // Verify branch remains
      const localBranch = execFileSync('git', [
        '-C',
        serverRepoDir,
        'branch',
        '--list',
        prepared.branch,
      ])
        .toString()
        .trim();
      expect(localBranch).toContain(prepared.branch);
    });

    it('does not create an extra commit if worker already committed changes', async () => {
      const prepared = await prepareWorktree({
        repoRoot: serverRepoDir,
        issueId: 103,
        title: 'Pre-committed Feature',
      });

      // Worker commits their own work
      await writeFile(
        join(prepared.worktreePath, 'worker-file.ts'),
        'export const w = 1;',
      );
      execFileSync('git', ['-C', prepared.worktreePath, 'add', '-A']);
      execFileSync('git', [
        '-C',
        prepared.worktreePath,
        'commit',
        '-m',
        'feat(#103): worker self-commit',
      ]);

      const commitCountBefore = Number(
        execFileSync('git', [
          '-C',
          prepared.worktreePath,
          'rev-list',
          '--count',
          'HEAD',
        ])
          .toString()
          .trim(),
      );

      const result = await finishWorktree({
        repoRoot: serverRepoDir,
        worktreePath: prepared.worktreePath,
        branch: prepared.branch,
        issueId: 103,
        title: 'Pre-committed Feature',
        ghBinary: fakeGhScript,
      });

      expect(result.prUrl).toBe(
        'https://github.com/fake-org/fake-repo/pull/123',
      );

      const commitCountAfter = Number(
        execFileSync('git', [
          '-C',
          serverRepoDir,
          'rev-list',
          '--count',
          prepared.branch,
        ])
          .toString()
          .trim(),
      );
      // No extra empty commit was added
      expect(commitCountAfter).toBe(commitCountBefore);
    });

    it('does not create a duplicate PR if one already exists for the branch', async () => {
      const prepared = await prepareWorktree({
        repoRoot: serverRepoDir,
        issueId: 104,
        title: 'Existing PR Branch',
      });

      // Pre-seed an existing PR in fake-gh
      const existingPrUrl =
        'https://github.com/fake-org/fake-repo/pull/777-existing';
      await writeFile(
        join(tempBase, 'prs.json'),
        JSON.stringify({ [prepared.branch]: existingPrUrl }),
      );

      const result = await finishWorktree({
        repoRoot: serverRepoDir,
        worktreePath: prepared.worktreePath,
        branch: prepared.branch,
        issueId: 104,
        title: 'Existing PR Branch',
        ghBinary: fakeGhScript,
      });

      expect(result.prUrl).toBe(existingPrUrl);
      const ghLog = await readFile(fakeGhLog, 'utf8');
      expect(ghLog).toContain(`pr view ${prepared.branch}`);
      expect(ghLog).not.toContain('pr create');
    });

    it('throws clean job error when git push fails', async () => {
      const prepared = await prepareWorktree({
        repoRoot: serverRepoDir,
        issueId: 105,
        title: 'Failed Push',
      });

      // Point origin to an invalid non-existent path to trigger push error
      execFileSync('git', [
        '-C',
        prepared.worktreePath,
        'remote',
        'set-url',
        'origin',
        '/nonexistent-remote-path',
      ]);

      await expect(
        finishWorktree({
          repoRoot: serverRepoDir,
          worktreePath: prepared.worktreePath,
          branch: prepared.branch,
          issueId: 105,
          title: 'Failed Push',
          ghBinary: fakeGhScript,
        }),
      ).rejects.toThrow(/git push -u origin/);

      // Worktree remains intact on push failure
      const wtList = execFileSync('git', [
        '-C',
        serverRepoDir,
        'worktree',
        'list',
      ]).toString();
      expect(wtList).toContain(prepared.worktreePath);
    });
  });

  describe('GitWorktreeManager', () => {
    it('manages full lifecycle from TaskPayload', async () => {
      const manager = new GitWorktreeManager({
        repoRoot: serverRepoDir,
        ghBinary: fakeGhScript,
      });

      const task = {
        issueId: 106,
        title: 'Full Lifecycle',
        team: 'frontend' as const,
        body: 'Implement feature',
        labels: ['team:frontend'],
      };

      const prepared = await manager.prepare(task);
      expect(prepared.branch).toBe('feat/106-full-lifecycle');

      // Uncommitted file left by worker
      await writeFile(
        join(prepared.worktreePath, 'app.ts'),
        'console.log();\n',
      );

      const result = await manager.finalizeSuccess(task, prepared);
      expect(result.prUrl).toBe(
        'https://github.com/fake-org/fake-repo/pull/123',
      );

      // Worktree removed, branch remains on remote
      const wtList = execFileSync('git', [
        '-C',
        serverRepoDir,
        'worktree',
        'list',
      ]).toString();
      expect(wtList).not.toContain(prepared.worktreePath);
    });
  });
});

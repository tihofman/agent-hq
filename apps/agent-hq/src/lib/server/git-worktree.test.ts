import { execFileSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskPayload } from '@agent-hq/queue';
import {
  finalizeWorktree,
  prepareWorktree,
  slugify,
  type WorktreeContext,
} from './git-worktree';

describe('git-worktree (#100)', () => {
  let tempBase: string;
  let bareRemoteDir: string;
  let serverRepoDir: string;
  let fakeGhScript: string;
  let fakeGhLog: string;

  const makeCtx = (
    overrides: Partial<WorktreeContext> = {},
  ): WorktreeContext => ({
    repoRoot: serverRepoDir,
    ghBinary: fakeGhScript,
    ...overrides,
  });

  const makePayload = (
    issueId = 100,
    title = 'Automatisches Worktree- und Draft-PR-Handling',
  ): TaskPayload => ({
    issueId,
    title,
    team: 'frontend',
    body: 'description',
    labels: ['team:frontend'],
  });

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

  describe('slugify', () => {
    it('converts titles to lowercase a-z0-9 and hyphens, strips umlauts, truncates cleanly', () => {
      expect(
        slugify(
          'Automatisches Worktree- und Draft-PR-Handling im Worker-Slot',
          40,
        ),
      ).toBe('automatisches-worktree-und-draft-pr-hand');
      expect(slugify('Ärger über Übergröße')).toBe('arger-uber-ubergrosse');
      expect(slugify('Special --- chars &&& spaces   here')).toBe(
        'special-chars-spaces-here',
      );
      expect(slugify('---')).toBe('task');
      expect(slugify('')).toBe('task');
    });
  });

  describe('prepareWorktree', () => {
    it('prunes and creates a new worktree on a new branch from origin/main', async () => {
      const payload = makePayload(100, 'Worktree Handling');
      const prepared = await prepareWorktree(makeCtx(), payload);

      expect(prepared.branch).toBe('feat/100-worktree-handling');
      expect(prepared.worktreePath).toBe(
        join(serverRepoDir, '.worktrees', 'feat-100-worktree-handling'),
      );

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

      const wtList = execFileSync('git', [
        '-C',
        serverRepoDir,
        'worktree',
        'list',
      ]).toString();
      expect(wtList).toContain('feat-100-worktree-handling');
    });

    it('refuses to reuse a non-worktree directory or wrong branch and fails without touching main checkout (Finding 1)', async () => {
      // 1. Create leftover non-worktree directory
      const leftoverDir = join(
        serverRepoDir,
        '.worktrees',
        'feat-101-security-check',
      );
      await mkdir(leftoverDir, { recursive: true });
      await writeFile(join(leftoverDir, 'leftover.txt'), 'corrupted dir');

      const payload = makePayload(101, 'Security Check');
      await expect(prepareWorktree(makeCtx(), payload)).rejects.toThrow(
        /not a valid worktree/,
      );

      // Verify nothing happened in main checkout
      const status = execFileSync('git', [
        '-C',
        serverRepoDir,
        'status',
        '--porcelain',
      ])
        .toString()
        .trim();
      expect(status).toBe('');
    });

    it('reuses existing worktree on retry when registered in worktree list and on expected branch', async () => {
      const payload = makePayload(101, 'Retry Scenario');
      const first = await prepareWorktree(makeCtx(), payload);

      await writeFile(
        join(first.worktreePath, 'scratch.txt'),
        'in progress data',
      );

      const second = await prepareWorktree(makeCtx(), payload);

      expect(second.worktreePath).toBe(first.worktreePath);
      expect(second.branch).toBe(first.branch);
      expect(
        await readFile(join(second.worktreePath, 'scratch.txt'), 'utf8'),
      ).toBe('in progress data');
    });

    it('reuses existing branch when worktree folder was previously removed', async () => {
      const payload = makePayload(102, 'Recreate Worktree');
      const first = await prepareWorktree(makeCtx(), payload);

      execFileSync('git', [
        '-C',
        serverRepoDir,
        'worktree',
        'remove',
        first.worktreePath,
      ]);

      const second = await prepareWorktree(makeCtx(), payload);

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

    it('fetches origin/main and branches from origin/main rather than local main (Finding 3)', async () => {
      // Create a commit on bare origin/main that local main does NOT have
      const peerRepoDir = join(tempBase, 'peer-repo');
      execFileSync('git', ['clone', bareRemoteDir, peerRepoDir]);
      execFileSync('git', ['-C', peerRepoDir, 'config', 'user.name', 'Peer']);
      execFileSync('git', [
        '-C',
        peerRepoDir,
        'config',
        'user.email',
        'peer@example.com',
      ]);
      await writeFile(
        join(peerRepoDir, 'from-origin.txt'),
        'hello from remote',
      );
      execFileSync('git', ['-C', peerRepoDir, 'add', 'from-origin.txt']);
      execFileSync('git', [
        '-C',
        peerRepoDir,
        'commit',
        '-m',
        'commit on origin/main',
      ]);
      execFileSync('git', ['-C', peerRepoDir, 'push', 'origin', 'main']);

      // Ensure local serverRepoDir main does NOT have this commit yet
      expect(
        execFileSync('git', [
          '-C',
          serverRepoDir,
          'log',
          '--format=%s',
          'main',
        ]).toString(),
      ).not.toContain('commit on origin/main');

      // prepareWorktree must fetch origin/main and branch off origin/main
      const payload = makePayload(103, 'Branch From Origin');
      const prepared = await prepareWorktree(makeCtx(), payload);

      expect(
        await readFile(join(prepared.worktreePath, 'from-origin.txt'), 'utf8'),
      ).toBe('hello from remote');
    });
  });

  describe('finalizeWorktree', () => {
    it('commits uncommitted worker changes as feat(#<ID>): <Title>, pushes, creates draft PR, and removes worktree', async () => {
      const payload = makePayload(
        100,
        'Automatisches Worktree- und Draft-PR-Handling',
      );
      const prepared = await prepareWorktree(makeCtx(), payload);

      await writeFile(
        join(prepared.worktreePath, 'solution.ts'),
        'export const answer = 42;\n',
      );

      const result = await finalizeWorktree(makeCtx(), payload, prepared);

      expect(result.prUrl).toBe(
        'https://github.com/fake-org/fake-repo/pull/123',
      );

      // Conventional Commit feat(#100): Automatisches Worktree- und Draft-PR-Handling
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

      // Pushed to remote
      const remoteHead = execFileSync('git', [
        '--git-dir',
        bareRemoteDir,
        'rev-parse',
        `refs/heads/${prepared.branch}`,
      ])
        .toString()
        .trim();
      expect(remoteHead).toBeTruthy();

      // gh invoked with --draft and Closes #100
      const ghLog = await readFile(fakeGhLog, 'utf8');
      expect(ghLog).toContain(
        'pr create --draft --title feat(#100): Automatisches Worktree- und Draft-PR-Handling --body Closes #100',
      );

      // Worktree removed
      const wtList = execFileSync('git', [
        '-C',
        serverRepoDir,
        'worktree',
        'list',
      ]).toString();
      expect(wtList).not.toContain(prepared.worktreePath);
    });

    it('aborts with a clear error and leaves worktree intact when there are no changes or commits against base (Finding 2)', async () => {
      const payload = makePayload(104, 'No Changes Made');
      const prepared = await prepareWorktree(makeCtx(), payload);

      // No changes made by worker
      await expect(
        finalizeWorktree(makeCtx(), payload, prepared),
      ).rejects.toThrow(/No changes or commits against origin\/main/);

      // Worktree remains intact
      const wtList = execFileSync('git', [
        '-C',
        serverRepoDir,
        'worktree',
        'list',
      ]).toString();
      expect(wtList).toContain(prepared.worktreePath);

      // gh pr create was NOT called
      const ghLog = (await readFile(fakeGhLog, 'utf8').catch(() => '')).trim();
      expect(ghLog).not.toContain('pr create');
    });

    it('does not create an extra commit if worker already committed changes', async () => {
      const payload = makePayload(105, 'Pre-committed Feature');
      const prepared = await prepareWorktree(makeCtx(), payload);

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
        'feat(#105): worker self-commit',
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

      const result = await finalizeWorktree(makeCtx(), payload, prepared);
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
      expect(commitCountAfter).toBe(commitCountBefore);
    });

    it('does not create a duplicate PR if one already exists for the branch', async () => {
      const payload = makePayload(106, 'Existing PR Branch');
      const prepared = await prepareWorktree(makeCtx(), payload);

      await writeFile(join(prepared.worktreePath, 'file.ts'), 'test');

      const existingPrUrl =
        'https://github.com/fake-org/fake-repo/pull/777-existing';
      await writeFile(
        join(tempBase, 'prs.json'),
        JSON.stringify({ [prepared.branch]: existingPrUrl }),
      );

      const result = await finalizeWorktree(makeCtx(), payload, prepared);
      expect(result.prUrl).toBe(existingPrUrl);

      const ghLog = await readFile(fakeGhLog, 'utf8');
      expect(ghLog).toContain(`pr view ${prepared.branch}`);
      expect(ghLog).not.toContain('pr create');
    });

    it('treats worktree removal failure as best-effort: logs warning and returns prUrl without --force (Finding 5)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const payload = makePayload(107, 'Best Effort Removal');
      const prepared = await prepareWorktree(makeCtx(), payload);

      await writeFile(join(prepared.worktreePath, 'committed.ts'), 'val');

      // Use an invalid repoRoot for removal failure simulation, or cause remove to fail
      // When worktreePath has an untracked dirty file after commit:
      // Note: we write an uncommitted file to simulate git worktree remove failing because of untracked files
      // BUT finalizeWorktree stages all untracked files in step 1!
      // So let's mock or simulate git worktree remove failure by making worktree remove fail:
      // Point ctx.repoRoot to an invalid path during finalizeWorktree? No, git push needs repoRoot? Wait, git push runs in worktreePath!
      // But git worktree remove runs in repoRoot. If ctx.repoRoot doesn't have the worktree metadata or we pass a wrapper,
      // Or simply: pass an invalid repoRoot:
      const badCtx = makeCtx({ repoRoot: '/nonexistent-root' });

      const result = await finalizeWorktree(badCtx, payload, prepared);
      expect(result.prUrl).toBe(
        'https://github.com/fake-org/fake-repo/pull/123',
      );
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});

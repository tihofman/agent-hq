import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getHomeRepoRoot,
  ingestTargets,
  isValidRepoName,
  loadRepos,
  registerRepo,
  removeRepo,
  setRepoEnabled,
  RepoValidationError,
  setRepoGhRunner,
  targetForRepo,
} from './repos';

describe('repo registry (ADR 0007)', () => {
  let home: string;
  let repoDir: string;
  let ghCalls: { args: string[]; cwd: string }[];

  beforeEach(async () => {
    home = await realpath(await mkdtemp(join(tmpdir(), 'hq-repos-')));
    vi.stubEnv('AGENT_HQ_HOME', home);
    repoDir = join(home, 'alpha');
    await mkdir(repoDir);
    execFileSync('git', ['init', '-q', '-b', 'main', repoDir]);
    ghCalls = [];
    setRepoGhRunner(async (args, cwd) => {
      ghCalls.push({ args, cwd });
      return args[1] === 'view' ? 'acme/alpha\n' : '';
    });
  });

  afterEach(async () => {
    setRepoGhRunner(undefined);
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  it('treats a missing or empty registry as home repo only', () => {
    expect(loadRepos()).toEqual([]);
    expect(ingestTargets([])).toEqual([{ path: getHomeRepoRoot() }]);
    expect(targetForRepo(undefined)).toEqual({ path: getHomeRepoRoot() });
    expect(() => targetForRepo('acme/gone')).toThrow('not registered');
    expect(
      ingestTargets([
        { repo: 'acme/a', path: '/a', enabled: true },
        { repo: 'acme/b', path: '/b', enabled: false },
      ]),
    ).toEqual([{ repo: 'acme/a', path: '/a' }]);
  });

  it('validates owner/name strictly', () => {
    for (const ok of ['acme/alpha', 'a-b/c.d_e', 'x/agent-hq'])
      expect(isValidRepoName(ok)).toBe(true);
    for (const bad of ['acme', '-x/y', 'a/b/c', 'a.b/c', 'a/..', 'a/b c', 1])
      expect(isValidRepoName(bad)).toBe(false);
  });

  it.each([
    ['missing path', () => ({ repo: 'acme/alpha', path: join(home, 'nope') })],
    ['no git repo', () => ({ repo: 'acme/alpha', path: home })],
    ['owner/name mismatch', () => ({ repo: 'acme/beta', path: repoDir })],
    ['relative path', () => ({ repo: 'acme/alpha', path: 'alpha' })],
    ['invalid repo', () => ({ repo: 'acme', path: repoDir })],
  ])('rejects %s without writing', async (_name, input) => {
    await expect(registerRepo(input())).rejects.toBeInstanceOf(
      RepoValidationError,
    );
    expect(loadRepos()).toEqual([]);
    expect(ghCalls.filter(({ args }) => args[0] === 'label')).toEqual([]);
  });

  it('creates labels with --repo, excludes .worktrees/ once and stores the entry', async () => {
    const entry = await registerRepo({ repo: 'acme/alpha', path: repoDir });
    expect(entry).toEqual({ repo: 'acme/alpha', path: repoDir, enabled: true });

    const labels = ghCalls.filter(({ args }) => args[0] === 'label');
    expect(labels.map(({ args }) => args)).toEqual(
      [
        'status:queued',
        'status:in-progress',
        'status:blocked',
        'status:done',
        'team:frontend',
        'team:backend',
        'team:qa',
      ].map((label) => [
        'label',
        'create',
        label,
        '--force',
        '--repo',
        'acme/alpha',
      ]),
    );
    expect(ghCalls[0]).toEqual({
      args: ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
      cwd: repoDir,
    });

    await registerRepo({ repo: 'acme/alpha', path: repoDir, enabled: false });
    const exclude = await readFile(
      join(repoDir, '.git', 'info', 'exclude'),
      'utf8',
    );
    expect(exclude.match(/^\.worktrees\/$/gm)).toHaveLength(1);
    expect(loadRepos()).toEqual([
      { repo: 'acme/alpha', path: repoDir, enabled: false },
    ]);

    expect(await setRepoEnabled('acme/alpha', true)).toEqual({
      repo: 'acme/alpha',
      path: repoDir,
      enabled: true,
    });
    expect(await setRepoEnabled('non/existent', true)).toBeNull();

    expect(await removeRepo('ACME/Alpha')).toBe(true);
    expect(await removeRepo('acme/alpha')).toBe(false);
    expect(loadRepos()).toEqual([]);
  });
});

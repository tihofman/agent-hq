import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRepos, setRepoGhRunner } from '../../../lib/server/repos';
import { GET, POST } from './+server';
import { DELETE } from './[...repo]/+server';

const URL_BASE = 'http://127.0.0.1:3333/api/repos';
const event = (request: Request, params: Record<string, string> = {}) =>
  ({ request, url: new URL(request.url), params }) as unknown as RequestEvent;
const post = (body: unknown, origin?: string) =>
  new Request(URL_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(body),
  });

describe('/api/repos', () => {
  let home: string;
  let repoDir: string;

  beforeEach(async () => {
    home = await realpath(await mkdtemp(join(tmpdir(), 'hq-repos-api-')));
    vi.stubEnv('AGENT_HQ_HOME', home);
    repoDir = join(home, 'alpha');
    await mkdir(repoDir);
    execFileSync('git', ['init', '-q', '-b', 'main', repoDir]);
    setRepoGhRunner(async (args) => (args[1] === 'view' ? 'acme/alpha' : ''));
  });

  afterEach(async () => {
    setRepoGhRunner(undefined);
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  it('rejects foreign origins on GET, POST and DELETE', async () => {
    const evil = 'http://evil.example';
    const get = new Request(URL_BASE, { headers: { Origin: evil } });
    expect((await GET(event(get))).status).toBe(403);
    expect(
      (await POST(event(post({ repo: 'acme/alpha', path: repoDir }, evil))))
        .status,
    ).toBe(403);
    const del = new Request(`${URL_BASE}/acme/alpha`, {
      method: 'DELETE',
      headers: { Origin: evil },
    });
    expect((await DELETE(event(del, { repo: 'acme/alpha' }))).status).toBe(403);
    expect(loadRepos()).toEqual([]);
  });

  it('rejects invalid registrations with 400', async () => {
    for (const body of [
      { repo: 'acme/alpha', path: join(home, 'missing') },
      { repo: 'acme/alpha', path: home },
      { repo: 'acme/beta', path: repoDir },
      { repo: 'acme/alpha' },
    ]) {
      const res = await POST(event(post(body)));
      expect(res.status).toBe(400);
    }
    expect(loadRepos()).toEqual([]);
  });

  it('registers, lists and removes a repo via owner/name rest parameter', async () => {
    const res = await POST(
      event(
        post({ repo: 'acme/alpha', path: repoDir }, 'http://127.0.0.1:3333'),
      ),
    );
    expect(res.status).toBe(201);
    const list = await GET(event(new Request(URL_BASE)));
    expect(await list.json()).toEqual([
      { repo: 'acme/alpha', path: repoDir, enabled: true },
    ]);

    const del = () =>
      DELETE(
        event(new Request(`${URL_BASE}/acme/alpha`, { method: 'DELETE' }), {
          repo: 'acme/alpha',
        }),
      );
    expect((await del()).status).toBe(200);
    expect((await del()).status).toBe(404);
    expect(
      (
        await DELETE(
          event(new Request(`${URL_BASE}/x`, { method: 'DELETE' }), {
            repo: 'x',
          }),
        )
      ).status,
    ).toBe(400);
  });
});

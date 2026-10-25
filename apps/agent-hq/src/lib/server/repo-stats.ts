import { TEAMS, type Team } from '@agent-hq/queue';
import type {
  DraftPR,
  QueueCounts,
  QueueState,
  RepoStatsResponse,
} from '@agent-hq/queue/types';
import { getQueueManager } from './questions';
import { getHomeRepoRoot, loadRepos, runRepoGh } from './repos';

export const QUEUE_STATES = [
  'waiting',
  'active',
  'delayed',
  'failed',
] as const satisfies readonly QueueState[];

export const GH_CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  at: number;
  value: T;
}
const draftCache = new Map<string, CacheEntry<DraftPR[]>>();
let homeNameCache: CacheEntry<string | null> | undefined;

export function resetRepoStatsCache(): void {
  draftCache.clear();
  homeNameCache = undefined;
}

const fresh = (entry?: CacheEntry<unknown>) =>
  !!entry && Date.now() - entry.at < GH_CACHE_TTL_MS;

async function homeRepoName(): Promise<string | null> {
  const root = getHomeRepoRoot();
  const registered = loadRepos().find((e) => e.path === root);
  if (registered) return registered.repo;
  if (fresh(homeNameCache)) return homeNameCache!.value;
  let name: string | null = null;
  try {
    name =
      (
        await runRepoGh(
          ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
          root,
        )
      ).trim() || null;
  } catch {
    // Not a GitHub repo or gh unavailable: unnamed home repo.
  }
  homeNameCache = { at: Date.now(), value: name };
  return name;
}

/** Failures are not cached, so a transient `gh` error heals on the next call. */
async function draftPRs(repo: string | null): Promise<DraftPR[]> {
  const key = repo?.toLowerCase() ?? '';
  const cached = draftCache.get(key);
  if (fresh(cached)) return cached!.value;
  try {
    const out = await runRepoGh(
      [
        'pr',
        'list',
        ...(repo ? ['--repo', repo] : []),
        '--draft',
        '--state',
        'open',
        '--json',
        'number,title,url,headRefName',
      ],
      getHomeRepoRoot(),
    );
    const parsed = JSON.parse(out) as DraftPR[];
    const value = parsed.map(({ number, title, url }) => ({
      number,
      title,
      url,
    }));
    draftCache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    return [];
  }
}

const emptyQueues = (): Record<Team, QueueCounts> =>
  Object.fromEntries(
    TEAMS.map((team) => [
      team,
      { waiting: 0, active: 0, delayed: 0, failed: 0 },
    ]),
  ) as Record<Team, QueueCounts>;

/** Counts keyed by lower-cased repo; legacy jobs without `repo` go to `homeKey`. */
async function queueCounts(
  homeKey: string,
): Promise<Map<string, Record<Team, QueueCounts>>> {
  const counts = new Map<string, Record<Team, QueueCounts>>();
  const manager = getQueueManager();
  if (!manager) return counts;
  try {
    for (const team of TEAMS) {
      const queue = manager.getQueue(team);
      for (const state of QUEUE_STATES) {
        for (const job of await queue.getJobs([state])) {
          if (!job) continue;
          const key = job.data?.repo?.toLowerCase() ?? homeKey;
          if (!counts.has(key)) counts.set(key, emptyQueues());
          counts.get(key)![team][state]++;
        }
      }
    }
  } catch (err) {
    // Redis dropped after start: show empty counts rather than an error.
    console.warn('[repo-stats] queue read failed:', err);
    return new Map();
  }
  return counts;
}

export async function getRepoStats(): Promise<RepoStatsResponse> {
  const root = getHomeRepoRoot();
  const entries = loadRepos();
  const homeRepo = await homeRepoName();
  const homeKey = homeRepo?.toLowerCase() ?? '';
  const counts = await queueCounts(homeKey);

  const rows: { repo: string | null; home: boolean }[] = entries.map((e) => ({
    repo: e.repo,
    home: e.path === root,
  }));
  // Empty registry means home repo only (ADR 0007); otherwise show home
  // only while legacy jobs of an unregistered home repo are still queued.
  if (!rows.some((r) => r.home) && (rows.length === 0 || counts.has(homeKey))) {
    rows.push({ repo: homeRepo, home: true });
  }

  return {
    homeRepo,
    repos: await Promise.all(
      rows.map(async ({ repo, home }) => ({
        repo,
        home,
        queues: counts.get(repo?.toLowerCase() ?? '') ?? emptyQueues(),
        draftPRs: await draftPRs(repo),
      })),
    ),
  };
}

import { TEAMS, type TaskPayload, type Team } from '@agent-hq/queue';
import type { Job, Queue } from 'bullmq';
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
/** The UI polls every 15 s; this only absorbs bursts (several tabs, reloads). */
export const COUNTS_CACHE_TTL_MS = 5_000;
/** Retained failed jobs can pile up; only the newest are counted. */
export const FAILED_CAP = 500;
const PAGE_SIZE = 1_000;

interface CacheEntry<T> {
  at: number;
  value: T;
}
const draftCache = new Map<string, CacheEntry<DraftPR[]>>();
let homeNameCache: CacheEntry<string | null> | undefined;
let countsCache: (CacheEntry<Counts> & { homeKey: string }) | undefined;

export function resetRepoStatsCache(): void {
  draftCache.clear();
  homeNameCache = undefined;
  countsCache = undefined;
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
async function draftPRs(
  repo: string | null,
): Promise<{ value: DraftPR[]; error?: string }> {
  const key = repo?.toLowerCase() ?? '';
  const cached = draftCache.get(key);
  if (fresh(cached)) return { value: cached!.value };
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
    return { value };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { value: [], error: message.split('\n')[0] || 'gh failed' };
  }
}

const emptyQueues = (): Record<Team, QueueCounts> =>
  Object.fromEntries(
    TEAMS.map((team) => [
      team,
      { waiting: 0, active: 0, delayed: 0, failed: 0 },
    ]),
  ) as Record<Team, QueueCounts>;

interface Counts {
  byRepo: Map<string, Record<Team, QueueCounts>>;
  failedTruncated: boolean;
}

/**
 * Calls `fn` for every job in `state`, `PAGE_SIZE` at a time, and stops after
 * `limit` jobs (newest first). Returns true when more than `limit` exist.
 */
async function forEachJob(
  queue: Queue<TaskPayload>,
  state: QueueState,
  limit: number,
  fn: (job: Job<TaskPayload> | undefined) => void,
): Promise<boolean> {
  for (let seen = 0; ;) {
    // One extra job beyond `limit` tells whether the list was cut.
    const want = Math.min(PAGE_SIZE, limit + 1 - seen);
    const page = await queue.getJobs([state], seen, seen + want - 1);
    page.slice(0, limit - seen).forEach(fn);
    if (page.length > limit - seen) return true;
    if (page.length < want) return false;
    seen += page.length;
  }
}

/** Counts keyed by lower-cased repo; legacy jobs without `repo` go to `homeKey`. */
async function queueCounts(homeKey: string): Promise<Counts> {
  if (
    countsCache &&
    countsCache.homeKey === homeKey &&
    Date.now() - countsCache.at < COUNTS_CACHE_TTL_MS
  )
    return countsCache.value;
  const value: Counts = { byRepo: new Map(), failedTruncated: false };
  const manager = getQueueManager();
  if (!manager) return value;
  try {
    for (const team of TEAMS) {
      const queue = manager.getQueue(team);
      for (const state of QUEUE_STATES) {
        const limit = state === 'failed' ? FAILED_CAP : Infinity;
        const truncated = await forEachJob(queue, state, limit, (job) => {
          if (!job) return;
          const key = job.data?.repo?.toLowerCase() ?? homeKey;
          if (!value.byRepo.has(key)) value.byRepo.set(key, emptyQueues());
          value.byRepo.get(key)![team][state]++;
        });
        if (truncated) value.failedTruncated = true;
      }
    }
  } catch (err) {
    // Redis dropped after start: show empty counts rather than an error.
    // Not cached, so the next call retries.
    console.warn('[repo-stats] queue read failed:', err);
    return { byRepo: new Map(), failedTruncated: false };
  }
  countsCache = { at: Date.now(), homeKey, value };
  return value;
}

export async function getRepoStats(): Promise<RepoStatsResponse> {
  const root = getHomeRepoRoot();
  const entries = loadRepos();
  const homeRepo = await homeRepoName();
  const homeKey = homeRepo?.toLowerCase() ?? '';
  const { byRepo: counts, failedTruncated } = await queueCounts(homeKey);

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
    ...(failedTruncated && { failedTruncated }),
    repos: await Promise.all(
      rows.map(async ({ repo, home }) => {
        const prs = await draftPRs(repo);
        return {
          repo,
          home,
          queues: counts.get(repo?.toLowerCase() ?? '') ?? emptyQueues(),
          draftPRs: prs.value,
          ...(prs.error && { draftPRsError: prs.error }),
        };
      }),
    ),
  };
}

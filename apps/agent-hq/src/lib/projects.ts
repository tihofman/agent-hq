import type {
  RepoEntry,
  RepoStats,
  RepoStatsResponse,
} from '@agent-hq/queue/types';

export interface ProjectApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
}

async function apiRequest<T>(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit | undefined,
  defaultHttpError: (status: number) => string,
  networkError: string,
  hasData = true,
): Promise<ProjectApiResult<T>> {
  try {
    const res = init ? await fetchFn(url, init) : await fetchFn(url);
    if (res.ok) {
      const data = hasData ? ((await res.json()) as T) : undefined;
      return { ok: true, data, status: res.status };
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return {
      ok: false,
      error: body.error || defaultHttpError(res.status),
      status: res.status,
    };
  } catch {
    return { ok: false, error: networkError };
  }
}

export async function fetchProjectRepos(
  fetchFn: typeof fetch = fetch,
): Promise<ProjectApiResult<RepoEntry[]>> {
  return apiRequest<RepoEntry[]>(
    fetchFn,
    '/api/repos',
    undefined,
    (status) => `Server antwortete mit Status ${status}`,
    'Netzwerkfehler beim Laden der Repositories',
  );
}

export async function addProjectRepo(
  input: { repo: string; path: string; enabled?: boolean },
  fetchFn: typeof fetch = fetch,
): Promise<ProjectApiResult<RepoEntry>> {
  const repo = input.repo.trim();
  const path = input.path.trim();
  if (!repo || !path) {
    return {
      ok: false,
      error: 'Bitte owner/name und absoluten Pfad angeben',
    };
  }

  return apiRequest<RepoEntry>(
    fetchFn,
    '/api/repos',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo,
        path,
        enabled: input.enabled ?? true,
      }),
    },
    (status) => `Fehler beim Hinzufügen des Repositories (${status})`,
    'Netzwerkfehler beim Hinzufügen des Repositories',
  );
}

export async function removeProjectRepo(
  repo: string,
  fetchFn: typeof fetch = fetch,
): Promise<ProjectApiResult<void>> {
  const trimmed = repo.trim();
  if (!trimmed) {
    return { ok: false, error: 'Repository-Name darf nicht leer sein' };
  }

  return apiRequest<void>(
    fetchFn,
    `/api/repos/${trimmed}`,
    { method: 'DELETE' },
    (status) =>
      status === 404
        ? `Repo ${trimmed} ist nicht registriert (404)`
        : `Fehler beim Entfernen des Repositories (${status})`,
    'Netzwerkfehler beim Entfernen des Repositories',
    false,
  );
}

export async function toggleProjectRepo(
  repo: string,
  enabled: boolean,
  fetchFn: typeof fetch = fetch,
): Promise<ProjectApiResult<RepoEntry>> {
  const trimmed = repo.trim();
  if (!trimmed) {
    return { ok: false, error: 'Repository-Name darf nicht leer sein' };
  }

  return apiRequest<RepoEntry>(
    fetchFn,
    `/api/repos/${trimmed}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    },
    (status) => `Fehler beim Ändern des Status (${status})`,
    'Netzwerkfehler beim Ändern des Status',
  );
}

export interface ProjectRepoItem {
  repo: string;
  path?: string;
  enabled: boolean;
  isHome?: boolean;
  stats?: RepoStats;
}

export const HOME_FALLBACK_NAME = 'Home-Repository';

export async function fetchRepoStats(
  fetchFn: typeof fetch = fetch,
): Promise<ProjectApiResult<RepoStatsResponse>> {
  return apiRequest<RepoStatsResponse>(
    fetchFn,
    '/api/repos/stats',
    undefined,
    (status) => `Kennzahlen: Server antwortete mit Status ${status}`,
    'Netzwerkfehler beim Laden der Kennzahlen',
  );
}

/** Registry plus stats; missing stats are not fatal, the cards show zeros. */
export async function loadProjectOverview(
  fetchFn: typeof fetch = fetch,
): Promise<ProjectApiResult<ProjectRepoItem[]>> {
  const [reposRes, statsRes] = await Promise.all([
    fetchProjectRepos(fetchFn),
    fetchRepoStats(fetchFn),
  ]);
  if (!reposRes.ok) return { ok: false, error: reposRes.error };

  const stats = statsRes.data?.repos ?? [];
  const byName = new Map(
    stats.flatMap((s) => (s.repo ? [[s.repo.toLowerCase(), s] as const] : [])),
  );
  const items: ProjectRepoItem[] = (reposRes.data ?? []).map((entry) => {
    const s = byName.get(entry.repo.toLowerCase());
    return { ...entry, isHome: s?.home ?? false, stats: s };
  });
  // ADR 0007: empty registry means home repo; an unregistered home repo
  // also appears while it still has legacy jobs.
  const homeStats = stats.find((s) => s.home);
  if (homeStats && !items.some((i) => i.stats === homeStats)) {
    items.push(homeItem(homeStats.repo ?? statsRes.data?.homeRepo, homeStats));
  }
  if (items.length === 0) items.push(homeItem(statsRes.data?.homeRepo));
  return { ok: true, data: items };
}

function homeItem(repo?: string | null, stats?: RepoStats): ProjectRepoItem {
  return {
    repo: repo ?? HOME_FALLBACK_NAME,
    path: '(Home-Repository)',
    enabled: true,
    isHome: true,
    stats,
  };
}

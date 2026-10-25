export interface RepoEntryData {
  repo: string;
  path: string;
  enabled: boolean;
}

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
): Promise<ProjectApiResult<RepoEntryData[]>> {
  return apiRequest<RepoEntryData[]>(
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
): Promise<ProjectApiResult<RepoEntryData>> {
  const repo = input.repo.trim();
  const path = input.path.trim();
  if (!repo || !path) {
    return {
      ok: false,
      error: 'Bitte owner/name und absoluten Pfad angeben',
    };
  }

  return apiRequest<RepoEntryData>(
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
): Promise<ProjectApiResult<RepoEntryData>> {
  const trimmed = repo.trim();
  if (!trimmed) {
    return { ok: false, error: 'Repository-Name darf nicht leer sein' };
  }

  return apiRequest<RepoEntryData>(
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

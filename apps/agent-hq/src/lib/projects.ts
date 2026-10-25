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

export async function fetchProjectRepos(
  fetchFn: typeof fetch = fetch,
): Promise<ProjectApiResult<RepoEntryData[]>> {
  try {
    const res = await fetchFn('/api/repos');
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        ok: false,
        error: body.error || `Server antwortete mit Status ${res.status}`,
        status: res.status,
      };
    }
    const data = (await res.json()) as RepoEntryData[];
    return { ok: true, data, status: res.status };
  } catch {
    return {
      ok: false,
      error: 'Netzwerkfehler beim Laden der Repositories',
    };
  }
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

  try {
    const res = await fetchFn('/api/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo,
        path,
        enabled: input.enabled ?? true,
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as RepoEntryData;
      return { ok: true, data, status: res.status };
    }

    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const errorMsg =
      body.error || `Fehler beim Hinzufügen des Repositories (${res.status})`;
    return { ok: false, error: errorMsg, status: res.status };
  } catch {
    return {
      ok: false,
      error: 'Netzwerkfehler beim Hinzufügen des Repositories',
    };
  }
}

export async function removeProjectRepo(
  repo: string,
  fetchFn: typeof fetch = fetch,
): Promise<ProjectApiResult<void>> {
  const trimmed = repo.trim();
  if (!trimmed) {
    return { ok: false, error: 'Repository-Name darf nicht leer sein' };
  }

  try {
    const res = await fetchFn(`/api/repos/${trimmed}`, {
      method: 'DELETE',
    });

    if (res.ok) {
      return { ok: true, status: res.status };
    }

    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const errorMsg =
      body.error ||
      (res.status === 404
        ? `Repo ${trimmed} ist nicht registriert (404)`
        : `Fehler beim Entfernen des Repositories (${res.status})`);
    return { ok: false, error: errorMsg, status: res.status };
  } catch {
    return {
      ok: false,
      error: 'Netzwerkfehler beim Entfernen des Repositories',
    };
  }
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

  try {
    const res = await fetchFn(`/api/repos/${trimmed}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });

    if (res.ok) {
      const data = (await res.json()) as RepoEntryData;
      return { ok: true, data, status: res.status };
    }

    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const errorMsg =
      body.error || `Fehler beim Ändern des Status (${res.status})`;
    return { ok: false, error: errorMsg, status: res.status };
  } catch {
    return {
      ok: false,
      error: 'Netzwerkfehler beim Ändern des Status',
    };
  }
}

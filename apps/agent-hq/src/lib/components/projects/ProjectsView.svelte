<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { liveStore } from '../../live.svelte';
  import type { Team } from '../../server/state';
  import {
    fetchProjectRepos,
    addProjectRepo,
    removeProjectRepo,
    toggleProjectRepo,
  } from '../../projects';

  export interface RepoMetrics {
    queue: {
      frontend: number;
      backend: number;
      qa: number;
    };
    openQuestions: number;
    openDraftPrs: number;
  }

  export interface ProjectRepoItem {
    repo: string;
    path?: string;
    enabled: boolean;
    isHome?: boolean;
    metrics?: RepoMetrics;
  }

  interface Props {
    initialRepos?: ProjectRepoItem[];
    fetchFn?: typeof fetch;
  }

  let { initialRepos, fetchFn = fetch }: Props = $props();

  let repos = $state<ProjectRepoItem[]>(initialRepos ?? []);
  let loading = $state(!initialRepos);
  let pageError = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  // Add form fields
  let newRepo = $state('');
  let newPath = $state('');
  let newEnabled = $state(true);
  let addError = $state<string | null>(null);
  let isSubmitting = $state(false);

  function deriveMetricsForRepo(
    repoName: string,
    isHome = false,
  ): RepoMetrics {
    const runs = Object.values(liveStore.state?.runs ?? {});
    const questions = Object.values(liveStore.state?.questions ?? {});

    const isMatch = (targetRepo?: string) =>
      targetRepo === repoName || (!targetRepo && isHome);

    const countQueue = (team: Team) =>
      runs.filter(
        (r) =>
          isMatch(r.repo ?? r.data?.repo) &&
          r.data?.team === team &&
          (r.status === 'running' || r.status === 'handover'),
      ).length;

    const openQuestions = questions.filter(
      (q) => isMatch(q.repo) && q.status === 'PENDING',
    ).length;

    const openDraftPrs = runs.filter(
      (r) =>
        isMatch(r.repo ?? r.data?.repo) &&
        (Boolean(r.data?.prNumber) ||
          (liveStore.state?.activePR &&
            isMatch(liveStore.state.activePR.repo))),
    ).length;

    return {
      queue: {
        frontend: countQueue('frontend'),
        backend: countQueue('backend'),
        qa: countQueue('qa'),
      },
      openQuestions,
      openDraftPrs,
    };
  }

  async function loadRepos() {
    loading = true;
    pageError = null;
    const res = await fetchProjectRepos(fetchFn);
    if (!res.ok) {
      pageError = res.error || 'Fehler beim Laden der Repositories';
      loading = false;
      return;
    }

    const data = res.data ?? [];
    if (data.length === 0) {
      // ADR 0007: Leere Registry -> Home-Repo
      const activeRun = Object.values(liveStore.state?.runs ?? {}).find(
        (r) => r.repo || r.data?.repo,
      );
      const homeName =
        activeRun?.repo ?? activeRun?.data?.repo ?? 'tihofman/agent-hq';
      repos = [
        {
          repo: homeName,
          path: '(Home-Repository)',
          enabled: true,
          isHome: true,
        },
      ];
    } else {
      repos = data.map((d) => ({
        ...d,
        isHome: false,
      }));
    }
    loading = false;
  }

  async function handleAddRepo(event: SubmitEvent) {
    event.preventDefault();
    isSubmitting = true;
    addError = null;
    actionError = null;

    const res = await addProjectRepo(
      {
        repo: newRepo,
        path: newPath,
        enabled: newEnabled,
      },
      fetchFn,
    );

    if (!res.ok) {
      addError = res.error || 'Fehler beim Hinzufügen des Repositories';
      isSubmitting = false;
      return;
    }

    newRepo = '';
    newPath = '';
    newEnabled = true;
    isSubmitting = false;
    await loadRepos();
  }

  async function handleRemoveRepo(repoName: string) {
    actionError = null;
    const res = await removeProjectRepo(repoName, fetchFn);
    if (!res.ok) {
      actionError = res.error || 'Fehler beim Entfernen des Repositories';
      return;
    }
    repos = repos.filter((r) => r.repo !== repoName);
    if (repos.length === 0) {
      await loadRepos();
    }
  }

  async function handleToggleRepo(repoName: string, enabled: boolean) {
    actionError = null;
    const res = await toggleProjectRepo(repoName, enabled, fetchFn);
    if (!res.ok) {
      actionError = res.error || 'Fehler beim Ändern des Repository-Status';
      return;
    }
    repos = repos.map((r) =>
      r.repo === repoName ? { ...r, enabled } : r,
    );
  }

  onMount(() => {
    if (!initialRepos) {
      void loadRepos();
    }
  });
</script>

<div
  class="flex min-h-screen w-full flex-col bg-slate-950 text-slate-100 font-sans"
  data-testid="projects-page"
>
  <!-- Top Navigation Header -->
  <header
    class="flex h-14 w-full shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/95 px-6 font-mono text-xs backdrop-blur select-none"
  >
    <div class="flex items-center gap-4">
      <div
        class="flex items-center gap-2 rounded bg-indigo-950/80 px-2.5 py-1 text-indigo-300 border border-indigo-800/60 font-semibold tracking-wider"
      >
        <span class="inline-block h-2 w-2 rounded-full bg-indigo-400"></span>
        <span class="text-sm font-bold tracking-tight text-white">AGENT-HQ</span>
        <span class="text-[10px] text-indigo-400 uppercase">PROJEKTE</span>
      </div>
      <span class="text-slate-400 text-xs font-mono">
        Registrierte Repositories & Kennzahlen
      </span>
    </div>

    <div class="flex items-center gap-3">
      <button
        type="button"
        onclick={loadRepos}
        class="flex items-center gap-1.5 rounded bg-slate-800/90 px-3 py-1 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700 transition cursor-pointer"
        title="Liste aktualisieren"
        data-testid="refresh-button"
      >
        <span>↻</span>
        <span>Aktualisieren</span>
      </button>

      <a
        href={resolve('/history')}
        class="flex items-center gap-1.5 rounded bg-slate-800/90 px-3 py-1 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700 transition"
        data-testid="history-link"
      >
        Verlauf
      </a>

      <a
        href={resolve('/')}
        class="flex items-center gap-1.5 rounded bg-indigo-600/90 px-3 py-1 font-semibold text-white hover:bg-indigo-500 border border-indigo-500/80 transition"
        data-testid="dashboard-link"
      >
        ← Dashboard
      </a>
    </div>
  </header>

  <!-- Main Content -->
  <main class="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
    <div class="flex items-center justify-between border-b border-slate-800 pb-4">
      <div>
        <h1
          class="text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2"
        >
          <span>📁</span>
          <span>Projektansicht</span>
        </h1>
        <p class="text-xs text-slate-400 mt-1">
          Alle registrierten Repositories mit Status, Queue-Zählern und offenen Vorgängen auf einem Bildschirm.
        </p>
      </div>

      <div class="text-xs font-mono text-slate-400">
        Projekte: <strong class="text-slate-200">{repos.length}</strong>
      </div>
    </div>

    {#if actionError}
      <div
        class="rounded-lg border border-rose-800/80 bg-rose-950/40 p-4 text-rose-300 font-mono text-xs flex items-center justify-between"
        data-testid="action-error"
      >
        <span>⚠️ {actionError}</span>
        <button
          type="button"
          onclick={() => (actionError = null)}
          class="text-rose-400 hover:text-rose-200 font-bold ml-2 cursor-pointer"
        >
          ✕
        </button>
      </div>
    {/if}

    {#if loading}
      <div
        class="flex h-48 items-center justify-center text-slate-400 font-mono text-xs"
        data-testid="loading-state"
      >
        <span class="inline-block animate-pulse">Lade Repositories...</span>
      </div>
    {:else if pageError}
      <div
        class="rounded-lg border border-rose-800/80 bg-rose-950/40 p-6 text-rose-300 font-mono text-sm space-y-3"
        data-testid="error-state"
      >
        <div class="flex items-center gap-2 font-bold text-rose-200">
          <span>⚠️</span>
          <span>Fehler beim Laden der Projekte</span>
        </div>
        <p class="text-xs text-rose-300/80">{pageError}</p>
        <button
          type="button"
          onclick={loadRepos}
          class="rounded bg-rose-900/80 px-3 py-1 text-xs text-white hover:bg-rose-800 border border-rose-700 transition cursor-pointer"
        >
          Erneut versuchen
        </button>
      </div>
    {:else}
      <!-- Repositories Grid / Cards -->
      <div class="grid grid-cols-1 gap-4" data-testid="repos-list">
        {#each repos as r (r.repo)}
          {@const metrics = r.metrics ?? deriveMetricsForRepo(r.repo, r.isHome)}
          {@const repoSlug = r.repo.replace(/[/.]/g, '-')}
          <div
            class="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-5 shadow-lg font-mono text-xs"
            data-testid="repo-card-{repoSlug}"
          >
            <!-- Card Header: Repo Name, Path, Status Badge, Actions -->
            <div class="flex items-start justify-between gap-4">
              <div class="space-y-1 min-w-0">
                <div class="flex items-center gap-2">
                  <h2
                    class="text-base font-bold text-white tracking-tight truncate"
                    data-testid="repo-name-{repoSlug}"
                  >
                    {r.repo}
                  </h2>
                  {#if r.isHome}
                    <span
                      class="rounded bg-indigo-950/80 px-2 py-0.5 text-[10px] font-semibold text-indigo-300 border border-indigo-800/60"
                      data-testid="home-badge"
                    >
                      Home
                    </span>
                  {/if}
                  <span
                    class="rounded px-2 py-0.5 text-[10px] font-semibold border {r.enabled
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60'
                      : 'bg-slate-800 text-slate-400 border-slate-700'}"
                    data-testid="repo-status-{repoSlug}"
                  >
                    {r.enabled ? 'Aktiv' : 'Inaktiv'}
                  </span>
                </div>
                {#if r.path}
                  <p
                    class="text-[11px] text-slate-400 font-normal truncate"
                    data-testid="repo-path-{repoSlug}"
                  >
                    {r.path}
                  </p>
                {/if}
              </div>

              <!-- Action Controls -->
              <div class="flex items-center gap-2 shrink-0">
                {#if !r.isHome}
                  <button
                    type="button"
                    onclick={() => handleToggleRepo(r.repo, !r.enabled)}
                    class="rounded px-2.5 py-1 text-[11px] font-medium border transition cursor-pointer {r.enabled
                      ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-slate-700'
                      : 'bg-emerald-900/80 text-emerald-200 hover:bg-emerald-800 border-emerald-700/70'}"
                    data-testid="toggle-repo-{repoSlug}"
                  >
                    {r.enabled ? 'Deaktivieren' : 'Aktivieren'}
                  </button>

                  <button
                    type="button"
                    onclick={() => handleRemoveRepo(r.repo)}
                    class="rounded bg-rose-950/60 px-2.5 py-1 text-[11px] font-medium text-rose-300 hover:bg-rose-900 hover:text-white border border-rose-800/60 transition cursor-pointer"
                    data-testid="remove-repo-{repoSlug}"
                  >
                    Entfernen
                  </button>
                {/if}
              </div>
            </div>

            <!-- Metrics Bar -->
            <div
              class="grid grid-cols-2 md:grid-cols-5 gap-3 pt-3 border-t border-slate-800/80 text-xs"
              data-testid="repo-metrics-{repoSlug}"
            >
              <!-- Frontend Queue -->
              <div class="rounded bg-slate-950/60 p-2.5 border border-slate-800/60">
                <span class="text-[10px] text-slate-400 uppercase tracking-wider block">
                  Queue: Frontend
                </span>
                <span
                  class="text-sm font-bold text-sky-400 mt-0.5 block"
                  data-testid="queue-frontend-{repoSlug}"
                >
                  Frontend: {metrics.queue.frontend}
                </span>
              </div>

              <!-- Backend Queue -->
              <div class="rounded bg-slate-950/60 p-2.5 border border-slate-800/60">
                <span class="text-[10px] text-slate-400 uppercase tracking-wider block">
                  Queue: Backend
                </span>
                <span
                  class="text-sm font-bold text-orange-400 mt-0.5 block"
                  data-testid="queue-backend-{repoSlug}"
                >
                  Backend: {metrics.queue.backend}
                </span>
              </div>

              <!-- QA Queue -->
              <div class="rounded bg-slate-950/60 p-2.5 border border-slate-800/60">
                <span class="text-[10px] text-slate-400 uppercase tracking-wider block">
                  Queue: QA
                </span>
                <span
                  class="text-sm font-bold text-purple-400 mt-0.5 block"
                  data-testid="queue-qa-{repoSlug}"
                >
                  QA: {metrics.queue.qa}
                </span>
              </div>

              <!-- Offene Rückfragen -->
              <div class="rounded bg-slate-950/60 p-2.5 border border-slate-800/60">
                <span class="text-[10px] text-slate-400 uppercase tracking-wider block">
                  Rückfragen
                </span>
                <span
                  class="text-sm font-bold {metrics.openQuestions > 0
                    ? 'text-amber-400'
                    : 'text-slate-400'} mt-0.5 block"
                  data-testid="open-questions-{repoSlug}"
                >
                  Rückfragen: {metrics.openQuestions}
                </span>
              </div>

              <!-- Offene Draft-PRs -->
              <div class="rounded bg-slate-950/60 p-2.5 border border-slate-800/60">
                <span class="text-[10px] text-slate-400 uppercase tracking-wider block">
                  Draft-PRs
                </span>
                <span
                  class="text-sm font-bold text-emerald-400 mt-0.5 block"
                  data-testid="open-prs-{repoSlug}"
                >
                  Draft-PRs: {metrics.openDraftPrs}
                </span>
              </div>
            </div>
          </div>
        {/each}
      </div>

      <!-- Add Repo Form -->
      <section
        class="mt-8 rounded-lg border border-slate-800 bg-slate-900/40 p-5 shadow-lg space-y-4 font-mono text-xs"
        data-testid="add-repo-section"
      >
        <div class="border-b border-slate-800 pb-3">
          <h2 class="text-sm font-bold text-white flex items-center gap-2">
            <span>➕</span>
            <span>Repository hinzufügen</span>
          </h2>
          <p class="text-xs text-slate-400 mt-0.5">
            Registriert ein neues Git-Repository für Agent-HQ.
          </p>
        </div>

        <!-- Hinweis vor Hinzufügen (ADR 0007) -->
        <div
          class="rounded border border-amber-800/60 bg-amber-950/30 p-3 text-amber-200 text-xs flex items-start gap-2.5"
          data-testid="repo-notice"
        >
          <span class="text-sm">⚠️</span>
          <div>
            <strong class="font-semibold block text-amber-100">Hinweis zu GitHub-Labels:</strong>
            Beim Hinzufügen werden automatisch die erforderlichen Team- und Status-Labels
            (<code>team:*</code> und <code>status:*</code>) im GitHub-Repository angelegt.
            Außerdem wird <code>.worktrees/</code> in <code>.git/info/exclude</code> eingetragen.
          </div>
        </div>

        {#if addError}
          <div
            class="rounded border border-rose-800/80 bg-rose-950/40 p-3 text-rose-300 text-xs flex items-center gap-2"
            data-testid="repo-form-error"
          >
            <span>❌</span>
            <span>{addError}</span>
          </div>
        {/if}

        <form onsubmit={handleAddRepo} class="space-y-4" data-testid="add-repo-form">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Repo: owner/name -->
            <div class="space-y-1.5">
              <label for="repo-input" class="block text-slate-300 font-semibold">
                Repository (owner/name) <span class="text-rose-400">*</span>
              </label>
              <input
                id="repo-input"
                type="text"
                bind:value={newRepo}
                placeholder="acme/my-service"
                required
                class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                data-testid="repo-input"
              />
            </div>

            <!-- Path: /abs/path -->
            <div class="space-y-1.5">
              <label for="path-input" class="block text-slate-300 font-semibold">
                Lokaler Pfad (absolut) <span class="text-rose-400">*</span>
              </label>
              <input
                id="path-input"
                type="text"
                bind:value={newPath}
                placeholder="/Users/name/Projects/my-service"
                required
                class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                data-testid="path-input"
              />
            </div>
          </div>

          <!-- Checkbox Enabled -->
          <div class="flex items-center gap-2 pt-1">
            <input
              id="enabled-checkbox"
              type="checkbox"
              bind:checked={newEnabled}
              class="h-4 w-4 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
              data-testid="enabled-checkbox"
            />
            <label for="enabled-checkbox" class="text-slate-300 text-xs select-none cursor-pointer">
              Sofort aktivieren (Queue-Ingest aktiv)
            </label>
          </div>

          <!-- Submit Button -->
          <button
            type="submit"
            disabled={isSubmitting}
            class="rounded bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition cursor-pointer"
            data-testid="add-repo-button"
          >
            {isSubmitting ? 'Registriere...' : 'Repository hinzufügen'}
          </button>
        </form>
      </section>
    {/if}
  </main>
</div>

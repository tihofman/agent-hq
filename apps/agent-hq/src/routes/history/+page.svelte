<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { formatFeedTimestamp } from '../../lib/feed';
  import {
    formatDuration,
    formatRunTimestamp,
    formatStatusLabel,
    formatTicket,
    getAgentBadgeClass,
    getPrInfo,
    getStatusBadgeClass,
    type HistoryRunItem,
  } from '../../lib/history-format';

  let runs = $state<HistoryRunItem[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let expandedRunIds = $state<string[]>([]);
  let copiedPath = $state<string | null>(null);

  function isExpanded(runId: string): boolean {
    return expandedRunIds.includes(runId);
  }

  function toggleRun(runId: string) {
    if (expandedRunIds.includes(runId)) {
      expandedRunIds = expandedRunIds.filter((id) => id !== runId);
    } else {
      expandedRunIds = [...expandedRunIds, runId];
    }
  }

  async function loadHistory() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/history');
      if (!res.ok) {
        throw new Error(`Server antwortete mit Status ${res.status}`);
      }
      runs = (await res.json()) as HistoryRunItem[];
    } catch (err) {
      error =
        err instanceof Error ? err.message : 'Fehler beim Laden des Verlaufs';
    } finally {
      loading = false;
    }
  }

  async function copyToClipboard(text: string) {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        copiedPath = text;
        setTimeout(() => {
          if (copiedPath === text) copiedPath = null;
        }, 2000);
      }
    } catch {
      // Ignore clipboard error
    }
  }

  onMount(() => {
    void loadHistory();
  });
</script>

<svelte:head>
  <title>Agent-HQ • Verlaufsansicht</title>
</svelte:head>

<div
  class="flex min-h-screen w-full flex-col bg-slate-950 text-slate-100 font-sans"
  data-testid="history-page"
>
  <!-- Top Navigation Bar -->
  <header
    class="flex h-14 w-full shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/95 px-6 font-mono text-xs backdrop-blur select-none"
  >
    <div class="flex items-center gap-4">
      <div
        class="flex items-center gap-2 rounded bg-indigo-950/80 px-2.5 py-1 text-indigo-300 border border-indigo-800/60 font-semibold tracking-wider"
      >
        <span class="inline-block h-2 w-2 rounded-full bg-indigo-400"></span>
        <span class="text-sm font-bold tracking-tight text-white">AGENT-HQ</span
        >
        <span class="text-[10px] text-indigo-400 uppercase">VERLAUF</span>
      </div>
      <span class="text-slate-400 text-xs font-mono"
        >Historie der letzten 20 Läufe</span
      >
    </div>

    <div class="flex items-center gap-3">
      <button
        type="button"
        onclick={loadHistory}
        class="flex items-center gap-1.5 rounded bg-slate-800/90 px-3 py-1 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700 transition cursor-pointer"
        title="Verlauf aktualisieren"
        data-testid="refresh-button"
      >
        <span>↻</span>
        <span>Aktualisieren</span>
      </button>

      <a
        href={resolve('/')}
        class="flex items-center gap-1.5 rounded bg-indigo-600/90 px-3 py-1 font-semibold text-white hover:bg-indigo-500 border border-indigo-500/80 transition"
        data-testid="dashboard-link"
      >
        ← Dashboard
      </a>
    </div>
  </header>

  <!-- Main Content Area -->
  <main class="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
    <div
      class="flex items-center justify-between border-b border-slate-800 pb-4"
    >
      <div>
        <h1
          class="text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2"
        >
          <span>📜</span>
          <span>Vergangene Delegationen</span>
        </h1>
        <p class="text-xs text-slate-400 mt-1">
          Übersicht der letzten 20 Ausführungen mit Status, Event-Verlauf, Logs
          und Pull Requests.
        </p>
      </div>

      <div class="text-xs font-mono text-slate-400">
        Einträge: <strong class="text-slate-200">{runs.length}</strong> / 20
      </div>
    </div>

    {#if loading}
      <div
        class="flex h-64 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/40 text-slate-400 font-mono text-sm"
        data-testid="loading-state"
      >
        <div class="flex items-center gap-2">
          <span class="animate-spin text-lg">⚙</span>
          <span>Lade Verlauf...</span>
        </div>
      </div>
    {:else if error}
      <div
        class="rounded-lg border border-rose-800/80 bg-rose-950/40 p-6 text-rose-300 font-mono text-sm space-y-3"
        data-testid="error-state"
      >
        <div class="flex items-center gap-2 font-bold text-rose-200">
          <span>⚠️</span>
          <span>Fehler beim Laden des Verlaufs</span>
        </div>
        <p class="text-xs text-rose-300/80">{error}</p>
        <button
          type="button"
          onclick={loadHistory}
          class="rounded bg-rose-900/80 px-3 py-1 text-xs text-white hover:bg-rose-800 border border-rose-700 transition cursor-pointer"
        >
          Erneut versuchen
        </button>
      </div>
    {:else if runs.length === 0}
      <div
        class="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-slate-800 bg-slate-900/20 text-slate-400 font-mono text-sm space-y-2"
        data-testid="empty-state"
      >
        <span class="text-3xl">📭</span>
        <span class="font-medium text-slate-300"
          >Keine vergangenen Läufe gefunden</span
        >
        <span class="text-xs text-slate-500">
          Starte eine Delegation über Claude, Agy oder Codex, um Historie
          aufzuzeichnen.
        </span>
      </div>
    {:else}
      <div
        class="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/50 shadow-xl"
        data-testid="history-table-container"
      >
        <table
          class="w-full text-left font-mono text-xs divide-y divide-slate-800"
        >
          <thead
            class="bg-slate-950/90 text-slate-400 uppercase text-[11px] tracking-wider select-none"
          >
            <tr>
              <th class="py-3 px-4 font-semibold w-24">Agent</th>
              <th class="py-3 px-4 font-semibold w-20">Ticket</th>
              <th class="py-3 px-4 font-semibold w-44">Start</th>
              <th class="py-3 px-4 font-semibold w-24">Dauer</th>
              <th class="py-3 px-4 font-semibold w-40">Status</th>
              <th class="py-3 px-4 font-semibold min-w-[200px]">Log-Datei</th>
              <th class="py-3 px-4 font-semibold w-36 whitespace-nowrap"
                >Pull Request</th
              >
              <th class="py-3 px-4 font-semibold text-right w-24">Events</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/80 bg-slate-900/30">
            {#each runs as run (run.runId)}
              {@const prInfo = getPrInfo(run.data, run.prUrl)}
              <tr
                class="hover:bg-slate-800/40 transition-colors {isExpanded(
                  run.runId,
                )
                  ? 'bg-slate-800/30'
                  : ''}"
                data-testid="run-row-{run.runId}"
              >
                <!-- Agent -->
                <td class="py-3 px-4 whitespace-nowrap">
                  <span
                    class="inline-block rounded px-2 py-0.5 text-[11px] font-semibold border {getAgentBadgeClass(
                      run.agent,
                    )}"
                  >
                    {run.agent}
                  </span>
                </td>

                <!-- Ticket -->
                <td
                  class="py-3 px-4 whitespace-nowrap text-slate-300 font-semibold"
                >
                  {formatTicket(run.ticketId)}
                </td>

                <!-- Start -->
                <td
                  class="py-3 px-4 whitespace-nowrap text-slate-400 text-[11px]"
                >
                  {formatRunTimestamp(run.startedAt)}
                </td>

                <!-- Dauer -->
                <td
                  class="py-3 px-4 whitespace-nowrap text-slate-300 font-medium"
                >
                  {formatDuration(run.durationMs)}
                </td>

                <!-- Status / Exit-Code -->
                <td class="py-3 px-4 whitespace-nowrap">
                  <span
                    class="inline-block rounded px-2 py-0.5 text-[11px] font-medium border {getStatusBadgeClass(
                      run.status,
                    )}"
                  >
                    {formatStatusLabel(run.status, run.exitCode)}
                  </span>
                </td>

                <!-- Log-Datei -->
                <td class="py-3 px-4">
                  {#if run.logExists && run.logFile}
                    <div class="flex items-center gap-1.5" title={run.logFile}>
                      <span
                        class="text-slate-300 font-mono text-xs max-w-[200px] truncate"
                        data-testid="log-path-{run.runId}"
                      >
                        {run.logFile.split('/').pop() || run.logFile}
                      </span>
                      <button
                        type="button"
                        onclick={() => copyToClipboard(run.logFile ?? '')}
                        class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
                        title="Pfad kopieren"
                        data-testid="copy-log-{run.runId}"
                      >
                        {copiedPath === run.logFile ? '✓' : '📋'}
                      </button>
                    </div>
                  {:else}
                    <span class="text-slate-600">—</span>
                  {/if}
                </td>

                <!-- Pull Request -->
                <td class="py-3 px-4 whitespace-nowrap">
                  {#if prInfo}
                    {#if prInfo.url}
                      <a
                        href={prInfo.url}
                        target="_blank"
                        rel="external noopener noreferrer"
                        class="text-indigo-400 hover:text-indigo-300 underline font-medium inline-flex items-center gap-1"
                        title="Pull Request auf GitHub öffnen"
                        data-testid="pr-link-{run.runId}"
                      >
                        <span>{prInfo.label}</span>
                        <span class="text-[10px]">↗</span>
                      </a>
                    {:else}
                      <span
                        class="text-slate-400"
                        data-testid="pr-text-{run.runId}"
                      >
                        {prInfo.label}
                      </span>
                    {/if}
                  {:else}
                    <span class="text-slate-600">—</span>
                  {/if}
                </td>

                <!-- Events Aufklapp-Button -->
                <td class="py-3 px-4 whitespace-nowrap text-right">
                  <button
                    type="button"
                    onclick={() => toggleRun(run.runId)}
                    class="rounded bg-slate-800/90 px-2.5 py-1 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700 transition cursor-pointer inline-flex items-center gap-1"
                    aria-expanded={isExpanded(run.runId)}
                    data-testid="toggle-events-{run.runId}"
                  >
                    <span class="text-[9px]"
                      >{isExpanded(run.runId) ? '▼' : '▶'}</span
                    >
                    <span>{run.events?.length ?? 0}</span>
                  </button>
                </td>
              </tr>

              <!-- Detailansicht mit allen Events des Runs -->
              {#if isExpanded(run.runId)}
                <tr
                  class="bg-slate-950/70 border-b border-slate-800"
                  data-testid="run-details-{run.runId}"
                >
                  <td colspan="8" class="p-4">
                    <div
                      class="rounded border border-slate-800 bg-slate-900/90 p-4 space-y-3"
                    >
                      <!-- Meta Info Bar -->
                      <div
                        class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-2.5 text-xs text-slate-400"
                      >
                        <div class="flex items-center gap-4">
                          <div>
                            <span class="text-slate-500">Run ID:</span>
                            <span class="text-slate-200 font-semibold"
                              >{run.runId}</span
                            >
                          </div>
                          {#if run.pid}
                            <div>
                              <span class="text-slate-500">PID:</span>
                              <span class="text-slate-200">{run.pid}</span>
                            </div>
                          {/if}
                          {#if run.data?.branch}
                            <div>
                              <span class="text-slate-500">Branch:</span>
                              <span class="text-emerald-400 font-medium"
                                >{run.data.branch}</span
                              >
                            </div>
                          {/if}
                          {#if run.data?.repo}
                            <div>
                              <span class="text-slate-500">Repo:</span>
                              <span class="text-slate-200">{run.data.repo}</span
                              >
                            </div>
                          {/if}
                        </div>

                        {#if run.logFile}
                          <div class="flex items-center gap-1.5 text-[11px]">
                            <span class="text-slate-500">Logfile:</span>
                            <span class="text-slate-300 break-all"
                              >{run.logFile}</span
                            >
                            {#if !run.logExists}
                              <span class="text-amber-400 text-[10px]"
                                >(Datei gelöscht/nicht gefunden)</span
                              >
                            {/if}
                          </div>
                        {/if}
                      </div>

                      <!-- Events Table -->
                      {#if !run.events || run.events.length === 0}
                        <div class="text-center py-4 text-xs text-slate-500">
                          Keine Events für diesen Run aufgezeichnet.
                        </div>
                      {:else}
                        <div class="overflow-x-auto">
                          <table class="w-full text-left font-mono text-xs">
                            <thead>
                              <tr
                                class="text-slate-500 border-b border-slate-800/80 pb-1 text-[11px]"
                              >
                                <th class="py-1.5 px-2 font-medium w-24"
                                  >Zeit</th
                                >
                                <th class="py-1.5 px-2 font-medium w-36"
                                  >Event</th
                                >
                                <th class="py-1.5 px-2 font-medium w-20"
                                  >Agent</th
                                >
                                <th class="py-1.5 px-2 font-medium w-20"
                                  >Raum</th
                                >
                                <th class="py-1.5 px-2 font-medium">Details</th>
                              </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-800/50">
                              {#each run.events as event, i (event.timestamp + '-' + event.event + '-' + i)}
                                <tr class="hover:bg-slate-800/40">
                                  <td
                                    class="py-1.5 px-2 text-slate-400 whitespace-nowrap"
                                  >
                                    {formatFeedTimestamp(event.timestamp)}
                                  </td>
                                  <td
                                    class="py-1.5 px-2 font-semibold text-slate-200"
                                  >
                                    {event.event}
                                  </td>
                                  <td class="py-1.5 px-2 whitespace-nowrap">
                                    <span
                                      class="rounded px-1.5 py-0.5 text-[10px] border {getAgentBadgeClass(
                                        event.agent,
                                      )}"
                                    >
                                      {event.agent}
                                    </span>
                                  </td>
                                  <td
                                    class="py-1.5 px-2 text-slate-400 capitalize"
                                  >
                                    {event.room}
                                  </td>
                                  <td
                                    class="py-1.5 px-2 text-slate-300 break-all"
                                  >
                                    {#if event.data?.statusText}
                                      <span class="text-slate-200"
                                        >{event.data.statusText}</span
                                      >
                                    {:else if event.data?.title}
                                      <span class="text-slate-200"
                                        >{event.data.title}</span
                                      >
                                    {:else if event.data?.exitCode !== undefined}
                                      <span>
                                        Exit-Code: <strong
                                          class={event.data.exitCode === 0
                                            ? 'text-emerald-400'
                                            : 'text-rose-400'}
                                          >{event.data.exitCode}</strong
                                        >
                                      </span>
                                    {:else if event.data?.logChunk}
                                      <span
                                        class="text-slate-400 truncate block max-w-lg"
                                        >{event.data.logChunk.trim()}</span
                                      >
                                    {:else}
                                      <span class="text-slate-600">—</span>
                                    {/if}
                                  </td>
                                </tr>
                              {/each}
                            </tbody>
                          </table>
                        </div>
                      {/if}
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </main>
</div>

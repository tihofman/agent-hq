<script lang="ts">
  import TopBar from '../lib/components/TopBar.svelte';
  import OfficeFloor from '../lib/components/office/OfficeFloor.svelte';
  import type { RoomId } from '../lib/office/layout';

  // Integer scaling: 1x or 2x
  let zoomScale = $state<1 | 2>(1);
  let showWaypoints = $state(false);
  let activeFilter = $state<'ALL' | 'CLAUDE' | 'AGY' | 'CODEX'>('ALL');
  let selectedRoom = $state<RoomId | undefined>(undefined);

  const mockLogs = [
    {
      time: '21:18:29',
      agent: 'CLAUDE',
      color: 'text-indigo-400',
      badge: 'bg-indigo-950/80 text-indigo-300 border-indigo-800/60',
      msg: 'Delegiert Ticket #11 (Büro-Grundriss & Dashboard) an agy',
    },
    {
      time: '21:19:12',
      agent: 'AGY',
      color: 'text-purple-400',
      badge: 'bg-purple-950/80 text-purple-300 border-purple-800/60',
      msg: 'Raumkoordinaten & Waypoints in layout.ts initialisiert',
    },
    {
      time: '21:26:08',
      agent: 'TEST',
      color: 'text-emerald-400',
      badge: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60',
      msg: 'Unit-Tests für layout.ts erfolgreich: 80/80 Tests grün',
    },
    {
      time: '21:27:00',
      agent: 'AGY',
      color: 'text-purple-400',
      badge: 'bg-purple-950/80 text-purple-300 border-purple-800/60',
      msg: 'OfficeFloor.svelte & Room.svelte mit 5 Zonen gerendert',
    },
  ];

  const filteredLogs = $derived(
    activeFilter === 'ALL'
      ? mockLogs
      : mockLogs.filter((log) => log.agent === activeFilter),
  );

  const criteria = [
    {
      id: 1,
      text: 'Layout mit Top Bar, zentralem Office, rechter Sidebar und unterer Leiste; nutzbar ab 1280 px',
      done: true,
    },
    {
      id: 2,
      text: 'OfficeFloor.svelte und Room.svelte rendern CEO Suite, Flur, Dev Lab, QS Station und Lounge aus dem Tileset',
      done: true,
    },
    {
      id: 3,
      text: 'Skalierung ganzzahlig mit image-rendering: pixelated',
      done: true,
    },
    {
      id: 4,
      text: 'Raumkoordinaten und Waypoints sind als Daten (nicht im Markup verstreut) definiert',
      done: true,
    },
    {
      id: 5,
      text: 'Top Bar zeigt Platzhalter für Repo/Branch, Gesamtstatus, Kill-Button und Audio-Toggle',
      done: true,
    },
  ];
</script>

<svelte:head>
  <title>Agent-HQ • Virtual Office & Monitor</title>
</svelte:head>

<!-- Root App Shell (min 1280px width) -->
<div
  class="flex h-screen w-full min-w-[1280px] flex-col bg-slate-950 text-slate-100 font-sans select-none overflow-hidden"
  data-testid="dashboard-layout"
>
  <!-- 1. Top Bar -->
  <TopBar
    repo="tihofman/agent-hq"
    branch="feat/11-office-layout"
    statusText="Subagent 'agy' arbeitet an Ticket #11"
    isBusy={true}
  />

  <!-- 2. Middle Section: Office (Center) & Feed (Right) -->
  <div class="flex flex-1 overflow-hidden">
    <!-- Center: Virtual Office Viewport -->
    <main
      class="flex flex-1 flex-col overflow-hidden bg-slate-900/60 relative border-r border-slate-800"
      data-testid="office-viewport-container"
    >
      <!-- Office View Toolbar -->
      <div
        class="flex h-10 w-full shrink-0 items-center justify-between border-b border-slate-800/80 bg-slate-950/60 px-4 font-mono text-xs backdrop-blur-xs"
      >
        <div class="flex items-center gap-2 text-slate-300">
          <span class="text-sm">🏢</span>
          <span class="font-bold tracking-tight text-white">VIRTUAL OFFICE</span
          >
          <span class="text-slate-500">|</span>
          <span class="text-[11px] text-slate-400"
            >5 Zonen • 16-Bit Endesga 32</span
          >
        </div>

        <!-- Controls: Integer Scale & Waypoint Toggle -->
        <div class="flex items-center gap-2">
          <!-- Waypoints Debug Toggle -->
          <button
            type="button"
            onclick={() => (showWaypoints = !showWaypoints)}
            class="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-mono border transition cursor-pointer {showWaypoints
              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80'
              : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'}"
            title="Waypoints & Pfad-Knotenpunkte einblenden"
          >
            <span>🧭 Waypoints</span>
            <span
              class="rounded px-1 text-[9px] {showWaypoints
                ? 'bg-emerald-800/60 text-emerald-200'
                : 'bg-slate-700 text-slate-400'}"
            >
              {showWaypoints ? 'ON' : 'OFF'}
            </span>
          </button>

          <!-- Integer Zoom Scale (1x / 2x) -->
          <div
            class="flex items-center rounded bg-slate-900 border border-slate-800 p-0.5 text-[11px] font-mono"
            title="Ganzzahlige Pixel-Skalierung (image-rendering: pixelated)"
          >
            <span class="px-1.5 text-slate-500">Scale:</span>
            <button
              type="button"
              onclick={() => (zoomScale = 1)}
              class="rounded px-2 py-0.5 transition cursor-pointer {zoomScale ===
              1
                ? 'bg-indigo-600 text-white font-bold'
                : 'text-slate-400 hover:text-white'}"
            >
              1x
            </button>
            <button
              type="button"
              onclick={() => (zoomScale = 2)}
              class="rounded px-2 py-0.5 transition cursor-pointer {zoomScale ===
              2
                ? 'bg-indigo-600 text-white font-bold'
                : 'text-slate-400 hover:text-white'}"
            >
              2x
            </button>
          </div>
        </div>
      </div>

      <!-- Office Floor Canvas Area -->
      <div
        class="flex flex-1 items-center justify-center overflow-auto p-4 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px]"
      >
        <OfficeFloor
          scale={zoomScale}
          {showWaypoints}
          highlightedRoom={selectedRoom}
        />
      </div>
    </main>

    <!-- Right Sidebar: Live Feed (Read-Only) -->
    <aside
      class="flex w-84 shrink-0 flex-col bg-slate-950/95 font-mono text-xs select-none"
      data-testid="right-sidebar"
    >
      <!-- Feed Header -->
      <div
        class="flex h-10 w-full shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/80 px-3.5"
      >
        <div class="flex items-center gap-1.5">
          <span class="inline-block h-2 w-2 rounded-full bg-emerald-400"></span>
          <span class="font-bold tracking-tight text-white">LIVE FEED</span>
        </div>
        <span
          class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 border border-slate-700"
        >
          READ-ONLY
        </span>
      </div>

      <!-- Filter Badges -->
      <div
        class="flex items-center gap-1.5 border-b border-slate-800/80 bg-slate-900/40 p-2"
      >
        {#each ['ALL', 'CLAUDE', 'AGY', 'CODEX'] as filter (filter)}
          <button
            type="button"
            onclick={() =>
              (activeFilter = filter as 'ALL' | 'CLAUDE' | 'AGY' | 'CODEX')}
            class="rounded px-2 py-0.5 text-[10px] font-semibold transition cursor-pointer {activeFilter ===
            filter
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'}"
          >
            {filter}
          </button>
        {/each}
      </div>

      <!-- Feed Events List -->
      <div class="flex-1 overflow-y-auto p-3 space-y-2.5">
        {#each filteredLogs as log (log.time + '-' + log.agent)}
          <div
            class="rounded border border-slate-800/80 bg-slate-900/50 p-2 text-[11px] leading-relaxed transition hover:border-slate-700"
          >
            <div class="flex items-center justify-between text-[10px] mb-1">
              <span class="rounded px-1.5 py-0.2 font-bold border {log.badge}">
                {log.agent}
              </span>
              <span class="text-slate-500">{log.time}</span>
            </div>
            <p class="text-slate-300 font-sans text-xs">{log.msg}</p>
          </div>
        {/each}

        <div
          class="rounded border border-dashed border-slate-800 p-2.5 text-center text-[10px] text-slate-500"
        >
          Warte auf eingehende Events über SSE (/api/stream)...
        </div>
      </div>

      <!-- Sidebar Footer -->
      <div
        class="border-t border-slate-800 bg-slate-900/60 p-2 text-[10px] text-slate-500 text-center"
      >
        <span>127.0.0.1:3333 • 100% lokal & Flatrate</span>
      </div>
    </aside>
  </div>

  <!-- 3. Bottom Bar: Ticket & Acceptance Criteria Matrix -->
  <footer
    class="flex h-44 shrink-0 flex-col border-t border-slate-800 bg-slate-950/95 font-mono text-xs select-none"
    data-testid="bottom-bar"
  >
    <!-- Ticket Summary Bar -->
    <div
      class="flex h-9 w-full shrink-0 items-center justify-between border-b border-slate-800/80 bg-slate-900/80 px-4"
    >
      <div class="flex items-center gap-3">
        <span
          class="flex items-center gap-1.5 rounded bg-indigo-950/90 px-2 py-0.5 font-bold text-indigo-300 border border-indigo-700/60"
        >
          <span class="text-xs">📋</span>
          <span>TICKET #11</span>
        </span>
        <span class="font-sans font-semibold text-white text-xs">
          Dashboard-Layout & Büro-Grundriss
        </span>
        <span
          class="rounded bg-amber-950/80 px-2 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-700/60"
        >
          DRAFT PR IN PROGRESS
        </span>
      </div>

      <div class="flex items-center gap-3 text-slate-400 text-[11px]">
        <span>Agent: <strong class="text-purple-400">agy</strong></span>
        <span>•</span>
        <span>Milestone: Phase 3 (Virtual Office UI)</span>
      </div>
    </div>

    <!-- Acceptance Criteria Matrix (2 Columns) -->
    <div class="flex flex-1 items-center px-4 py-2 font-sans overflow-hidden">
      <div class="grid grid-cols-2 gap-x-6 gap-y-2 w-full text-xs">
        {#each criteria as item (item.id)}
          <div class="flex items-start gap-2">
            <span
              class="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-emerald-950 text-emerald-400 border border-emerald-700/80 text-[10px] font-bold"
            >
              ✓
            </span>
            <span class="text-slate-300 leading-tight">
              {item.text}
            </span>
          </div>
        {/each}

        <!-- Progress Summary -->
        <div class="flex items-center gap-3">
          <div
            class="h-2 flex-1 rounded-full bg-slate-800 overflow-hidden border border-slate-700"
          >
            <div class="h-full bg-emerald-500 w-full transition-all"></div>
          </div>
          <span
            class="font-mono text-[11px] font-bold text-emerald-400 shrink-0"
            >5 / 5 Erfüllt (100%)</span
          >
        </div>
      </div>
    </div>
  </footer>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    background-color: #020617;
  }
</style>

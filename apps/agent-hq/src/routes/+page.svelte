<script lang="ts">
  import { onMount } from 'svelte';
  import { connect } from '../lib/live.svelte';
  import TopBar from '../lib/components/TopBar.svelte';
  import AlertsListener from '../lib/components/AlertsListener.svelte';
  import OfficeFloor from '../lib/components/office/OfficeFloor.svelte';
  import LogViewer from '../lib/components/feed/LogViewer.svelte';
  import TicketCard from '../lib/components/tracker/TicketCard.svelte';
  import type { RoomId } from '../lib/office/layout';

  // Integer scaling: 1x or 2x
  let zoomScale = $state<1 | 2>(1);
  let showWaypoints = $state(false);
  let selectedRoom = $state<RoomId | undefined>(undefined);

  onMount(() => {
    return connect();
  });
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
  <TopBar />
  <AlertsListener />

  <!-- 2. Middle Section: Office (Center) & Feed Slot (Right) -->
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
            >5 Zonen • 128px Endesga 32</span
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

      <!-- Office Floor Canvas Area (m-auto prevents negative offset clipping) -->
      <div
        class="flex flex-1 overflow-auto p-4 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px]"
      >
        <div class="m-auto">
          <OfficeFloor
            scale={zoomScale}
            {showWaypoints}
            highlightedRoom={selectedRoom}
          />
        </div>
      </div>
    </main>

    <!-- Right Sidebar: Live Feed Slot -->
    <aside
      class="flex w-84 shrink-0 flex-col bg-slate-950/95 font-mono text-xs select-none"
      data-testid="right-sidebar"
    >
      <div
        class="flex h-10 w-full shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/80 px-3.5"
      >
        <div class="flex items-center gap-1.5 text-slate-400 font-semibold">
          <span class="inline-block h-2 w-2 rounded-full bg-slate-600"></span>
          <span>LIVE-FEED</span>
        </div>
        <span
          class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 border border-slate-700"
        >
          SLOT
        </span>
      </div>

      <LogViewer />
    </aside>
  </div>

  <!-- 3. Bottom Bar: Ticket & Akzeptanzkriterien Slot -->
  <footer
    class="flex h-28 shrink-0 flex-col border-t border-slate-800 bg-slate-950/95 font-mono text-xs select-none"
    data-testid="bottom-bar"
  >
    <div
      class="flex h-8 w-full shrink-0 items-center justify-between border-b border-slate-800/80 bg-slate-900/80 px-4"
    >
      <div class="flex items-center gap-2 text-slate-400 font-semibold">
        <span>📋</span>
        <span>TICKET &amp; AKZEPTANZKRITERIEN</span>
      </div>
      <span
        class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 border border-slate-700"
      >
        SLOT
      </span>
    </div>

    <TicketCard />
  </footer>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    background-color: #020617;
  }
</style>

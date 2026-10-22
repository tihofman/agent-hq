<script lang="ts">
  import { onMount } from 'svelte';
  import { liveStore } from '../live.svelte';
  import { isAudioEnabled, setAudioEnabled } from '../audio';
  import { requestNotificationPermission } from '../notify';
  import KillSwitch from './KillSwitch.svelte';

  interface Props {
    repo?: string;
    branch?: string;
    statusText?: string;
    isBusy?: boolean;
    onToggleAudio?: (enabled: boolean) => void;
  }

  let {
    repo: propRepo,
    branch: propBranch,
    statusText: propStatusText,
    isBusy: propIsBusy,
    onToggleAudio,
  }: Props = $props();

  let audioEnabled = $state(false);

  onMount(() => {
    audioEnabled = isAudioEnabled();
  });

  function toggleAudio() {
    audioEnabled = !audioEnabled;
    setAudioEnabled(audioEnabled);
    if (audioEnabled) {
      void requestNotificationPermission();
    }
    onToggleAudio?.(audioEnabled);
  }

  const activeRun = $derived.by(() => {
    const runs = Object.values(liveStore.state.runs).filter(
      (r) => r.status === 'handover' || r.status === 'running',
    );
    if (runs.length === 0) return null;
    return runs.reduce((latest, current) =>
      Date.parse(current.timestamp) > Date.parse(latest.timestamp)
        ? current
        : latest,
    );
  });

  const displayRepo = $derived(activeRun?.data.repo ?? propRepo ?? '—');
  const displayBranch = $derived(activeRun?.data.branch ?? propBranch ?? '—');
  const displayIsBusy = $derived(propIsBusy ?? activeRun !== null);

  const displayStatusText = $derived.by(() => {
    if (propStatusText !== undefined) return propStatusText;
    if (!activeRun) return 'Bereit';
    if (activeRun.ticketId) {
      const ticket = activeRun.ticketId.startsWith('#')
        ? activeRun.ticketId
        : `#${activeRun.ticketId}`;
      return `${activeRun.agent} arbeitet an ${ticket}`;
    }
    if (activeRun.data.title) {
      return `${activeRun.agent} arbeitet an ${activeRun.data.title}`;
    }
    if (activeRun.data.statusText) {
      return `${activeRun.agent}: ${activeRun.data.statusText}`;
    }
    return `${activeRun.agent} arbeitet`;
  });
</script>

<header
  class="flex h-14 w-full shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/95 px-4 font-mono text-xs backdrop-blur select-none"
  data-testid="top-bar"
>
  <!-- Left: Brand Logo & Repo / Branch Badge -->
  <div class="flex items-center gap-3">
    <div
      class="flex items-center gap-2 rounded bg-indigo-950/80 px-2.5 py-1 text-indigo-300 border border-indigo-800/60 font-semibold tracking-wider"
    >
      <span class="inline-block h-2 w-2 rounded-full bg-indigo-400"></span>
      <span class="text-sm font-bold tracking-tight text-white">AGENT-HQ</span>
      <span class="text-[10px] text-indigo-400 uppercase">v0.1</span>
    </div>

    <!-- Repo / Branch Badge Placeholder -->
    <div
      class="flex items-center gap-1.5 rounded bg-slate-800/80 px-2.5 py-1 text-slate-300 border border-slate-700/60"
      title="Aktives Repository und Feature-Branch"
      data-testid="repo-branch-badge"
    >
      <svg
        class="h-3.5 w-3.5 text-slate-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
        />
      </svg>
      <span class="font-medium text-slate-200">{displayRepo}</span>
      <span class="text-slate-500">:</span>
      <span class="flex items-center gap-1 text-emerald-400">
        <svg
          class="h-3 w-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M7 7h.01M7 3a5 5 0 00-5 5v12a2 2 0 002 2h16a2 2 0 002-2V8a5 5 0 00-5-5H7z"
          />
        </svg>
        {displayBranch}
      </span>
    </div>
  </div>

  <!-- Center: Overall System Status Indicator -->
  <div
    class="flex items-center gap-2 rounded-full bg-slate-950/70 px-3.5 py-1 border border-slate-800"
    data-testid="system-status"
  >
    <span class="relative flex h-2 w-2">
      {#if displayIsBusy}
        <span
          class="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75"
        ></span>
        <span class="relative inline-flex h-2 w-2 rounded-full bg-amber-500"
        ></span>
      {:else}
        <span
          class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50"
        ></span>
        <span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"
        ></span>
      {/if}
    </span>
    <span class="font-sans text-xs text-slate-300 font-medium">
      {displayStatusText}
    </span>
  </div>

  <!-- Right: Audio-Toggle & Notfall-Stopp (Kill Switch) -->
  <div class="flex items-center gap-2">
    <!-- Audio-Toggle Button -->
    <button
      type="button"
      onclick={toggleAudio}
      class="flex items-center gap-1.5 rounded bg-slate-800/90 px-2.5 py-1 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700 transition cursor-pointer"
      title={audioEnabled
        ? 'Chiptune Sound-FX stummschalten'
        : 'Chiptune Sound-FX aktivieren'}
      data-testid="audio-toggle"
    >
      {#if audioEnabled}
        <span class="text-sm">🔊</span>
        <span class="text-[11px] font-medium text-emerald-400">AUDIO ON</span>
      {:else}
        <span class="text-sm">🔇</span>
        <span class="text-[11px] font-medium text-slate-400">MUTED</span>
      {/if}
    </button>

    <KillSwitch runId={activeRun?.runId ?? null} />
  </div>
</header>

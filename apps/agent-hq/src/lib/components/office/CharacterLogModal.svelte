<script lang="ts">
  import { tick } from 'svelte';
  import { liveStore } from '../../live.svelte';
  import type { Agent } from '../../server/state';
  import { getSpriteMetadata } from '../../office/sprites';
  import {
    filterCharacterLog,
    getLogFileFallback,
  } from '../../office/log-filter';
  import FeedMessage from '../feed/FeedMessage.svelte';

  interface Props {
    agent: Agent;
    runId?: string;
    triggerEl?: HTMLElement | null;
    onclose: () => void;
  }

  let { agent, runId, triggerEl, onclose }: Props = $props();

  const metadata = $derived(getSpriteMetadata(agent));
  const activeRun = $derived(
    runId ? liveStore.state?.runs?.[runId] : undefined,
  );
  const logFile = $derived(getLogFileFallback(activeRun));
  const ticketId = $derived(activeRun?.ticketId);

  const items = $derived(
    filterCharacterLog(liveStore.feed, { agent, runId }).slice(-1000),
  );

  let autoScroll = $state(true);
  let scrollContainer: HTMLDivElement | undefined = $state();

  function scrollToBottom() {
    autoScroll = true;
    if (scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }

  function handleScroll() {
    if (!scrollContainer) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    autoScroll = distanceToBottom <= 40;
  }

  $effect(() => {
    void items.length;
    if (autoScroll && scrollContainer) {
      void tick().then(() => {
        if (autoScroll && scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      });
    }
  });

  function closeModal() {
    onclose();
    triggerEl?.focus?.();
  }

  $effect(() => {
    return () => {
      triggerEl?.focus?.();
    };
  });

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      closeModal();
    }
  }

  function handleWindowKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
    }
  }

  const agentBadgeClass = $derived.by(() => {
    switch (agent) {
      case 'claude':
        return 'bg-blue-950/80 text-blue-300 border-blue-700/60';
      case 'agy':
        return 'bg-fuchsia-950/80 text-fuchsia-300 border-fuchsia-700/60';
      case 'codex':
        return 'bg-cyan-950/80 text-cyan-300 border-cyan-700/60';
    }
  });
</script>

<svelte:window onkeydown={handleWindowKeyDown} />

<!-- Modal Backdrop -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 select-text"
  role="dialog"
  aria-modal="true"
  aria-labelledby="character-log-title"
  tabindex="-1"
  onclick={handleBackdropClick}
  onkeydown={handleWindowKeyDown}
  data-testid="character-log-modal"
>
  <!-- Modal Window -->
  <div
    class="relative flex flex-col w-full max-w-2xl h-[560px] max-h-[85vh] rounded-lg border border-slate-700 bg-slate-950 shadow-2xl overflow-hidden font-mono text-xs"
    role="document"
  >
    <!-- Modal Header -->
    <div
      class="flex h-12 w-full shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4"
    >
      <div class="flex items-center gap-2 min-w-0">
        <span
          class="rounded px-1.5 py-0.5 text-[10px] font-semibold border {agentBadgeClass}"
          data-testid="character-log-badge"
        >
          [{agent.toUpperCase()}]
        </span>
        <h2
          id="character-log-title"
          class="font-bold text-slate-100 truncate"
          data-testid="character-log-title"
        >
          {metadata.displayName}
          {#if runId}
            <span class="text-slate-400 font-normal text-[11px] ml-1.5">
              • Run: <code class="text-indigo-300 font-mono">{runId}</code>
            </span>
          {:else}
            <span class="text-slate-400 font-normal text-[11px] ml-1.5">
              • Agent-Feed
            </span>
          {/if}
        </h2>
        {#if ticketId}
          <span
            class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 border border-slate-700 shrink-0"
            data-testid="character-log-ticket"
          >
            {ticketId.startsWith('#') ? ticketId : `#${ticketId}`}
          </span>
        {/if}
        {#if activeRun?.status}
          <span
            class="rounded bg-slate-800/80 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-slate-400 border border-slate-700/60 shrink-0"
          >
            {activeRun.status}
          </span>
        {/if}
      </div>

      <!-- Close Button -->
      <button
        type="button"
        onclick={closeModal}
        class="flex h-7 w-7 items-center justify-center rounded border border-slate-700 bg-slate-800/80 text-slate-400 hover:bg-slate-700 hover:text-white transition cursor-pointer text-sm font-bold"
        aria-label="Schließen"
        data-testid="character-log-close"
      >
        ✕
      </button>
    </div>

    <!-- Scrollable Messages Area or Empty / LogFile Notice -->
    <div
      bind:this={scrollContainer}
      onscroll={handleScroll}
      class="flex-1 overflow-y-auto min-h-0 divide-y divide-slate-900/60"
      data-testid="character-log-scroll-area"
    >
      {#if items.length === 0}
        <div
          class="flex flex-col items-center justify-center p-8 text-center text-slate-400 gap-2 h-full"
          data-testid="character-log-empty"
        >
          {#if runId && logFile}
            <span class="text-3xl mb-1">📄</span>
            <p class="text-xs font-semibold text-slate-200">
              Keine Log-Einträge im Feed vorhanden.
            </p>
            <p
              class="text-[11px] text-slate-400 flex flex-col items-center gap-1.5 max-w-md"
            >
              <span>Log-Datei des Runs:</span>
              <code
                class="rounded bg-slate-900 px-2 py-1 font-mono text-indigo-300 border border-slate-800 break-all select-all text-[10px]"
                data-testid="character-log-file"
              >
                {logFile}
              </code>
            </p>
          {:else if runId}
            <span class="text-3xl mb-1">📡</span>
            <p class="text-xs text-slate-400">
              Warte auf Log-Chunks für Run <code class="text-indigo-300"
                >{runId}</code
              >...
            </p>
          {:else}
            <span class="text-3xl mb-1">📡</span>
            <p class="text-xs text-slate-400">
              Keine Feed-Einträge für [{agent.toUpperCase()}].
            </p>
          {/if}
        </div>
      {:else}
        {#each items as item (item)}
          <FeedMessage {item} />
        {/each}
      {/if}
    </div>

    <!-- Auto-Scroll Paused Banner / Resume Button -->
    {#if !autoScroll && items.length > 0}
      <div
        class="border-t border-indigo-900/70 bg-indigo-950/90 px-3 py-1.5 text-center shrink-0"
      >
        <button
          type="button"
          onclick={scrollToBottom}
          class="w-full text-[10px] font-semibold text-indigo-300 hover:text-white transition cursor-pointer flex items-center justify-center gap-1"
          data-testid="resume-autoscroll"
        >
          <span>↓</span>
          <span>Auto-Scroll pausiert (klicken für neueste)</span>
        </button>
      </div>
    {/if}

    <!-- Modal Footer / Info bar if logFile is available while items are shown -->
    {#if runId && logFile && items.length > 0}
      <div
        class="flex items-center justify-between border-t border-slate-800/80 bg-slate-900/50 px-3 py-1 text-[10px] text-slate-500 font-mono shrink-0"
      >
        <span class="truncate"
          >Log-Datei: <code
            class="text-slate-400"
            data-testid="character-log-file">{logFile}</code
          ></span
        >
        <span class="shrink-0 ml-2">{items.length} Chunks</span>
      </div>
    {/if}
  </div>
</div>

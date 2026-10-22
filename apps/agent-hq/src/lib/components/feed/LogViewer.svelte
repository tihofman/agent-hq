<script lang="ts">
  import { tick } from 'svelte';
  import { liveStore } from '../../live.svelte';
  import { filterFeed, getFilterClass, type FeedFilter } from '../../feed';
  import FeedMessage from './FeedMessage.svelte';
  import PendingInputCard from './PendingInputCard.svelte';

  const filters: FeedFilter[] = [
    'ALL',
    'CLAUDE',
    'AGY',
    'CODEX',
    'TEST',
    'GIT',
  ];

  let activeFilter = $state<FeedFilter>('ALL');
  let autoScroll = $state(true);
  let scrollContainer: HTMLDivElement | undefined = $state();

  const visibleItems = $derived(
    filterFeed(liveStore.feed, activeFilter).slice(-1000),
  );

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
    // track changes to visible items
    void visibleItems.length;
    if (autoScroll && scrollContainer) {
      void tick().then(() => {
        if (autoScroll && scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      });
    }
  });

  function getItemKey(item: unknown, index: number): string {
    if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>;
      if ('timestamp' in obj && 'event' in obj) {
        return `${obj.timestamp}-${obj.event}-${index}`;
      }
      if ('type' in obj) {
        return `action-${obj.type}-${index}`;
      }
    }
    return `item-${index}`;
  }
</script>

<div
  class="flex flex-1 flex-col overflow-hidden min-h-0 bg-slate-950 font-mono text-xs"
  data-testid="log-viewer"
>
  <!-- Filter Toolbar -->
  <div
    class="flex flex-wrap items-center gap-1 border-b border-slate-800 bg-slate-900/60 px-2.5 py-1.5 shrink-0"
    data-testid="feed-filters"
  >
    {#each filters as f (f)}
      <button
        type="button"
        onclick={() => (activeFilter = f)}
        class="rounded px-1.5 py-0.5 text-[10px] font-mono transition cursor-pointer border {getFilterClass(
          f,
          activeFilter === f,
        )}"
        data-testid="filter-{f.toLowerCase()}"
      >
        {f === 'ALL' ? 'ALL' : `[${f}]`}
      </button>
    {/each}
  </div>

  <!-- Pending Input Notification (if active) -->
  <PendingInputCard />

  <!-- Scrollable Messages Area -->
  <div
    bind:this={scrollContainer}
    onscroll={handleScroll}
    class="flex-1 overflow-y-auto min-h-0 divide-y divide-slate-900/60"
    data-testid="feed-messages-container"
  >
    {#if visibleItems.length === 0}
      <div
        class="flex flex-col items-center justify-center p-8 text-center text-slate-500"
        data-testid="feed-empty"
      >
        <span class="text-xl mb-1">📡</span>
        <span class="text-xs">
          {activeFilter === 'ALL'
            ? 'Warte auf Events...'
            : `Keine Events für [${activeFilter}]`}
        </span>
      </div>
    {:else}
      {#each visibleItems as item, idx (getItemKey(item, idx))}
        <FeedMessage {item} />
      {/each}
    {/if}
  </div>

  <!-- Auto-Scroll Paused Banner / Resume Button -->
  {#if !autoScroll}
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
</div>

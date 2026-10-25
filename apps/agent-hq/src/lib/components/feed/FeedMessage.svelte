<script lang="ts">
  import type { HQEvent, InternalAction } from '@agent-hq/queue/types';
  import {
    getFeedBadges,
    getFeedMessageText,
    isLogChunk,
    parseSimpleMarkdown,
    formatFeedTimestamp,
    getBadgeClass,
  } from '../../feed';

  let { item }: { item: HQEvent | InternalAction } = $props();

  const badges = $derived(item ? getFeedBadges(item) : []);
  const text = $derived(item ? getFeedMessageText(item) : '');
  const isLog = $derived(item ? isLogChunk(item) : false);
  const timestamp = $derived(
    item && 'timestamp' in item ? formatFeedTimestamp(item.timestamp) : '',
  );
  const segments = $derived(parseSimpleMarkdown(text));
</script>

{#if item}
  <div
    class="flex flex-col gap-0.5 px-3 py-1.5 border-b border-slate-900/80 hover:bg-slate-900/40 font-mono text-xs transition select-text"
    data-testid="feed-message"
  >
    <div class="flex items-center gap-1.5 text-[10px] select-none">
      {#if timestamp}
        <span class="text-slate-500 font-mono">{timestamp}</span>
      {/if}
      {#each badges as badge (badge)}
        <span
          class="rounded px-1 py-0.5 text-[9px] font-semibold border {getBadgeClass(
            badge,
          )}"
          data-testid="badge-{badge.toLowerCase()}"
        >
          [{badge}]
        </span>
      {/each}
    </div>

    <div
      class="text-[11px] {isLog
        ? 'font-mono whitespace-pre-wrap break-all text-slate-300 leading-tight'
        : 'text-slate-200 break-words'}"
    >
      {#each segments as seg, idx (idx)}
        {#if seg.type === 'bold'}
          <strong class="font-bold text-white">{seg.content}</strong>
        {:else if seg.type === 'code'}
          <code
            class="rounded bg-slate-800 px-1 py-0.5 font-mono text-amber-300 border border-slate-700/60"
            >{seg.content}</code
          >
        {:else}
          <span>{seg.content}</span>
        {/if}
      {/each}
    </div>
  </div>
{/if}

<script lang="ts">
  import { liveStore } from '../../live.svelte';
  import { detectPendingInput, type PendingInputInfo } from '../../feed';

  let info = $state<PendingInputInfo>({ isPending: false });
  let timer: ReturnType<typeof setTimeout> | undefined;

  function evaluate() {
    clearTimeout(timer);
    const result = detectPendingInput(
      liveStore.feed,
      liveStore.state.runs,
      Date.now(),
    );
    info = result;

    if (
      !result.isPending &&
      result.remainingMs !== undefined &&
      result.remainingMs > 0
    ) {
      timer = setTimeout(() => {
        evaluate();
      }, result.remainingMs + 50);
    }
  }

  $effect(() => {
    // React to changes in feed and runs
    void liveStore.feed.length;
    void Object.keys(liveStore.state.runs).length;
    const lastItem = liveStore.feed[liveStore.feed.length - 1];
    if (lastItem && 'data' in lastItem) {
      void lastItem.data?.logChunk;
    }

    evaluate();

    return () => {
      clearTimeout(timer);
    };
  });
</script>

{#if info.isPending}
  <div
    class="mx-2 my-2 rounded border border-amber-500/80 bg-amber-950/80 p-2.5 text-amber-200 shadow-md select-none animate-pulse shrink-0"
    data-testid="pending-input-card"
    role="alert"
  >
    <div class="flex items-center gap-2 font-bold text-amber-300 text-xs">
      <span class="text-sm">⚠️</span>
      <span>Agent wartet auf Eingabe → Terminal</span>
    </div>
    {#if info.promptText}
      <div
        class="mt-1.5 truncate rounded bg-amber-900/40 px-2 py-1 font-mono text-[10px] text-amber-100/90 border border-amber-700/50"
        title={info.promptText}
      >
        {info.promptText}
      </div>
    {/if}
  </div>
{/if}

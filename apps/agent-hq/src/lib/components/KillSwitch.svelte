<script lang="ts">
  let { runId }: { runId: string | null } = $props();
  let pending = $state(false);
  let error = $state('');

  async function kill() {
    if (!runId || pending || !window.confirm('Laufenden Worker stoppen?'))
      return;
    pending = true;
    error = '';
    try {
      const response = await fetch('/api/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
      if (!response.ok) throw new Error('Worker konnte nicht gestoppt werden.');
    } catch {
      error = 'Worker konnte nicht gestoppt werden.';
    } finally {
      pending = false;
    }
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape' && !event.repeat) void kill();
  }}
/>
<button
  type="button"
  onclick={kill}
  disabled={!runId || pending}
  class="flex items-center gap-1.5 rounded border border-red-500/80 bg-red-600/90 px-3 py-1 font-semibold text-white hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
  title="Notfall-Stopp: Laufenden Worker beenden (Esc)"
  data-testid="kill-switch">🚨 {pending ? 'STOPPING...' : 'KILL SWITCH'}</button
>
{#if error}<span role="alert">{error}</span>{/if}

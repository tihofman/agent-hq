<script lang="ts">
  let { runId }: { runId: string | null } = $props();
  let pending = $state(false);
  let error = $state('');
  let message = $state('');
  let dialog: HTMLDialogElement;
  let selectedRunId = $state<string | null>(null);

  function confirmKill() {
    if (!runId || pending || dialog.open) return;
    selectedRunId = runId;
    message = '';
    error = '';
    dialog.showModal();
  }

  async function kill() {
    if (!selectedRunId || pending) return;
    pending = true;
    error = '';
    try {
      const response = await fetch('/api/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: selectedRunId, message }),
      });
      if (!response.ok) throw new Error('Worker konnte nicht gestoppt werden.');
      dialog.close();
    } catch {
      error = 'Worker konnte nicht gestoppt werden.';
    } finally {
      pending = false;
    }
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (
      event.target instanceof HTMLElement &&
      (event.target.matches('input, textarea') ||
        event.target.isContentEditable)
    )
      return;
    if (event.key === 'Escape' && !event.repeat) confirmKill();
  }}
/>
<button
  type="button"
  onclick={confirmKill}
  disabled={!runId || pending}
  class="flex items-center gap-1.5 rounded border border-red-500/80 bg-red-600/90 px-3 py-1 font-semibold text-white hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
  title="Notfall-Stopp: Laufenden Worker beenden (Esc)"
  data-testid="kill-switch">🚨 {pending ? 'STOPPING...' : 'KILL SWITCH'}</button
>
{#if error}<span role="alert" class="text-xs text-red-400">{error}</span>{/if}

<dialog
  bind:this={dialog}
  class="m-auto w-full max-w-md rounded border border-red-500/80 bg-slate-900 p-5 text-white backdrop:bg-black/60"
  aria-labelledby="kill-title"
>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void kill();
    }}
    class="flex flex-col gap-4"
  >
    <h2 id="kill-title" class="font-semibold">Laufenden Worker stoppen?</h2>
    <label class="flex flex-col gap-2 text-sm">
      Anweisung für Fortsetzung
      <textarea
        bind:value={message}
        maxlength={4000}
        rows={4}
        disabled={pending}
        class="rounded border border-slate-600 bg-slate-950 p-2"
        placeholder="Optional: Worker mit dieser Korrektur fortsetzen"
      ></textarea>
    </label>
    <div class="flex justify-end gap-3">
      <button type="button" disabled={pending} onclick={() => dialog.close()}
        >Abbrechen</button
      >
      <button
        type="submit"
        disabled={pending}
        class="rounded bg-red-600 px-3 py-2 font-semibold"
      >
        {pending
          ? 'Wird gestoppt…'
          : message.trim()
            ? 'Stoppen & fortsetzen'
            : 'Stoppen'}
      </button>
    </div>
  </form>
</dialog>

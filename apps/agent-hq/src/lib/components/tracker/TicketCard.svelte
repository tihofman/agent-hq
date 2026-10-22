<script lang="ts">
  import { liveStore } from '../../live.svelte';
  import type { HQEvent, InternalAction } from '../../server/state';
  import type { TicketData } from '../../server/ticket';
  import { getCurrentRun, hasReloadEvent } from './run';

  let ticket = $state<TicketData | null>(null);
  let error = $state<string | null>(null);

  const currentRun = $derived(getCurrentRun(liveStore.state.runs));
  const activePR = $derived(liveStore.state.activePR);

  let lastRunId: string | undefined = undefined;
  let lastTicketId: string | undefined = undefined;
  let lastSeenEvent: HQEvent | InternalAction | undefined = undefined;
  let abortController: AbortController | null = null;

  async function loadTicket(runId: string) {
    abortController?.abort();
    abortController = new AbortController();
    const { signal } = abortController;

    try {
      const res = await fetch(
        `/api/ticket?runId=${encodeURIComponent(runId)}`,
        {
          signal,
        },
      );
      if (signal.aborted) return;

      if (res.ok) {
        ticket = (await res.json()) as TicketData;
        error = null;
      } else if (res.status === 404) {
        ticket = null;
        error = 'Ticket nicht gefunden';
      } else {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        ticket = null;
        error = body.error || 'GitHub CLI (gh) nicht verfügbar';
      }
    } catch {
      if (signal.aborted) return;
      ticket = null;
      error = 'Netzwerkfehler beim Laden des Tickets';
    }
  }

  $effect(() => {
    const run = currentRun;
    const feed = liveStore.feed;
    const runId = run?.runId;
    const ticketId = run?.ticketId;

    let shouldReload = false;

    const runChanged = runId !== lastRunId || ticketId !== lastTicketId;
    if (runChanged) {
      lastRunId = runId;
      lastTicketId = ticketId;
      if (runId && ticketId) {
        shouldReload = true;
      }
    }

    if (feed.length === 0) {
      lastSeenEvent = undefined;
    } else {
      if (hasReloadEvent(feed, lastSeenEvent)) {
        shouldReload = true;
      }
      lastSeenEvent = feed.at(-1);
    }

    if (!runId || !ticketId) {
      abortController?.abort();
      ticket = null;
      error = null;
      return;
    }

    if (shouldReload) {
      void loadTicket(runId);
    }
  });

  const doneCount = $derived(
    ticket?.criteria.filter((c) => c.done).length ?? 0,
  );
  const totalCount = $derived(ticket?.criteria.length ?? 0);
</script>

{#snippet prStatusBadges()}
  {#if activePR?.status}
    <div class="flex items-center gap-2 font-mono">
      <div
        class="flex items-center gap-1 rounded bg-slate-900 border border-slate-800 px-2 py-0.5 text-[10px]"
        data-testid="pr-badge"
      >
        {#if activePR.prNumber}
          <span class="text-slate-400 font-semibold mr-0.5"
            >#{activePR.prNumber}</span
          >
        {/if}
        <span
          class={activePR.status === 'draft'
            ? 'text-amber-400 font-bold'
            : 'text-slate-500'}>Draft</span
        >
        <span class="text-slate-600">→</span>
        <span
          class={activePR.status === 'ready' || activePR.status === 'reviewing'
            ? activePR.status === 'reviewing'
              ? 'text-indigo-400 font-bold'
              : 'text-blue-400 font-bold'
            : 'text-slate-500'}
        >
          {activePR.status === 'reviewing' ? 'Review' : 'Ready'}
        </span>
        <span class="text-slate-600">→</span>
        <span
          class={activePR.status === 'merged'
            ? 'text-purple-400 font-bold'
            : 'text-slate-500'}>Merged</span
        >
      </div>
      {#if activePR?.ci}
        <span
          class="rounded px-1.5 py-0.5 text-[10px] font-mono font-bold border {activePR.ci ===
          'pass'
            ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
            : 'bg-rose-950 text-rose-400 border-rose-800'}"
          data-testid="ci-badge"
          data-ci={activePR.ci}
        >
          {activePR.ci === 'pass' ? 'CI_CHECK_PASS' : 'CI_CHECK_FAIL'}
        </span>
      {/if}
    </div>
  {/if}
{/snippet}

<div
  class="flex flex-1 min-h-0 w-full overflow-hidden"
  data-testid="ticket-card"
>
  {#if error}
    <div
      class="flex flex-1 items-center justify-between px-4 py-2 text-xs"
      data-testid="ticket-card-error"
    >
      <div
        class="flex items-center gap-2 rounded bg-amber-950/40 border border-amber-800/60 px-3 py-1.5 text-amber-300 font-sans"
      >
        <span class="text-sm">⚠️</span>
        <span>Hinweis: {error}</span>
      </div>
      {@render prStatusBadges()}
    </div>
  {:else if !ticket}
    <div
      class="flex flex-1 items-center justify-center px-4 font-sans text-xs text-slate-500"
      data-testid="ticket-card-empty"
    >
      <div class="flex items-center gap-2">
        <span>📋</span>
        <span>Kein aktives Ticket ausgewählt</span>
      </div>
    </div>
  {:else}
    <div
      class="flex flex-1 min-h-0 w-full items-stretch px-4 py-2 gap-4"
      data-testid="ticket-card-content"
    >
      <!-- Left Column: Ticket Info & Badges -->
      <div
        class="flex w-96 shrink-0 flex-col justify-center gap-1.5 border-r border-slate-800/80 pr-4"
      >
        <!-- Row 1: Number & Title -->
        <div class="flex items-center gap-2 min-w-0">
          <span
            class="rounded bg-indigo-950 px-2 py-0.5 text-xs font-bold text-indigo-300 border border-indigo-800/80 shrink-0 font-mono"
            data-testid="ticket-number"
          >
            #{ticket.number}
          </span>
          <span
            class="truncate font-sans text-xs font-semibold text-slate-100"
            title={ticket.title}
            data-testid="ticket-title"
          >
            {ticket.title}
          </span>
        </div>

        <!-- Row 2: Counter, PR Badge, CI Status -->
        <div class="flex flex-wrap items-center gap-2 font-mono">
          <!-- Criteria Counter -->
          <span
            class="rounded bg-slate-900 border border-slate-800 px-2 py-0.5 text-[11px] font-medium text-emerald-400"
            data-testid="criteria-counter"
          >
            {doneCount} / {totalCount}
          </span>

          {@render prStatusBadges()}
        </div>
      </div>

      <!-- Right Column: Criteria Checklist -->
      <div
        class="flex flex-1 min-h-0 flex-col overflow-y-auto pl-2 font-sans text-xs"
        data-testid="criteria-list"
      >
        {#if ticket.criteria.length === 0}
          <div class="m-auto text-slate-500 italic text-[11px]">
            Keine Akzeptanzkriterien im Ticket definiert
          </div>
        {:else}
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-x-4 gap-y-1.5 py-0.5">
            {#each ticket.criteria as item, i (i)}
              <div
                class="flex items-start gap-2 min-w-0"
                data-testid="criterion-item"
              >
                <span
                  class="shrink-0 text-sm leading-none select-none {item.done
                    ? 'text-emerald-400 font-bold'
                    : 'text-slate-600'}"
                  aria-hidden="true"
                >
                  {item.done ? '☑' : '☐'}
                </span>
                <span
                  class="text-[11px] leading-tight truncate {item.done
                    ? 'text-slate-400 line-through'
                    : 'text-slate-200'}"
                  title={item.text}
                >
                  {#each item.text.split('`') as part, j (j)}
                    {#if j % 2}
                      <code>{part}</code>
                    {:else}
                      {part}
                    {/if}
                  {/each}
                </span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { liveStore } from '../../live.svelte';
  import type { QuestionPayload } from '@agent-hq/queue';
  import { getSpriteMetadata, TEAM_LEADS } from '../../office/sprites';
  import { TEAM_LABELS } from '../../office/layout';
  import {
    getGitHubIssueUrl,
    sendQuestionAnswer,
  } from '../../office/question-modal';
  import { focusTrap } from '../focus-trap';

  interface Props {
    question: QuestionPayload;
    triggerEl?: HTMLElement | null;
    onclose: () => void;
  }

  let { question, triggerEl, onclose }: Props = $props();

  const teamLeadAgent = $derived(TEAM_LEADS[question.team]);
  const metadata = $derived(getSpriteMetadata(teamLeadAgent));
  const teamLabel = $derived(TEAM_LABELS[question.team] ?? question.team);

  const matchingRun = $derived(
    Object.values(liveStore.state?.runs ?? {}).find(
      (r) =>
        r.ticketId === String(question.issueId) ||
        r.ticketId === `#${question.issueId}` ||
        r.data?.issueId === question.issueId,
    ),
  );

  const matchingEvent = $derived(
    liveStore.feed.find(
      (e) =>
        'data' in e &&
        e.data?.issueId === question.issueId &&
        Boolean(e.data?.title),
    ),
  );

  const issueTitle = $derived(
    matchingRun?.data?.title ??
      (matchingEvent && 'data' in matchingEvent
        ? matchingEvent.data.title
        : '') ??
      '',
  );
  const issueUrl = $derived(getGitHubIssueUrl(question.issueId));

  let freeText = $state('');
  let isSubmitting = $state(false);
  let errorMessage = $state<string | null>(null);

  let closeButton: HTMLButtonElement | undefined = $state();
  let optionButtons: HTMLButtonElement[] = $state([]);
  let textInput: HTMLInputElement | undefined = $state();

  function closeModal() {
    onclose();
  }

  async function handleAnswer(answerText: string) {
    const trimmed = answerText.trim();
    if (!trimmed || isSubmitting) return;

    isSubmitting = true;
    errorMessage = null;

    const res = await sendQuestionAnswer(question.id, trimmed);
    if (res.ok) {
      closeModal();
    } else {
      errorMessage = res.error || 'Fehler beim Absenden der Antwort';
      isSubmitting = false;
    }
  }

  function handleFormSubmit(event: SubmitEvent) {
    event.preventDefault();
    void handleAnswer(freeText);
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      closeModal();
    }
  }

  // Reactive auto-close if the question is resolved via SSE (e.g. from elsewhere or server)
  $effect(() => {
    const openQuestions = liveStore.state?.questions ?? {};
    if (
      !openQuestions[question.id] ||
      openQuestions[question.id]?.status !== 'PENDING'
    ) {
      closeModal();
    }
  });

  onMount(() => {
    void tick().then(() => {
      if (optionButtons[0]) {
        optionButtons[0].focus();
      } else if (textInput) {
        textInput.focus();
      } else {
        closeButton?.focus();
      }
    });
  });

  $effect(() => {
    return () => {
      triggerEl?.focus?.();
    };
  });

  const teamBadgeClass = $derived.by(() => {
    switch (question.team) {
      case 'frontend':
        return 'bg-sky-950/80 text-sky-300 border-sky-700/60';
      case 'backend':
        return 'bg-orange-950/80 text-orange-300 border-orange-700/60';
      case 'qa':
        return 'bg-purple-950/80 text-purple-300 border-purple-700/60';
    }
  });
</script>

<!-- Modal Backdrop -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 select-text"
  role="dialog"
  aria-modal="true"
  aria-labelledby="question-modal-title"
  tabindex="-1"
  onclick={handleBackdropClick}
  data-testid="question-modal"
>
  <!-- Modal Window -->
  <div
    use:focusTrap={closeModal}
    class="relative flex flex-col w-full max-w-lg rounded-lg border border-slate-700 bg-slate-950 shadow-2xl overflow-hidden font-mono text-xs"
  >
    <!-- Modal Header -->
    <div
      class="flex h-12 w-full shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4"
    >
      <div class="flex items-center gap-2 min-w-0">
        <span
          class="rounded px-1.5 py-0.5 text-[10px] font-semibold border {teamBadgeClass}"
          data-testid="question-team-badge"
        >
          [{teamLabel.toUpperCase()}]
        </span>
        <h2
          id="question-modal-title"
          class="font-bold text-slate-100 truncate"
          data-testid="question-modal-title"
        >
          Rückfrage: {metadata.displayName}
        </h2>
      </div>

      <!-- Close Button -->
      <button
        type="button"
        bind:this={closeButton}
        onclick={closeModal}
        class="flex h-7 w-7 items-center justify-center rounded border border-slate-700 bg-slate-800/80 text-slate-400 hover:bg-slate-700 hover:text-white transition cursor-pointer text-sm font-bold"
        aria-label="Schließen"
        data-testid="question-modal-close"
      >
        ✕
      </button>
    </div>

    <!-- Modal Content -->
    <div class="flex flex-col p-4 gap-4 overflow-y-auto max-h-[75vh]">
      <!-- Issue Context Card -->
      <div
        class="flex items-center justify-between rounded border border-slate-800 bg-slate-900/60 p-2.5 text-xs"
      >
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-slate-400 font-semibold shrink-0">Issue:</span>
          {#if issueUrl}
            <a
              href={issueUrl}
              target="_blank"
              rel="external noopener noreferrer"
              class="text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1 font-semibold truncate"
              data-testid="question-issue-link"
              title="GitHub-Issue in neuem Tab öffnen"
            >
              <span>#{question.issueId}</span>
              {#if issueTitle}
                <span class="text-slate-300 font-normal truncate">• {issueTitle}</span>
              {/if}
              <span class="text-slate-500 text-[10px]">↗</span>
            </a>
          {:else}
            <span
              class="text-slate-300 font-semibold flex items-center gap-1 truncate"
              data-testid="question-issue-text"
            >
              <span>#{question.issueId}</span>
              {#if issueTitle}
                <span class="text-slate-400 font-normal truncate">• {issueTitle}</span>
              {/if}
            </span>
          {/if}
        </div>
        <span class="text-[11px] text-slate-400 shrink-0 ml-2">
          {metadata.displayName} ({metadata.role})
        </span>
      </div>

      <!-- Question Text Display -->
      <div
        class="rounded border border-amber-500/40 bg-amber-950/30 p-3 text-amber-200 flex flex-col gap-1.5"
        data-testid="question-text-card"
      >
        <span class="text-[10px] uppercase tracking-wider text-amber-400/80 font-bold">
          Frage vom TeamLead:
        </span>
        <p
          class="text-xs text-amber-100 font-medium leading-relaxed whitespace-pre-wrap"
          data-testid="question-text"
        >
          {question.question}
        </p>
      </div>

      <!-- Options (if provided) -->
      {#if question.options && question.options.length > 0}
        <div class="flex flex-col gap-2">
          <span class="text-[11px] font-semibold text-slate-400">
            Optionen (Klick zum Antworten):
          </span>
          <div class="flex flex-wrap gap-2" data-testid="question-options">
            {#each question.options as option, idx (idx)}
              <button
                type="button"
                bind:this={optionButtons[idx]}
                disabled={isSubmitting}
                onclick={() => handleAnswer(option)}
                class="rounded border border-indigo-500/60 bg-indigo-950/60 hover:bg-indigo-900/80 hover:border-indigo-400 text-indigo-200 px-3 py-1.5 font-mono text-xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="question-option-{idx}"
              >
                {option}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Free Text Input Form -->
      <form onsubmit={handleFormSubmit} class="flex flex-col gap-2">
        <label
          for="question-free-text"
          class="text-[11px] font-semibold text-slate-400"
        >
          Freitext-Antwort:
        </label>
        <div class="flex items-center gap-2">
          <input
            id="question-free-text"
            bind:this={textInput}
            type="text"
            bind:value={freeText}
            maxlength={5000}
            placeholder="Eigene Antwort eingeben..."
            disabled={isSubmitting}
            class="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-xs text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            data-testid="question-input"
          />
          <button
            type="submit"
            disabled={isSubmitting || !freeText.trim()}
            class="rounded border border-emerald-600/80 bg-emerald-950/80 hover:bg-emerald-900 text-emerald-200 px-3 py-1.5 font-mono text-xs font-bold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            data-testid="question-submit"
          >
            {isSubmitting ? 'Sendet...' : 'Absenden'}
          </button>
        </div>
      </form>

      <!-- Error Message Banner -->
      {#if errorMessage}
        <div
          class="rounded border border-rose-600/80 bg-rose-950/80 p-2.5 text-rose-200 flex items-center gap-2 shrink-0"
          role="alert"
          data-testid="question-error"
        >
          <span class="text-sm">⚠️</span>
          <span class="text-xs">{errorMessage}</span>
        </div>
      {/if}
    </div>
  </div>
</div>

<script lang="ts">
  import { onMount } from 'svelte';
  import { liveStore } from '../../live.svelte';
  import type { Agent, HQEvent, Run } from '../../server/state';
  import {
    getSpriteMetadata,
    getFrameIndex,
    getFrameBackgroundPosition,
    getSpeechBubble,
    slotIndexFor,
    AgentController,
    type AnimationName,
    type CharacterStatus,
  } from '../../office/sprites';
  import { formatCharacterAriaLabel } from '../../office/log-filter';
  import { getOldestPendingQuestionForTeam } from '../../office/question-modal';
  import {
    CANVAS_BASE_SCALE,
    TEAM_DESKS,
    TEAM_LABELS,
    type RoomId,
    type Team,
  } from '../../office/layout';

  const overlayScale = 1 / CANVAS_BASE_SCALE;

  interface Props {
    agent: Agent;
    runId?: string;
    instanceIndex?: number;
    slotIndex?: number;
    team?: Team;
    isTeamLead?: boolean;
    onclick?: (event: MouseEvent) => void;
  }

  let {
    agent,
    runId,
    instanceIndex = 0,
    slotIndex,
    team,
    isTeamLead = false,
    onclick,
  }: Props = $props();

  // The feed also carries InternalActions (no event/runId), so narrow to HQEvents.
  function findLastHandover(): HQEvent | undefined {
    return liveStore.feed.findLast(
      (e): e is HQEvent => 'event' in e && e.event === 'TASK_HANDOVER',
    );
  }

  function handoverKeyOf(e: HQEvent): string {
    return `${e.agent}-${e.runId ?? e.timestamp}`;
  }

  const metadata = $derived(getSpriteMetadata(agent));

  const agentState = $derived(
    liveStore.state?.agents?.[agent] ?? { status: 'idle', room: 'lounge' },
  );

  const teamState = $derived(team ? liveStore.state?.teams?.[team] : undefined);

  const activeRun = $derived(
    runId
      ? liveStore.state?.runs?.[runId]
      : agentState.runId
        ? liveStore.state?.runs?.[agentState.runId]
        : undefined,
  );

  const runRepo = $derived(activeRun?.repo ?? activeRun?.data?.repo);

  const activeTeamRun = $derived(
    team
      ? Object.values(liveStore.state?.runs ?? {}).find(
          (r) =>
            r.data?.team === team &&
            (r.status === 'running' || r.status === 'handover'),
        )
      : undefined,
  );

  const pendingQuestion = $derived(
    team
      ? getOldestPendingQuestionForTeam(
          liveStore.state?.questions,
          team,
          liveStore.feed,
        )
      : undefined,
  );

  const characterStatus = $derived.by<CharacterStatus>(() => {
    if (isTeamLead && team) {
      if (teamState?.status === 'waiting_input' || Boolean(pendingQuestion))
        return 'waiting_input';
      if (teamState?.status === 'working' || activeTeamRun) {
        return team === 'qa' ? 'reviewing' : 'coding';
      }
      return 'idle';
    }
    if (runId) {
      if (!activeRun) return 'idle';
      if (activeRun.status === 'cooldown') return 'cooldown';
      if (activeRun.status === 'handover') return 'handover';
      if (activeRun.status === 'running') {
        if (
          runId === agentState.runId &&
          (agentState.status === 'testing' ||
            agentState.status === 'reviewing' ||
            agentState.status === 'coding')
        ) {
          return agentState.status;
        }
        return activeRun.room === 'qa' ? 'reviewing' : 'coding';
      }
      if (activeRun.status === 'failed') return 'errorAlert';
      return 'idle';
    }
    return agentState.status;
  });

  function resolveRoom(run?: Run): RoomId {
    if (isTeamLead && team) {
      return TEAM_DESKS[team].roomId;
    }
    if (run) {
      if (run.data?.team && TEAM_DESKS[run.data.team]) {
        if (run.status === 'handover') return 'hall';
        if (run.status === 'cooldown') return 'lounge';
        return TEAM_DESKS[run.data.team].roomId;
      }
      return (
        (run.room as RoomId) ??
        (run.runId === agentState.runId
          ? (agentState.room as RoomId)
          : undefined) ??
        (run.status === 'handover'
          ? 'hall'
          : run.status === 'cooldown'
            ? 'lounge'
            : 'dev')
      );
    }
    return (agentState.room as RoomId) ?? 'lounge';
  }

  const characterRoom = $derived(resolveRoom(activeRun));

  const activePR = $derived(liveStore.state?.activePR);
  const ticketId = $derived(activeRun?.ticketId);
  const title = $derived(activeRun?.data?.title);
  const teamLabel = $derived(
    isTeamLead && team ? TEAM_LABELS[team] : undefined,
  );
  const ariaLabel = $derived(
    teamLabel
      ? `${teamLabel} (${metadata.displayName})`
      : formatCharacterAriaLabel(metadata.displayName, ticketId),
  );
  const prNumber = $derived(activeRun?.data?.prNumber ?? activePR?.prNumber);

  const cooldownUntil = $derived(
    activeRun?.data?.cooldownUntil ?? agentState.cooldownUntil,
  );

  const statusText = $derived(activeRun?.data?.statusText);

  // Synchronous initial position
  const initialRoom: RoomId = resolveRoom(
    runId ? liveStore.state?.runs?.[runId] : undefined,
  );

  const controller = new AgentController(
    agent,
    initialRoom,
    instanceIndex,
    team,
    isTeamLead,
    slotIndex,
  );

  let currentX = $state(controller.x);
  let currentY = $state(controller.y);
  let currentFrame = $state(0);
  let activeAnimName = $state<AnimationName>('idle');
  let now = $state(Date.now()); // Reactive cooldown timer (Item 2)

  let animElapsedMs = 0;
  let lastNowUpdate = 0;
  let lastHandledHandoverKey: string | null = null;
  let hasHandoverTriggered = false;
  const knownWorkerRuns: Record<string, string | undefined> = {};

  $effect(() => {
    if (controller.instanceIndex !== instanceIndex) {
      controller.instanceIndex = instanceIndex;
    }
    const nextSlotIndex =
      slotIndex ?? slotIndexFor({ agent, instanceIndex, team, isTeamLead });
    if (controller.slotIndex !== nextSlotIndex) {
      controller.slotIndex = nextSlotIndex;
    }

    const targetRoom = characterRoom;
    if (isTeamLead) {
      controller.snapToRoom(targetRoom);
      return;
    }

    const feedLen = liveStore.feed.length; // Ensure reactive tracking on feed updates

    if (feedLen === 0) {
      controller.snapToRoom(targetRoom);
      return;
    }

    const lastHandoverEvent = findLastHandover();
    const handoverKey = lastHandoverEvent
      ? handoverKeyOf(lastHandoverEvent)
      : null;

    let triggerHandover = false;

    if (agent === 'claude') {
      if (handoverKey && handoverKey !== lastHandledHandoverKey) {
        lastHandledHandoverKey = handoverKey;
        triggerHandover = true;
      } else {
        for (const w of ['agy', 'codex'] as const) {
          const wRun = liveStore.state?.agents?.[w]?.runId;
          if (wRun && wRun !== knownWorkerRuns[w]) {
            knownWorkerRuns[w] = wRun;
            triggerHandover = true;
            break;
          }
        }
      }
    } else {
      if (
        lastHandoverEvent &&
        lastHandoverEvent.agent === agent &&
        (!runId ||
          !lastHandoverEvent.runId ||
          lastHandoverEvent.runId === runId) &&
        handoverKey !== lastHandledHandoverKey
      ) {
        lastHandledHandoverKey = handoverKey;
        triggerHandover = true;
      } else if (
        runId
          ? activeRun?.status === 'handover' && !hasHandoverTriggered
          : agentState.runId && agentState.runId !== knownWorkerRuns[agent]
      ) {
        if (runId) {
          hasHandoverTriggered = true;
        } else {
          knownWorkerRuns[agent] = agentState.runId;
        }
        triggerHandover = true;
      }
    }

    if (triggerHandover) {
      controller.startHandover();
    } else {
      controller.setTargetRoom(targetRoom);
    }
  });

  const bubble = $derived(
    getSpeechBubble(characterStatus, {
      ticketId: isTeamLead
        ? pendingQuestion
          ? String(pendingQuestion.issueId)
          : activeTeamRun?.ticketId
        : ticketId,
      title: isTeamLead
        ? pendingQuestion
          ? pendingQuestion.question
          : (activeTeamRun?.data?.title ?? 'Working…')
        : title,
      prNumber,
      statusText: isTeamLead
        ? pendingQuestion
          ? pendingQuestion.question
          : activeTeamRun?.data?.statusText
        : statusText,
      cooldownUntil,
      now,
    }),
  );

  function tick(dt: number) {
    const res = controller.tick(dt, characterStatus, characterRoom);
    currentX = res.x;
    currentY = res.y;

    if (res.animation !== activeAnimName) {
      activeAnimName = res.animation;
      animElapsedMs = 0;
    } else {
      animElapsedMs += dt * 1000;
    }

    const animMeta =
      metadata.animations[activeAnimName] ?? metadata.animations.idle;
    currentFrame = getFrameIndex(animMeta, animElapsedMs);
  }

  onMount(() => {
    const lastHandoverEvent = findLastHandover();
    if (lastHandoverEvent) {
      lastHandledHandoverKey = handoverKeyOf(lastHandoverEvent);
    }
    for (const w of ['agy', 'codex'] as const) {
      knownWorkerRuns[w] = liveStore.state?.agents?.[w]?.runId;
    }

    if (
      typeof window === 'undefined' ||
      typeof requestAnimationFrame === 'undefined'
    ) {
      return;
    }

    let animFrameId: number;
    let lastTime = performance.now();

    const loop = (timestamp: number) => {
      const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
      lastTime = timestamp;

      // Update `now` at most 1x/s in rAF loop (Item 2)
      if (timestamp - lastNowUpdate >= 1000) {
        now = Date.now();
        lastNowUpdate = timestamp;
      }

      tick(dt);
      animFrameId = requestAnimationFrame(loop);
    };

    animFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameId);
  });

  const bgPos = $derived(getFrameBackgroundPosition(currentFrame, metadata));
</script>

<button
  type="button"
  class="character-container agent-{agent} absolute"
  style="
    left: {Math.round(currentX)}px;
    top: {Math.round(currentY)}px;
    width: {metadata.frameWidth}px;
    height: {metadata.frameHeight}px;
    z-index: {Math.round(currentY) + 20};
    --overlay-scale: {overlayScale};
  "
  data-testid="character-sprite-{agent}"
  data-agent={agent}
  data-team-lead={isTeamLead && team ? team : undefined}
  data-team={team}
  data-is-team-lead={isTeamLead ? 'true' : undefined}
  data-run-id={runId}
  data-repo={runRepo}
  data-instance-index={instanceIndex}
  aria-label={ariaLabel}
  title="{teamLabel
    ? `${teamLabel} • `
    : ''}{metadata.displayName} ({metadata.role}) • {characterStatus}{runRepo ? ` • [${runRepo}]` : ''}"
  {onclick}
>
  <!-- Retro Status Speech Bubble -->
  {#if bubble}
    <span
      class="speech-bubble bubble-{bubble.type}"
      class:question-bubble={characterStatus === 'waiting_input' ||
        bubble.text === '?'}
      style="transform: translateX(-50%) scale({overlayScale}); transform-origin: bottom center;"
      data-testid="speech-bubble-{agent}"
      data-run-id={runId}
      title="{bubble.tooltip ?? bubble.text}{runRepo ? ` • ${runRepo}` : ''}"
    >
      {#if bubble.icon}
        <span
          class="bubble-icon"
          class:gear-icon={bubble.type === 'testing'}
          class:question-icon={characterStatus === 'waiting_input' ||
            bubble.text === '?'}
          >{bubble.icon}</span
        >
      {/if}
      <span class="bubble-text">{bubble.text}</span>
    </span>
  {/if}

  <!-- Pixel Sprite -->
  <div
    class="pixel-sprite sprite-{agent}"
    style="{bgPos.css} width: {metadata.frameWidth}px; height: {metadata.frameHeight}px; background-size: {metadata.columns *
      metadata.frameWidth}px {metadata.rows * metadata.frameHeight}px;"
  ></div>

  <!-- Agent Retro Nametag Badge -->
  <span
    class="agent-badge"
    style="transform: translateX(-50%) scale({overlayScale}); transform-origin: bottom center;"
  >
    {#if teamLabel}
      {teamLabel}
    {:else}
      {metadata.displayName}
    {/if}
  </span>
</button>

<style>
  .character-container {
    image-rendering: pixelated;
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    text-align: left;
    outline: none;
  }

  .character-container:focus-visible {
    outline: calc(2px * var(--overlay-scale, 1)) solid #818cf8;
    outline-offset: calc(2px * var(--overlay-scale, 1));
    border-radius: calc(4px * var(--overlay-scale, 1));
  }

  .agent-claude {
    --agent-color: #f97316;
  }
  .agent-agy {
    --agent-color: #38bdf8;
  }
  .agent-codex {
    --agent-color: #a855f7;
  }

  .pixel-sprite {
    background-repeat: no-repeat;
  }

  .sprite-claude {
    background-image: url('../../assets/sprites/claude.png');
  }
  .sprite-agy {
    background-image: url('../../assets/sprites/agy.png');
  }
  .sprite-codex {
    background-image: url('../../assets/sprites/codex.png');
  }

  /* 16-Bit Retro Speech Bubble */
  .speech-bubble {
    position: absolute;
    bottom: calc(100% + 3px * var(--overlay-scale, 1));
    left: 50%;
    transform: translateX(-50%) scale(var(--overlay-scale, 1));
    transform-origin: bottom center;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 2px 6px;
    font-family: monospace;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.1;
    white-space: nowrap;
    border-radius: 3px;
    box-shadow: 2px 2px 0px rgba(0, 0, 0, 0.8);
    pointer-events: auto;
    cursor: default;
    z-index: 35;
    animation: bubble-bob 2s ease-in-out infinite;
    background-color: var(--bubble-bg);
    border: 1px solid var(--bubble-border);
    color: var(--bubble-text);
  }

  .speech-bubble::after {
    content: '';
    position: absolute;
    bottom: -4px;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 4px solid var(--bubble-border);
  }

  .bubble-testing {
    --bubble-bg: #451a03;
    --bubble-border: #f59e0b;
    --bubble-text: #fef3c7;
  }
  .bubble-review {
    --bubble-bg: #1e1b4b;
    --bubble-border: #818cf8;
    --bubble-text: #e0e7ff;
  }
  .bubble-alert {
    --bubble-bg: #450a0a;
    --bubble-border: #ef4444;
    --bubble-text: #fee2e2;
  }
  .bubble-cooldown {
    --bubble-bg: #082f49;
    --bubble-border: #38bdf8;
    --bubble-text: #e0f2fe;
  }
  .bubble-coding {
    --bubble-bg: #022c22;
    --bubble-border: #10b981;
    --bubble-text: #ecfdf5;
  }

  .gear-icon {
    display: inline-block;
    animation: gear-spin 2s linear infinite;
    font-size: 9px;
  }

  .question-bubble {
    animation: question-bob 1.5s ease-in-out infinite;
  }

  .question-icon {
    display: inline-block;
    animation: question-wiggle 1.5s ease-in-out infinite;
  }

  @keyframes gear-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes question-bob {
    0%,
    100% {
      transform: translateX(-50%) scale(var(--overlay-scale, 1));
    }
    50% {
      transform: translateX(-50%) scale(var(--overlay-scale, 1))
        translateY(-3px) scale(1.06);
    }
  }

  @keyframes question-wiggle {
    0%,
    100% {
      transform: rotate(0deg);
    }
    25% {
      transform: rotate(-8deg);
    }
    75% {
      transform: rotate(8deg);
    }
  }

  @keyframes bubble-bob {
    0%,
    100% {
      transform: translateX(-50%) scale(var(--overlay-scale, 1));
    }
    50% {
      transform: translateX(-50%) scale(var(--overlay-scale, 1))
        translateY(-2px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .speech-bubble,
    .question-bubble,
    .question-icon,
    .gear-icon {
      animation: none !important;
    }
  }

  /* Agent Nametag Badge */
  .agent-badge {
    display: block;
    position: absolute;
    bottom: calc(-10px * var(--overlay-scale, 1));
    left: 50%;
    transform: translateX(-50%) scale(var(--overlay-scale, 1));
    transform-origin: bottom center;
    font-family: monospace;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: -0.02em;
    padding: 0 3px;
    border-radius: 2px;
    line-height: 1.1;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0.9;
    background-color: rgba(2, 6, 23, 0.9);
    color: var(--agent-color);
    border: 1px solid var(--agent-color);
  }
</style>

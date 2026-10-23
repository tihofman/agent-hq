<script lang="ts">
  import { onMount } from 'svelte';
  import { liveStore } from '../../live.svelte';
  import type { Agent, AgentStatus, HQEvent } from '../../server/state';
  import {
    getSpriteMetadata,
    getFrameIndex,
    getFrameBackgroundPosition,
    getSpeechBubble,
    AgentController,
    type AnimationName,
  } from '../../office/sprites';
  import type { RoomId } from '../../office/layout';

  interface Props {
    agent: Agent;
    runId?: string;
    instanceIndex?: number;
  }

  let { agent, runId, instanceIndex = 0 }: Props = $props();

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

  const activeRun = $derived(
    runId
      ? liveStore.state?.runs?.[runId]
      : agentState.runId
        ? liveStore.state?.runs?.[agentState.runId]
        : undefined,
  );

  const characterStatus = $derived<AgentStatus>(
    runId
      ? activeRun
        ? activeRun.status === 'cooldown'
          ? 'cooldown'
          : activeRun.status === 'handover'
            ? 'handover'
            : activeRun.status === 'running'
              ? runId === agentState.runId &&
                (agentState.status === 'testing' ||
                  agentState.status === 'reviewing' ||
                  agentState.status === 'coding')
                ? agentState.status
                : activeRun.room === 'qa'
                  ? 'reviewing'
                  : 'coding'
              : activeRun.status === 'failed'
                ? 'errorAlert'
                : 'idle'
        : 'idle'
      : agentState.status,
  );

  const characterRoom = $derived<RoomId>(
    runId
      ? (activeRun?.room as RoomId) ??
          (runId === agentState.runId
            ? (agentState.room as RoomId)
            : undefined) ??
          (activeRun?.status === 'handover'
            ? 'hall'
            : activeRun?.status === 'cooldown'
              ? 'lounge'
              : 'dev')
      : (agentState.room as RoomId) ?? 'lounge',
  );

  const activePR = $derived(liveStore.state?.activePR);
  const ticketId = $derived(activeRun?.ticketId);
  const prNumber = $derived(activeRun?.data?.prNumber ?? activePR?.prNumber);

  const cooldownUntil = $derived(
    activeRun?.data?.cooldownUntil ?? agentState.cooldownUntil,
  );

  const statusText = $derived(activeRun?.data?.statusText);

  // Synchronous initial position
  const initialRoom: RoomId = (() => {
    if (runId) {
      const run = liveStore.state?.runs?.[runId];
      if (run?.room) return run.room as RoomId;
      if (run?.status === 'handover') return 'hall';
      if (run?.status === 'cooldown') return 'lounge';
      if (run?.status === 'running') return 'dev';
    }
    return (agentState.room as RoomId) ?? 'lounge';
  })();

  const controller = new AgentController(agent, initialRoom, instanceIndex);

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

    const targetRoom = characterRoom;
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
        (!runId || !lastHandoverEvent.runId || lastHandoverEvent.runId === runId) &&
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
      ticketId,
      prNumber,
      statusText,
      cooldownUntil,
      now,
    }),
  );

  function tick(dt: number) {
    const res = controller.tick(
      dt,
      characterStatus,
      characterRoom,
    );
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

<div
  class="character-container agent-{agent} absolute"
  style="
    left: {Math.round(currentX)}px;
    top: {Math.round(currentY)}px;
    width: {metadata.frameWidth}px;
    height: {metadata.frameHeight}px;
    z-index: {Math.round(currentY) + 20};
  "
  data-testid="character-sprite-{agent}"
  data-agent={agent}
  data-run-id={runId}
  data-instance-index={instanceIndex}
  title="{metadata.displayName} ({metadata.role}) • {characterStatus}"
>
  <!-- Retro Status Speech Bubble -->
  {#if bubble}
    <div
      class="speech-bubble bubble-{bubble.type}"
      data-testid="speech-bubble-{agent}"
      data-run-id={runId}
    >
      {#if bubble.icon}
        <span class="bubble-icon" class:gear-icon={bubble.type === 'testing'}
          >{bubble.icon}</span
        >
      {/if}
      <span class="bubble-text">{bubble.text}</span>
    </div>
  {/if}

  <!-- Pixel Sprite -->
  <div
    class="pixel-sprite sprite-{agent}"
    style="{bgPos.css} width: {metadata.frameWidth}px; height: {metadata.frameHeight}px; background-size: {metadata.columns *
      metadata.frameWidth}px {metadata.rows * metadata.frameHeight}px;"
  ></div>

  <!-- Agent Retro Nametag Badge -->
  <div class="agent-badge">
    {metadata.displayName}
  </div>
</div>

<style>
  .character-container {
    image-rendering: pixelated;
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
    bottom: 35px;
    left: 50%;
    transform: translateX(-50%);
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
    pointer-events: none;
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

  .gear-icon {
    display: inline-block;
    animation: gear-spin 2s linear infinite;
    font-size: 9px;
  }

  @keyframes gear-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes bubble-bob {
    0%,
    100% {
      transform: translate(-50%, 0);
    }
    50% {
      transform: translate(-50%, -2px);
    }
  }

  /* Agent Nametag Badge */
  .agent-badge {
    position: absolute;
    bottom: -10px;
    left: 50%;
    transform: translateX(-50%);
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

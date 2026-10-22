<script lang="ts">
  import { onMount } from 'svelte';
  import { liveStore } from '../../live.svelte';
  import type { Agent } from '../../server/state';
  import {
    getSpriteMetadata,
    statusToAnimation,
    getFrameIndex,
    getFrameBackgroundPosition,
    getSpeechBubble,
    getDirection,
    getAgentTargetWaypointId,
    getAgentRoomOffset,
    findPathBetweenWaypoints,
    getClosestWaypointId,
    interpolatePosition,
    walkAnimationForDirection,
    type Direction,
    type AnimationName,
  } from '../../office/sprites';
  import { WAYPOINTS, TILE_SIZE, type RoomId } from '../../office/layout';

  interface Props {
    agent: Agent;
  }

  let { agent }: Props = $props();

  const metadata = $derived(getSpriteMetadata(agent));

  const agentState = $derived(
    liveStore.state?.agents?.[agent] ?? { status: 'idle', room: 'lounge' },
  );

  const activeRun = $derived(
    agentState.runId ? liveStore.state?.runs?.[agentState.runId] : undefined,
  );

  const ticketId = $derived(
    activeRun?.ticketId || liveStore.feed.findLast((e) => e.ticketId)?.ticketId,
  );

  const cooldownUntil = $derived(
    agentState.cooldownUntil || activeRun?.data?.cooldownUntil,
  );

  const statusText = $derived(activeRun?.data?.statusText);

  // Handover coordination between Claude and worker
  const isHandoverActive = $derived.by(() => {
    if (!liveStore.state?.agents) return false;
    if (agent === 'claude') {
      for (const w of ['agy', 'codex'] as const) {
        const s = liveStore.state.agents[w];
        if (
          s &&
          s.room === 'hall' &&
          (s.status === 'walking' || s.status === 'handover')
        ) {
          return true;
        }
      }
    }
    if (agent === 'agy' || agent === 'codex') {
      const s = liveStore.state.agents[agent];
      if (
        s &&
        s.room === 'hall' &&
        (s.status === 'walking' || s.status === 'handover')
      ) {
        return true;
      }
    }
    return false;
  });

  const effectiveRoom = $derived.by<RoomId>(() => {
    if (agent === 'claude' && isHandoverActive) {
      return 'hall';
    }
    return (agentState.room as RoomId) ?? 'lounge';
  });

  const bubble = $derived(
    getSpeechBubble(agentState.status, {
      ticketId,
      statusText,
      cooldownUntil,
    }),
  );

  // Mutable animated state
  let currentX = $state(0);
  let currentY = $state(0);
  let currentFrame = $state(0);
  let isWalking = $state(false);
  let currentDirection = $state<Direction>('down');
  let activeAnimName = $state<AnimationName>('idle');

  let currentPath: { x: number; y: number }[] = [];
  let animElapsedMs = 0;
  const WALK_SPEED_PX = 96; // 3 tiles / sec

  let initialized = false;
  let lastKnownRoom: RoomId | null = null;
  let lastHandover = false;

  function snapToTarget(room: RoomId, handover: boolean) {
    const wpId = getAgentTargetWaypointId(agent, room, handover);
    const wp = WAYPOINTS[wpId] ?? WAYPOINTS['hall_center'];
    const offset = getAgentRoomOffset(agent, room, handover);
    currentX = wp.x * TILE_SIZE + offset.x;
    currentY = wp.y * TILE_SIZE + offset.y;
    currentPath = [];
    isWalking = false;

    if (handover && room === 'hall') {
      currentDirection = agent === 'claude' ? 'right' : 'left';
    } else {
      currentDirection = 'down';
    }
  }

  function startWalkingTo(targetRoom: RoomId, handover: boolean) {
    const targetWpId = getAgentTargetWaypointId(agent, targetRoom, handover);
    const targetWp = WAYPOINTS[targetWpId];
    if (!targetWp) return;

    const startWpId = getClosestWaypointId(currentX, currentY);
    const wpPath = findPathBetweenWaypoints(startWpId, targetWpId);

    if (wpPath.length === 0) {
      isWalking = false;
      return;
    }

    const offset = getAgentRoomOffset(agent, targetRoom, handover);
    currentPath = wpPath.map((wp, index) => {
      const isFinal = index === wpPath.length - 1;
      return {
        x: wp.x * TILE_SIZE + (isFinal ? offset.x : 0),
        y: wp.y * TILE_SIZE + (isFinal ? offset.y : 0),
      };
    });
    isWalking = true;
  }

  $effect(() => {
    const targetRoom = effectiveRoom;
    const handover = isHandoverActive;

    // Initial mount: snap immediately without walking
    if (!initialized) {
      initialized = true;
      lastKnownRoom = targetRoom;
      lastHandover = handover;
      snapToTarget(targetRoom, handover);
      return;
    }

    // INIT_STATE reset: snap immediately without walking
    if (liveStore.feed.length === 0) {
      lastKnownRoom = targetRoom;
      lastHandover = handover;
      snapToTarget(targetRoom, handover);
      return;
    }

    // Live state room transition
    if (targetRoom !== lastKnownRoom || handover !== lastHandover) {
      lastKnownRoom = targetRoom;
      lastHandover = handover;
      startWalkingTo(targetRoom, handover);
    }
  });

  function tick(dt: number) {
    // 1. Position update along waypoint path
    if (isWalking && currentPath.length > 0) {
      let moveDist = WALK_SPEED_PX * dt;

      while (moveDist > 0 && currentPath.length > 0) {
        const nextTarget = currentPath[0];
        currentDirection = getDirection(
          { x: currentX, y: currentY },
          nextTarget,
          currentDirection,
        );

        const step = interpolatePosition(
          { x: currentX, y: currentY },
          nextTarget,
          moveDist,
        );
        currentX = step.position.x;
        currentY = step.position.y;
        moveDist = step.remainingDistance;

        if (step.arrived) {
          currentPath.shift();
          if (currentPath.length === 0) {
            isWalking = false;
            if (isHandoverActive && effectiveRoom === 'hall') {
              currentDirection = agent === 'claude' ? 'right' : 'left';
            }
          }
        } else {
          break;
        }
      }
    }

    // 2. Animation state selection
    let nextAnim: AnimationName;
    if (isWalking) {
      nextAnim = walkAnimationForDirection(currentDirection);
    } else if (isHandoverActive && effectiveRoom === 'hall') {
      nextAnim = 'handover';
    } else {
      nextAnim = statusToAnimation(agentState.status, currentDirection);
    }

    if (nextAnim !== activeAnimName) {
      activeAnimName = nextAnim;
      animElapsedMs = 0;
    } else {
      animElapsedMs += dt * 1000;
    }

    const animMeta =
      metadata.animations[activeAnimName] ?? metadata.animations.idle;
    currentFrame = getFrameIndex(animMeta, animElapsedMs);
  }

  onMount(() => {
    if (
      typeof window === 'undefined' ||
      typeof requestAnimationFrame === 'undefined'
    ) {
      return;
    }

    let animFrameId: number;
    let lastTime = performance.now();

    const loop = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      tick(dt);
      animFrameId = requestAnimationFrame(loop);
    };

    animFrameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  });

  const bgPos = $derived(getFrameBackgroundPosition(currentFrame));
</script>

<div
  class="character-container absolute"
  style="
    left: {Math.round(currentX)}px;
    top: {Math.round(currentY)}px;
    width: 32px;
    height: 32px;
    z-index: {Math.round(currentY) + 20};
  "
  data-testid="character-sprite-{agent}"
  title="{metadata.displayName} ({metadata.role}) • {agentState.status}"
>
  <!-- Retro Status Speech Bubble -->
  {#if bubble}
    <div
      class="speech-bubble bubble-{bubble.type}"
      data-testid="speech-bubble-{agent}"
    >
      {#if bubble.type === 'testing'}
        <span class="gear-icon">⚙️</span>
      {:else if bubble.icon && bubble.type !== 'alert'}
        <span class="bubble-icon">{bubble.icon}</span>
      {/if}
      <span class="bubble-text">{bubble.text}</span>
    </div>
  {/if}

  <!-- 32x32 Pixel Sprite -->
  <div class="pixel-sprite sprite-{agent}" style={bgPos.css}></div>

  <!-- Agent Retro Nametag Badge -->
  <div class="agent-badge badge-{agent}">
    {metadata.displayName}
  </div>
</div>

<style>
  .character-container {
    image-rendering: pixelated;
    image-rendering: -moz-crisp-edges;
    image-rendering: crisp-edges;
  }

  .pixel-sprite {
    width: 32px;
    height: 32px;
    background-repeat: no-repeat;
    background-size: 256px 128px;
    image-rendering: pixelated;
    image-rendering: -moz-crisp-edges;
    image-rendering: crisp-edges;
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
  }

  .bubble-testing {
    background-color: #451a03;
    border: 1px solid #f59e0b;
    color: #fef3c7;
  }
  .bubble-testing::after {
    border-top: 4px solid #f59e0b;
  }

  .bubble-review {
    background-color: #1e1b4b;
    border: 1px solid #818cf8;
    color: #e0e7ff;
  }
  .bubble-review::after {
    border-top: 4px solid #818cf8;
  }

  .bubble-alert {
    background-color: #450a0a;
    border: 1px solid #ef4444;
    color: #fee2e2;
    padding: 1px 6px;
    font-size: 11px;
  }
  .bubble-alert::after {
    border-top: 4px solid #ef4444;
  }

  .bubble-cooldown {
    background-color: #082f49;
    border: 1px solid #38bdf8;
    color: #e0f2fe;
  }
  .bubble-cooldown::after {
    border-top: 4px solid #38bdf8;
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
    border: 1px solid rgba(51, 65, 85, 0.8);
  }

  .badge-claude {
    color: #f97316;
    border-color: rgba(249, 115, 22, 0.4);
  }

  .badge-agy {
    color: #38bdf8;
    border-color: rgba(56, 189, 248, 0.4);
  }

  .badge-codex {
    color: #a855f7;
    border-color: rgba(168, 85, 247, 0.4);
  }
</style>

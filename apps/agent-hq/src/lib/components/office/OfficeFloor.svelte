<script lang="ts">
  import Room from './Room.svelte';
  import CharacterSprite from './CharacterSprite.svelte';
  import CharacterLogModal from './CharacterLogModal.svelte';
  import QuestionModal from './QuestionModal.svelte';
  import type { Agent } from '../../server/state';
  import type { QuestionPayload } from '@agent-hq/queue';
  import {
    ROOMS,
    GRID_WIDTH,
    GRID_HEIGHT,
    TILE_SIZE,
    TOTAL_WIDTH_PX,
    TOTAL_HEIGHT_PX,
    CANVAS_BASE_SCALE,
    tile,
    tileBg,
    type RoomId,
  } from '../../office/layout';
  import { deriveCharacters, type Character } from '../../office/sprites';
  import { resolveCharacterClickTarget } from '../../office/question-modal';
  import { liveStore } from '../../live.svelte';

  interface Props {
    scale?: number;
    highlightedRoom?: RoomId;
    showRoomLabels?: boolean;
    showWaypoints?: boolean;
  }

  let {
    scale = 1,
    highlightedRoom,
    showRoomLabels = true,
    showWaypoints = false,
  }: Props = $props();

  const canvasScale = $derived(scale * CANVAS_BASE_SCALE);

  let selectedLogTarget = $state<{
    agent: Agent;
    runId?: string;
    triggerEl?: HTMLElement | null;
  } | null>(null);

  let selectedQuestionTarget = $state<{
    question: QuestionPayload;
    triggerEl?: HTMLElement | null;
  } | null>(null);

  function handleCharacterClick(
    char: Character,
    event: MouseEvent | KeyboardEvent,
  ) {
    const triggerEl = (event.currentTarget as HTMLElement) ?? null;
    const target = resolveCharacterClickTarget(
      char,
      liveStore.state?.questions,
      liveStore.state?.runs,
      liveStore.feed,
    );

    if (target.type === 'question') {
      selectedLogTarget = null;
      selectedQuestionTarget = {
        question: target.question,
        triggerEl,
      };
    } else {
      selectedQuestionTarget = null;
      selectedLogTarget = {
        agent: target.agent,
        runId: target.runId,
        triggerEl,
      };
    }
  }

  const characters = $derived(deriveCharacters(liveStore.state));

  // Perimeter wall and divider tiles
  interface WallTile {
    x: number;
    y: number;
    tileId: number;
  }

  const perimeterTiles: WallTile[] = (() => {
    const tiles: WallTile[] = [];

    // Top border (y=0, x=0..27)
    tiles.push({ x: 0, y: 0, tileId: tile('wall_corner_left') });
    for (let x = 1; x < GRID_WIDTH - 1; x++) {
      tiles.push({ x, y: 0, tileId: tile('wall_top_molding') });
    }
    tiles.push({ x: GRID_WIDTH - 1, y: 0, tileId: tile('wall_corner_right') });

    // Bottom border (y=18, x=0..27)
    for (let x = 0; x < GRID_WIDTH; x++) {
      tiles.push({ x, y: GRID_HEIGHT - 1, tileId: tile('wall_baseboard') });
    }

    // Left and right perimeter columns
    for (let y = 1; y < GRID_HEIGHT - 1; y++) {
      tiles.push({ x: 0, y, tileId: tile('wall_drywall_mid') });
      tiles.push({ x: GRID_WIDTH - 1, y, tileId: tile('wall_drywall_mid') });
    }

    // Vertical partition between left and right rooms (x=13, 14 at y=1..7 and y=11..17)
    for (let y = 1; y <= 7; y++) {
      const tileId =
        y === 1
          ? tile('wall_top_molding')
          : y === 7
            ? tile('wall_baseboard')
            : tile('wall_drywall_mid');
      tiles.push({ x: 13, y, tileId });
      tiles.push({ x: 14, y, tileId });
    }
    for (let y = 11; y <= 17; y++) {
      const tileId =
        y === 17 ? tile('wall_baseboard') : tile('wall_drywall_mid');
      tiles.push({ x: 13, y, tileId });
      tiles.push({ x: 14, y, tileId });
    }

    return tiles;
  })();
</script>

<div
  class="office-floor-viewport relative inline-block select-none overflow-hidden rounded-md border border-slate-800 bg-slate-950 shadow-2xl"
  style="
    width: {TOTAL_WIDTH_PX * canvasScale}px;
    height: {TOTAL_HEIGHT_PX * canvasScale}px;
  "
  data-testid="office-floor"
>
  <div
    class="office-floor-canvas absolute left-0 top-0"
    style="
      width: {TOTAL_WIDTH_PX}px;
      height: {TOTAL_HEIGHT_PX}px;
      transform: scale({canvasScale});
      transform-origin: top left;
      image-rendering: pixelated;
      --tile-size: {TILE_SIZE}px;
      --tileset-size: {8 * TILE_SIZE}px;
    "
  >
    <!-- Background building foundation & perimeter walls -->
    {#each perimeterTiles as t (t.x + '-' + t.y)}
      <div
        class="pixel-tile perimeter-tile"
        style="left: {t.x * TILE_SIZE}px; top: {t.y * TILE_SIZE}px; {tileBg(
          t.tileId,
        )}"
      ></div>
    {/each}

    <!-- 5 Office Rooms -->
    {#each ROOMS as room (room.id)}
      <Room
        {room}
        showLabel={showRoomLabels}
        isHighlighted={highlightedRoom === room.id}
      />
    {/each}

    <!-- Character Sprites: one per active run; idle for agents without active runs -->
    {#each characters as char (char.id)}
      <CharacterSprite
        agent={char.agent}
        runId={char.runId}
        instanceIndex={char.instanceIndex}
        team={char.team}
        isTeamLead={char.isTeamLead}
        onclick={(event) => handleCharacterClick(char, event)}
      />
    {/each}

    <!-- Optional Waypoints Debug Overlay -->
    {#if showWaypoints}
      <div class="pointer-events-none absolute inset-0 z-30">
        {#each ROOMS as room (room.id)}
          {#each room.waypoints as wp (wp.id)}
            <div
              class="waypoint-marker absolute flex h-3 w-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-emerald-400/80 shadow ring-1 ring-white"
              style="left: {wp.x * TILE_SIZE + TILE_SIZE / 2}px; top: {wp.y *
                TILE_SIZE +
                TILE_SIZE / 2}px; transform: scale({1 /
                CANVAS_BASE_SCALE}); transform-origin: center;"
              title="{wp.id} ({wp.x}, {wp.y})"
            ></div>
          {/each}
        {/each}
      </div>
    {/if}
  </div>

  {#if selectedLogTarget}
    <CharacterLogModal
      agent={selectedLogTarget.agent}
      runId={selectedLogTarget.runId}
      triggerEl={selectedLogTarget.triggerEl}
      onclose={() => (selectedLogTarget = null)}
    />
  {/if}

  {#if selectedQuestionTarget}
    <QuestionModal
      question={selectedQuestionTarget.question}
      triggerEl={selectedQuestionTarget.triggerEl}
      onclose={() => (selectedQuestionTarget = null)}
    />
  {/if}
</div>

<style>
  .office-floor-viewport,
  .office-floor-canvas {
    image-rendering: pixelated;
    image-rendering: -moz-crisp-edges;
    image-rendering: crisp-edges;
  }

  :global(.pixel-tile) {
    position: absolute;
    width: var(--tile-size);
    height: var(--tile-size);
    background-image: url('../../assets/tilesets/office_tiles.png');
    background-size: var(--tileset-size) var(--tileset-size);
    background-repeat: no-repeat;
    image-rendering: pixelated;
    image-rendering: -moz-crisp-edges;
    image-rendering: crisp-edges;
  }

  .perimeter-tile {
    z-index: 5;
  }

  :global(.floor-tile) {
    z-index: 1;
  }

  :global(.object-tile) {
    z-index: 10;
  }
</style>

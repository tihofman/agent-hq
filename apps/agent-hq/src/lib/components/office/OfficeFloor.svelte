<script lang="ts">
  import Room from './Room.svelte';
  import CharacterSprite from './CharacterSprite.svelte';
  import CharacterLogModal from './CharacterLogModal.svelte';
  import type { Agent } from '../../server/state';
  import {
    ROOMS,
    GRID_WIDTH,
    GRID_HEIGHT,
    TILE_SIZE,
    TOTAL_WIDTH_PX,
    TOTAL_HEIGHT_PX,
    tile,
    tileBg,
    type RoomId,
  } from '../../office/layout';
  import { deriveCharacters, type Character } from '../../office/sprites';
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

  let selectedTarget = $state<{
    agent: Agent;
    runId?: string;
    triggerEl?: HTMLElement | null;
  } | null>(null);

  function handleCharacterClick(
    char: Character,
    event: MouseEvent | KeyboardEvent,
  ) {
    let targetRunId = char.runId;
    if (!targetRunId && char.team) {
      const teamRuns = Object.values(liveStore.state?.runs ?? {})
        .filter((r) => r.data?.team === char.team)
        .sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''));
      targetRunId = teamRuns[0]?.runId;
    }
    selectedTarget = {
      agent: char.agent,
      runId: targetRunId,
      triggerEl: (event.currentTarget as HTMLElement) ?? null,
    };
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
    width: {TOTAL_WIDTH_PX * scale}px;
    height: {TOTAL_HEIGHT_PX * scale}px;
  "
  data-testid="office-floor"
>
  <div
    class="office-floor-canvas absolute left-0 top-0"
    style="
      width: {TOTAL_WIDTH_PX}px;
      height: {TOTAL_HEIGHT_PX}px;
      transform: scale({scale});
      transform-origin: top left;
      image-rendering: pixelated;
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
              class="absolute flex h-3 w-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-emerald-400/80 shadow ring-1 ring-white"
              style="left: {wp.x * TILE_SIZE + 16}px; top: {wp.y * TILE_SIZE +
                16}px;"
              title="{wp.id} ({wp.x}, {wp.y})"
            ></div>
          {/each}
        {/each}
      </div>
    {/if}
  </div>

  {#if selectedTarget}
    <CharacterLogModal
      agent={selectedTarget.agent}
      runId={selectedTarget.runId}
      triggerEl={selectedTarget.triggerEl}
      onclose={() => (selectedTarget = null)}
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
    width: 32px;
    height: 32px;
    background-image: url('../../assets/tilesets/office_tiles.png');
    background-size: 256px 256px;
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

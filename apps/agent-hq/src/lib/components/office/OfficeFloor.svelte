<script lang="ts">
  import Room from './Room.svelte';
  import {
    ROOMS,
    GRID_WIDTH,
    GRID_HEIGHT,
    TILE_SIZE,
    TOTAL_WIDTH_PX,
    TOTAL_HEIGHT_PX,
    type RoomId,
  } from '../../office/layout';
  import officeTilesUrl from '../../assets/tilesets/office_tiles.png';

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

  // Perimeter wall and divider tiles
  interface WallTile {
    x: number;
    y: number;
    tileId: number;
  }

  const perimeterTiles: WallTile[] = (() => {
    const tiles: WallTile[] = [];

    // Top border (y=0, x=0..27)
    tiles.push({ x: 0, y: 0, tileId: 14 }); // corner left
    for (let x = 1; x < GRID_WIDTH - 1; x++) {
      tiles.push({ x, y: 0, tileId: 8 }); // top molding
    }
    tiles.push({ x: GRID_WIDTH - 1, y: 0, tileId: 15 }); // corner right

    // Bottom border (y=18, x=0..27)
    for (let x = 0; x < GRID_WIDTH; x++) {
      tiles.push({ x, y: GRID_HEIGHT - 1, tileId: 10 }); // baseboard
    }

    // Left and right perimeter columns
    for (let y = 1; y < GRID_HEIGHT - 1; y++) {
      tiles.push({ x: 0, y, tileId: 9 }); // drywall left
      tiles.push({ x: GRID_WIDTH - 1, y, tileId: 9 }); // drywall right
    }

    // Vertical partition between left and right rooms (x=13, 14 at y=1..7 and y=11..17)
    for (let y = 1; y <= 7; y++) {
      tiles.push({ x: 13, y, tileId: y === 1 ? 8 : y === 7 ? 10 : 9 });
      tiles.push({ x: 14, y, tileId: y === 1 ? 8 : y === 7 ? 10 : 9 });
    }
    for (let y = 11; y <= 17; y++) {
      tiles.push({ x: 13, y, tileId: y === 11 ? 9 : y === 17 ? 10 : 9 });
      tiles.push({ x: 14, y, tileId: y === 11 ? 9 : y === 17 ? 10 : 9 });
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
    {#each perimeterTiles as tile (tile.x + '-' + tile.y)}
      <div
        class="pixel-tile perimeter-tile"
        style="
          left: {tile.x * TILE_SIZE}px;
          top: {tile.y * TILE_SIZE}px;
          background-image: url('{officeTilesUrl}');
          background-position: -{(tile.tileId % 8) * TILE_SIZE}px -{Math.floor(
          tile.tileId / 8,
        ) * TILE_SIZE}px;
        "
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

    <!-- Optional Waypoints Debug Overlay -->
    {#if showWaypoints}
      <div class="pointer-events-none absolute inset-0 z-30">
        {#each ROOMS as room (room.id)}
          {#each room.waypoints as wp (wp.id)}
            <div
              class="absolute flex h-3 w-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-emerald-400/80 shadow ring-1 ring-white"
              style="left: {wp.x * TILE_SIZE + 16}px; top: {wp.y * TILE_SIZE +
                16}px;"
              title="{wp.label} ({wp.x}, {wp.y})"
            ></div>
          {/each}
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .office-floor-viewport,
  .office-floor-canvas {
    image-rendering: pixelated;
    image-rendering: -moz-crisp-edges;
    image-rendering: crisp-edges;
  }

  .pixel-tile {
    position: absolute;
    width: 32px;
    height: 32px;
    background-size: 256px 256px;
    background-repeat: no-repeat;
    image-rendering: pixelated;
    image-rendering: -moz-crisp-edges;
    image-rendering: crisp-edges;
  }

  .perimeter-tile {
    z-index: 5;
  }
</style>

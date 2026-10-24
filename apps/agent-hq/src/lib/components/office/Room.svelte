<script lang="ts">
  import {
    TILE_SIZE,
    CANVAS_BASE_SCALE,
    tileBg,
    type RoomDefinition,
  } from '../../office/layout';

  interface Props {
    room: RoomDefinition;
    showLabel?: boolean;
    isHighlighted?: boolean;
  }

  let { room, showLabel = true, isHighlighted = false }: Props = $props();
</script>

<div
  class="room-container absolute select-none {isHighlighted
    ? 'ring-2 ring-indigo-400 ring-offset-1 ring-offset-slate-900'
    : ''}"
  style="
    left: {room.bounds.x * TILE_SIZE}px;
    top: {room.bounds.y * TILE_SIZE}px;
    width: {room.bounds.width * TILE_SIZE}px;
    height: {room.bounds.height * TILE_SIZE}px;
  "
  data-room-id={room.id}
  data-testid="room-{room.id}"
>
  <!-- Room Tiles: Floor + Overlay Objects -->
  {#each room.tiles as cell (cell.localX + '-' + cell.localY)}
    <!-- Floor Tile -->
    <div
      class="pixel-tile floor-tile"
      style="left: {cell.localX * TILE_SIZE}px; top: {cell.localY *
        TILE_SIZE}px; {tileBg(cell.floorTile)}"
    ></div>

    <!-- Object / Furniture / Wall Overlay Tile -->
    {#if cell.objectTile !== undefined}
      <div
        class="pixel-tile object-tile"
        style="left: {cell.localX * TILE_SIZE}px; top: {cell.localY *
          TILE_SIZE}px; {tileBg(cell.objectTile)}"
      ></div>
    {/if}
  {/each}

  <!-- Room Identification Label -->
  {#if showLabel && room.id !== 'hall'}
    <div
      class="room-label pointer-events-none absolute right-1.5 top-1.5 z-20 flex items-center gap-1 rounded bg-slate-950/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-200 border border-slate-700/70 shadow-sm backdrop-blur-xs"
      style="transform: scale({1 / CANVAS_BASE_SCALE}); transform-origin: top right;"
    >
      <span>{room.icon}</span>
      <span>{room.name}</span>
    </div>
  {:else if showLabel && room.id === 'hall'}
    <div
      class="room-label pointer-events-none absolute left-3 top-1 z-20 flex items-center gap-1 rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[9px] text-slate-300 border border-slate-800"
      style="transform: scale({1 / CANVAS_BASE_SCALE}); transform-origin: top left;"
    >
      <span>{room.icon}</span>
      <span>{room.name}</span>
    </div>
  {/if}
</div>

<style>
  .room-container {
    image-rendering: pixelated;
    image-rendering: crisp-edges;
  }
</style>

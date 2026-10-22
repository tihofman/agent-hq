<script lang="ts">
  import type { RoomDefinition } from '../../office/layout';
  import officeTilesUrl from '../../assets/tilesets/office_tiles.png';

  interface Props {
    room: RoomDefinition;
    showLabel?: boolean;
    isHighlighted?: boolean;
  }

  let { room, showLabel = true, isHighlighted = false }: Props = $props();

  const TILE_SIZE = 32;
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
      style="
        left: {cell.localX * TILE_SIZE}px;
        top: {cell.localY * TILE_SIZE}px;
        background-image: url('{officeTilesUrl}');
        background-position: -{(cell.floorTile % 8) * TILE_SIZE}px -{Math.floor(
        cell.floorTile / 8,
      ) * TILE_SIZE}px;
      "
    ></div>

    <!-- Object / Furniture / Wall Overlay Tile -->
    {#if cell.objectTile !== undefined}
      <div
        class="pixel-tile object-tile"
        style="
          left: {cell.localX * TILE_SIZE}px;
          top: {cell.localY * TILE_SIZE}px;
          background-image: url('{officeTilesUrl}');
          background-position: -{(cell.objectTile % 8) *
          TILE_SIZE}px -{Math.floor(cell.objectTile / 8) * TILE_SIZE}px;
        "
      ></div>
    {/if}
  {/each}

  <!-- Room Identification Label -->
  {#if showLabel && room.id !== 'hall'}
    <div
      class="pointer-events-none absolute right-1.5 top-1.5 z-20 flex items-center gap-1 rounded bg-slate-950/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-200 border border-slate-700/70 shadow-sm backdrop-blur-xs"
    >
      <span>{room.icon}</span>
      <span>{room.name}</span>
    </div>
  {:else if showLabel && room.id === 'hall'}
    <div
      class="pointer-events-none absolute left-3 top-1 z-20 flex items-center gap-1 rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[9px] text-slate-300 border border-slate-800"
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

  .floor-tile {
    z-index: 1;
  }

  .object-tile {
    z-index: 10;
  }
</style>

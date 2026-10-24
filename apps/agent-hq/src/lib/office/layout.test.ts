import { describe, expect, it } from 'vitest';
import officeTilesData from '../assets/tilesets/office_tiles.json';
import {
  fillRow,
  findWaypointPath,
  getPathBetweenRooms,
  getRoom,
  GRID_HEIGHT,
  GRID_WIDTH,
  ROOM_IDS,
  ROOMS,
  tile,
  tileBg,
  USED_TILE_NAMES,
  WAYPOINTS,
  TEAM_DESKS,
  TEAMS,
  TILE_SIZE,
  TOTAL_WIDTH_PX,
  TOTAL_HEIGHT_PX,
  CANVAS_BASE_SCALE,
  type RoomId,
} from './layout';
import fs from 'node:fs';
import path from 'node:path';

describe('office/layout', () => {
  describe('Room presence and properties', () => {
    it('defines exactly the 5 required rooms', () => {
      expect(ROOMS).toHaveLength(5);
      const roomIds = ROOMS.map((r) => r.id);
      expect(roomIds.sort()).toEqual(['ceo', 'dev', 'hall', 'lounge', 'qa']);
    });

    it.each(ROOM_IDS)('has valid bounds and waypoints for room %s', (id) => {
      const room = getRoom(id);
      expect(room.name).toBeTruthy();
      expect(room.icon).toBeTruthy();
      expect(room.bounds.width).toBeGreaterThan(0);
      expect(room.bounds.height).toBeGreaterThan(0);
      expect(room.bounds.x).toBeGreaterThanOrEqual(0);
      expect(room.bounds.y).toBeGreaterThanOrEqual(0);
      expect(room.bounds.x + room.bounds.width).toBeLessThanOrEqual(GRID_WIDTH);
      expect(room.bounds.y + room.bounds.height).toBeLessThanOrEqual(
        GRID_HEIGHT,
      );

      // Main and door waypoints belong to this room
      expect(room.mainWaypoint.roomId).toBe(id);
      expect(room.doorWaypoint.roomId).toBe(id);
      expect(room.waypoints.length).toBeGreaterThan(0);

      // Main waypoint is within room bounds
      expect(room.mainWaypoint.x).toBeGreaterThanOrEqual(room.bounds.x);
      expect(room.mainWaypoint.x).toBeLessThan(
        room.bounds.x + room.bounds.width,
      );
      expect(room.mainWaypoint.y).toBeGreaterThanOrEqual(room.bounds.y);
      expect(room.mainWaypoint.y).toBeLessThan(
        room.bounds.y + room.bounds.height,
      );
    });

    it('ensures no two rooms overlap in coordinates', () => {
      for (let i = 0; i < ROOMS.length; i++) {
        for (let j = i + 1; j < ROOMS.length; j++) {
          const a = ROOMS[i].bounds;
          const b = ROOMS[j].bounds;
          const overlapsX = a.x < b.x + b.width && a.x + a.width > b.x;
          const overlapsY = a.y < b.y + b.height && a.y + a.height > b.y;
          expect(overlapsX && overlapsY).toBe(false);
        }
      }
    });

    it('validates tile counts and tile ID ranges for every room', () => {
      for (const room of ROOMS) {
        expect(room.tiles).toHaveLength(room.bounds.width * room.bounds.height);
        for (const cell of room.tiles) {
          expect(cell.localX).toBeGreaterThanOrEqual(0);
          expect(cell.localX).toBeLessThan(room.bounds.width);
          expect(cell.localY).toBeGreaterThanOrEqual(0);
          expect(cell.localY).toBeLessThan(room.bounds.height);

          expect(cell.floorTile).toBeGreaterThanOrEqual(0);
          expect(cell.floorTile).toBeLessThanOrEqual(63);

          if (cell.objectTile !== undefined) {
            expect(cell.objectTile).toBeGreaterThanOrEqual(0);
            expect(cell.objectTile).toBeLessThanOrEqual(63);
          }
        }
      }
    });
  });

  describe('Tile helpers and office_tiles.json validation', () => {
    it('returns the correct tile ID for valid tile names', () => {
      expect(tile('floor_parquet_light')).toBe(0);
      expect(tile('wall_top_molding')).toBe(8);
      expect(tile('ambient_occlusion_shadow')).toBe(63);
    });

    it('throws an error for unknown tile names', () => {
      expect(() => tile('non_existent_tile_name')).toThrow(
        'Unknown tile name: "non_existent_tile_name"',
      );
    });

    it('verifies that every used tile name exists in office_tiles.json', () => {
      expect(USED_TILE_NAMES.size).toBeGreaterThan(0);
      const jsonNames = new Set(officeTilesData.tiles.map((t) => t.name));
      for (const name of USED_TILE_NAMES) {
        expect(jsonNames.has(name)).toBe(true);
      }
    });

    it('fills a row with the specified object tile', () => {
      const row = fillRow(2, 'wall_baseboard', 4);
      expect(Object.keys(row)).toHaveLength(4);
      expect(row['0,2']).toEqual({ object: tile('wall_baseboard') });
      expect(row['1,2']).toEqual({ object: tile('wall_baseboard') });
      expect(row['2,2']).toEqual({ object: tile('wall_baseboard') });
      expect(row['3,2']).toEqual({ object: tile('wall_baseboard') });
    });

    it('generates correct background-position with tileBg', () => {
      expect(tileBg(0)).toBe('background-position: -0px -0px;');
      expect(tileBg(9)).toBe('background-position: -128px -128px;');
      expect(tileBg(18)).toBe('background-position: -256px -256px;');
    });
  });

  describe('Waypoint positioning and reachability', () => {
    it('ensures every waypoint lies within its room bounds', () => {
      for (const wp of Object.values(WAYPOINTS)) {
        const room = ROOMS.find((r) => r.id === wp.roomId);
        expect(room).toBeDefined();
        if (!room) continue;

        expect(wp.x).toBeGreaterThanOrEqual(room.bounds.x);
        expect(wp.x).toBeLessThan(room.bounds.x + room.bounds.width);
        expect(wp.y).toBeGreaterThanOrEqual(room.bounds.y);
        expect(wp.y).toBeLessThan(room.bounds.y + room.bounds.height);
      }
    });

    it('positions ceo_desk and qa_desk at walkable floor tiles', () => {
      expect(WAYPOINTS['ceo_desk']).toMatchObject({ x: 6, y: 6 });
      expect(WAYPOINTS['qa_desk']).toMatchObject({ x: 19, y: 6 });
    });

    it('ensures every waypoint is reachable from hall_center', () => {
      for (const wp of Object.values(WAYPOINTS)) {
        const path = findWaypointPath(wp.id, 'hall_center');
        expect(path.length).toBeGreaterThanOrEqual(1);
        expect(path[0].id).toBe(wp.id);
        expect(path[path.length - 1].id).toBe('hall_center');

        const reversePath = findWaypointPath('hall_center', wp.id);
        expect(reversePath.length).toBeGreaterThanOrEqual(1);
        expect(reversePath[0].id).toBe('hall_center');
        expect(reversePath[reversePath.length - 1].id).toBe(wp.id);
      }
    });

    it('returns a single-step path when start and target rooms are identical', () => {
      const path = getPathBetweenRooms('ceo', 'ceo');
      expect(path).toHaveLength(1);
      expect(path[0].roomId).toBe('ceo');
    });

    it.each([
      ['ceo', 'dev'],
      ['ceo', 'qa'],
      ['ceo', 'lounge'],
      ['dev', 'ceo'],
      ['dev', 'qa'],
      ['dev', 'lounge'],
      ['qa', 'ceo'],
      ['qa', 'dev'],
      ['qa', 'lounge'],
      ['lounge', 'ceo'],
      ['lounge', 'dev'],
      ['lounge', 'qa'],
      ['ceo', 'hall'],
      ['hall', 'ceo'],
      ['dev', 'hall'],
      ['hall', 'dev'],
      ['qa', 'hall'],
      ['hall', 'qa'],
      ['lounge', 'hall'],
      ['hall', 'lounge'],
    ] as const)(
      'connects %s to %s through the hallway',
      (from: RoomId, to: RoomId) => {
        const path = getPathBetweenRooms(from, to);
        expect(path.length).toBeGreaterThan(1);

        // Path starts in `from` and ends in `to`
        expect(path[0].roomId).toBe(from);
        expect(path[path.length - 1].roomId).toBe(to);

        // Path must traverse `hall` when travelling between non-hall rooms
        if (from !== 'hall' && to !== 'hall') {
          const hallwayWaypoints = path.filter((wp) => wp.roomId === 'hall');
          expect(hallwayWaypoints.length).toBeGreaterThanOrEqual(1);
        }

        // Each waypoint in the path has valid coordinates
        for (const wp of path) {
          expect(wp.x).toBeGreaterThanOrEqual(0);
          expect(wp.x).toBeLessThan(GRID_WIDTH);
          expect(wp.y).toBeGreaterThanOrEqual(0);
          expect(wp.y).toBeLessThan(GRID_HEIGHT);
        }
      },
    );
  });

  describe('Team areas and desks (V2 / #102)', () => {
    it('defines team desks for frontend, backend, and qa', () => {
      expect(TEAMS).toEqual(['frontend', 'backend', 'qa']);
      for (const team of TEAMS) {
        const desk = TEAM_DESKS[team];
        expect(desk.team).toBe(team);
        expect(desk.name).toBeTruthy();
        expect(ROOM_IDS).toContain(desk.roomId);
        expect(WAYPOINTS[desk.waypointId]).toBeDefined();
        expect(WAYPOINTS[desk.waypointId].roomId).toBe(desk.roomId);
      }
    });

    it('assigns frontend and backend desks to dev lab, qa desk to qa station', () => {
      expect(TEAM_DESKS.frontend.roomId).toBe('dev');
      expect(TEAM_DESKS.backend.roomId).toBe('dev');
      expect(TEAM_DESKS.qa.roomId).toBe('qa');

      expect(TEAM_DESKS.frontend.waypointId).toBe('dev_desk');
      expect(TEAM_DESKS.backend.waypointId).toBe('dev_meeting');
      expect(TEAM_DESKS.qa.waypointId).toBe('qa_desk');
    });

    it('ensures each team desk waypoint is reachable from hallway', () => {
      for (const team of TEAMS) {
        const desk = TEAM_DESKS[team];
        const path = findWaypointPath('hall_center', desk.waypointId);
        expect(path.length).toBeGreaterThan(1);
        expect(path[0].id).toBe('hall_center');
        expect(path[path.length - 1].id).toBe(desk.waypointId);
      }
    });
  });

  describe('128x128 Pixel-Art Grid & Scaling (Ticket #136)', () => {
    it('uses TILE_SIZE = 128 and computes canvas dimensions accurately', () => {
      expect(TILE_SIZE).toBe(128);
      expect(TOTAL_WIDTH_PX).toBe(GRID_WIDTH * 128);
      expect(TOTAL_HEIGHT_PX).toBe(GRID_HEIGHT * 128);
      expect(TOTAL_WIDTH_PX).toBe(3584);
      expect(TOTAL_HEIGHT_PX).toBe(2432);
    });

    it('scales canvas dimensions across Zoom 1x (64px) and Zoom 2x (128px)', () => {
      expect(CANVAS_BASE_SCALE).toBe(64 / 128); // 0.5

      // Zoom 1x screen size: 64px per tile
      const scale1TilePx = TILE_SIZE * CANVAS_BASE_SCALE * 1;
      expect(scale1TilePx).toBe(64);
      const viewportW1 = TOTAL_WIDTH_PX * CANVAS_BASE_SCALE * 1;
      const viewportH1 = TOTAL_HEIGHT_PX * CANVAS_BASE_SCALE * 1;
      expect(viewportW1).toBe(1792);
      expect(viewportH1).toBe(1216);

      // Zoom 2x screen size: 128px per tile
      const scale2TilePx = TILE_SIZE * CANVAS_BASE_SCALE * 2;
      expect(scale2TilePx).toBe(128);
      const viewportW2 = TOTAL_WIDTH_PX * CANVAS_BASE_SCALE * 2;
      const viewportH2 = TOTAL_HEIGHT_PX * CANVAS_BASE_SCALE * 2;
      expect(viewportW2).toBe(3584);
      expect(viewportH2).toBe(2432);
    });

    it('ensures no hardcoded 32px/16px pixel values exist in office UI components', () => {
      const filesToCheck = [
        path.resolve(__dirname, '../components/office/OfficeFloor.svelte'),
        path.resolve(__dirname, '../components/office/Room.svelte'),
        path.resolve(__dirname, '../components/office/CharacterSprite.svelte'),
        path.resolve(__dirname, './sprites.ts'),
      ];

      const hardcodedPixelRegex = /\b(32|16)px\b/;
      for (const file of filesToCheck) {
        const content = fs.readFileSync(file, 'utf-8');
        expect(hardcodedPixelRegex.test(content)).toBe(false);
      }
    });
  });
});

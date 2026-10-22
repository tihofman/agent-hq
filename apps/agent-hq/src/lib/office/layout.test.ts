import { describe, expect, it } from 'vitest';
import {
  doRoomsOverlap,
  getAllRooms,
  getPathBetweenRooms,
  getRoom,
  GRID_HEIGHT,
  GRID_WIDTH,
  isTileInRoom,
  ROOM_IDS,
  type RoomId,
} from './layout';

describe('office/layout', () => {
  describe('Room presence and properties', () => {
    it('defines exactly the 5 required rooms', () => {
      const rooms = getAllRooms();
      expect(rooms).toHaveLength(5);
      const roomIds = rooms.map((r) => r.id);
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
      expect(isTileInRoom(room.mainWaypoint.x, room.mainWaypoint.y, id)).toBe(
        true,
      );
    });

    it('ensures no two rooms overlap in coordinates', () => {
      expect(doRoomsOverlap()).toBe(false);

      const rooms = getAllRooms();
      for (let i = 0; i < rooms.length; i++) {
        for (let j = i + 1; j < rooms.length; j++) {
          const a = rooms[i].bounds;
          const b = rooms[j].bounds;
          const overlapsX = a.x < b.x + b.width && a.x + a.width > b.x;
          const overlapsY = a.y < b.y + b.height && a.y + a.height > b.y;
          expect(overlapsX && overlapsY).toBe(false);
        }
      }
    });

    it('validates tile counts and tile ID ranges for every room', () => {
      const rooms = getAllRooms();
      for (const room of rooms) {
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

  describe('Waypoint navigation and hallway connections', () => {
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
});

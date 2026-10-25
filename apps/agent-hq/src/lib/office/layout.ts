import officeTilesData from '../assets/tilesets/office_tiles.json';

import { TEAMS, type Room, type Team } from '@agent-hq/queue/types';
export { TEAMS, type Team };
export type RoomId = Room;

export const ROOM_IDS: readonly RoomId[] = [
  'ceo',
  'hall',
  'dev',
  'qa',
  'lounge',
] as const;

export const TILE_SIZE = 128;
export const CANVAS_BASE_SCALE = 64 / TILE_SIZE;
export const GRID_WIDTH = 28;
export const GRID_HEIGHT = 19;
export const TOTAL_WIDTH_PX = GRID_WIDTH * TILE_SIZE;
export const TOTAL_HEIGHT_PX = GRID_HEIGHT * TILE_SIZE;

const tileMap = new Map<string, number>();
for (const t of officeTilesData.tiles) {
  tileMap.set(t.name, t.id);
}

export const USED_TILE_NAMES = new Set<string>();

export function tile(name: string): number {
  const id = tileMap.get(name);
  if (id === undefined) {
    throw new Error(`Unknown tile name: "${name}"`);
  }
  USED_TILE_NAMES.add(name);
  return id;
}

export function fillRow(
  y: number,
  name: string,
  width: number,
): Record<string, { floor?: number; object?: number }> {
  const t = tile(name);
  const result: Record<string, { floor?: number; object?: number }> = {};
  for (let x = 0; x < width; x++) {
    result[`${x},${y}`] = { object: t };
  }
  return result;
}

export function tileBg(id: number): string {
  const col = id % 8;
  const row = Math.floor(id / 8);
  return `background-position: -${col * TILE_SIZE}px -${row * TILE_SIZE}px;`;
}

export interface RoomBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Waypoint {
  id: string;
  roomId: RoomId;
  x: number;
  y: number;
}

export interface TileCell {
  localX: number;
  localY: number;
  floorTile: number;
  objectTile?: number;
}

export interface RoomDefinition {
  id: RoomId;
  name: string;
  icon: string;
  bounds: RoomBounds;
  mainWaypoint: Waypoint;
  doorWaypoint: Waypoint;
  waypoints: Waypoint[];
  tiles: TileCell[];
}

export interface TeamDesk {
  team: Team;
  roomId: RoomId;
  name: string;
  waypointId: string;
}

export const TEAM_DESKS: Record<Team, TeamDesk> = {
  frontend: {
    team: 'frontend',
    roomId: 'dev',
    name: 'Frontend Team',
    waypointId: 'dev_desk',
  },
  backend: {
    team: 'backend',
    roomId: 'dev',
    name: 'Backend Team',
    waypointId: 'dev_meeting',
  },
  qa: {
    team: 'qa',
    roomId: 'qa',
    name: 'QA Team',
    waypointId: 'qa_desk',
  },
};

export const TEAM_LABELS: Record<Team, string> = {
  frontend: 'Frontend Lead',
  backend: 'Backend Lead',
  qa: 'QA Lead',
};

export const WAYPOINTS: Record<string, Waypoint> = {
  // CEO Suite
  ceo_desk: {
    id: 'ceo_desk',
    roomId: 'ceo',
    x: 6,
    y: 6,
  },
  ceo_board: {
    id: 'ceo_board',
    roomId: 'ceo',
    x: 9,
    y: 4,
  },
  ceo_door: {
    id: 'ceo_door',
    roomId: 'ceo',
    x: 6,
    y: 7,
  },

  // Flur & Übergabezone
  hall_ceo_door: {
    id: 'hall_ceo_door',
    roomId: 'hall',
    x: 6,
    y: 8,
  },
  hall_qa_door: {
    id: 'hall_qa_door',
    roomId: 'hall',
    x: 20,
    y: 8,
  },
  hall_west: {
    id: 'hall_west',
    roomId: 'hall',
    x: 6,
    y: 9,
  },
  hall_center: {
    id: 'hall_center',
    roomId: 'hall',
    x: 13,
    y: 9,
  },
  hall_east: {
    id: 'hall_east',
    roomId: 'hall',
    x: 20,
    y: 9,
  },
  hall_dev_door: {
    id: 'hall_dev_door',
    roomId: 'hall',
    x: 6,
    y: 10,
  },
  hall_lounge_door: {
    id: 'hall_lounge_door',
    roomId: 'hall',
    x: 20,
    y: 10,
  },

  // Dev Lab
  dev_door: {
    id: 'dev_door',
    roomId: 'dev',
    x: 6,
    y: 11,
  },
  dev_desk: {
    id: 'dev_desk',
    roomId: 'dev',
    x: 6,
    y: 14,
  },
  dev_meeting: {
    id: 'dev_meeting',
    roomId: 'dev',
    x: 10,
    y: 16,
  },

  // QA Station
  qa_desk: {
    id: 'qa_desk',
    roomId: 'qa',
    x: 19,
    y: 6,
  },
  qa_servers: {
    id: 'qa_servers',
    roomId: 'qa',
    x: 17,
    y: 4,
  },
  qa_door: {
    id: 'qa_door',
    roomId: 'qa',
    x: 20,
    y: 7,
  },

  // Lounge
  lounge_door: {
    id: 'lounge_door',
    roomId: 'lounge',
    x: 20,
    y: 11,
  },
  lounge_couch: {
    id: 'lounge_couch',
    roomId: 'lounge',
    x: 19,
    y: 15,
  },
  lounge_coffee: {
    id: 'lounge_coffee',
    roomId: 'lounge',
    x: 18,
    y: 13,
  },
};

export const WAYPOINT_CONNECTIONS: readonly [string, string][] = [
  // CEO Suite interior
  ['ceo_desk', 'ceo_board'],
  ['ceo_desk', 'ceo_door'],

  // CEO Door to Hall
  ['ceo_door', 'hall_ceo_door'],

  // Hall connections
  ['hall_ceo_door', 'hall_west'],
  ['hall_dev_door', 'hall_west'],
  ['hall_west', 'hall_center'],
  ['hall_center', 'hall_east'],
  ['hall_qa_door', 'hall_east'],
  ['hall_lounge_door', 'hall_east'],

  // Hall to Dev Lab
  ['hall_dev_door', 'dev_door'],

  // Dev Lab interior
  ['dev_door', 'dev_desk'],
  ['dev_desk', 'dev_meeting'],

  // Hall to QA Station
  ['hall_qa_door', 'qa_door'],

  // QA Station interior
  ['qa_door', 'qa_desk'],
  ['qa_desk', 'qa_servers'],

  // Hall to Lounge
  ['hall_lounge_door', 'lounge_door'],

  // Lounge interior
  ['lounge_door', 'lounge_couch'],
  ['lounge_couch', 'lounge_coffee'],
] as const;

function buildRoomTiles(
  width: number,
  height: number,
  defaultFloor: number,
  placements: Record<string, { floor?: number; object?: number }>,
): TileCell[] {
  const cells: TileCell[] = [];
  for (let localY = 0; localY < height; localY++) {
    for (let localX = 0; localX < width; localX++) {
      const key = `${localX},${localY}`;
      const item = placements[key];
      cells.push({
        localX,
        localY,
        floorTile: item?.floor ?? defaultFloor,
        objectTile: item?.object,
      });
    }
  }
  return cells;
}

// 1. CEO Suite (12x7, y=1..7)
const ceoTiles = buildRoomTiles(12, 7, tile('floor_parquet_light'), {
  ...fillRow(0, 'wall_top_molding', 12),
  ...fillRow(1, 'wall_drywall_mid', 12),
  ...fillRow(2, 'wall_baseboard', 12),
  ...fillRow(6, 'wall_drywall_mid', 12),

  '0,0': { object: tile('wall_corner_left') },
  '3,0': { object: tile('window_skyline_day') },
  '4,0': { object: tile('window_skyline_day') },
  '6,0': { object: tile('framed_architecture') },
  '8,0': { object: tile('window_skyline_day') },
  '9,0': { object: tile('window_skyline_day') },
  '11,0': { object: tile('wall_corner_right') },

  '1,1': { object: tile('bookshelf_top') },
  '5,1': { object: tile('wall_clock') },
  '8,1': { object: tile('whiteboard_top_left') },
  '9,1': { object: tile('whiteboard_top_right') },

  '1,2': { object: tile('bookshelf_bottom') },
  '8,2': { object: tile('whiteboard_bottom_left') },
  '9,2': { object: tile('whiteboard_bottom_right') },

  '1,3': { object: tile('filing_cabinet') },
  '4,3': { object: tile('desk_wood_left') },
  '5,3': { object: tile('desk_wood_center') },
  '6,3': { object: tile('desk_wood_right') },
  '10,3': { object: tile('potted_plant_monstera') },

  '3,4': { object: tile('office_wastebin') },
  '5,4': { object: tile('chair_ergonomic_front') },
  '10,4': { object: tile('potted_plant_succulent') },

  '5,6': { object: tile('door_frame_top'), floor: tile('floor_welcome_mat') },
});

// 2. QA Station (12x7, y=1..7)
const qaTiles = buildRoomTiles(12, 7, tile('floor_tech_raised'), {
  ...fillRow(0, 'wall_top_molding', 12),
  ...fillRow(1, 'wall_drywall_mid', 12),
  ...fillRow(2, 'wall_baseboard', 12),
  ...fillRow(6, 'wall_drywall_mid', 12),

  '0,0': { object: tile('wall_corner_left') },
  '2,0': { object: tile('trophy_shelf') },
  '5,0': { object: tile('qa_dashboard_wall_top') },
  '6,0': { object: tile('qa_dashboard_wall_top') },
  '8,0': { object: tile('window_skyline_day') },
  '9,0': { object: tile('window_skyline_day') },
  '11,0': { object: tile('wall_corner_right') },

  '1,1': { object: tile('server_rack_top') },
  '2,1': { object: tile('server_rack_top') },
  '5,1': { object: tile('qa_dashboard_wall_bottom') },
  '6,1': { object: tile('qa_dashboard_wall_bottom') },

  '1,2': { object: tile('server_rack_bottom') },
  '2,2': { object: tile('server_rack_bottom') },

  '1,3': { object: tile('filing_cabinet') },
  '4,3': { object: tile('desk_tech_monitors') },
  '5,3': { object: tile('desk_laptop_coffee') },
  '6,3': { object: tile('workstation_pc_tower') },
  '10,3': { object: tile('potted_plant_succulent') },

  '2,4': { object: tile('office_wastebin') },
  '4,4': { object: tile('chair_ergonomic_front') },
  '5,4': { object: tile('chair_ergonomic_front') },

  '5,6': { object: tile('door_frame_top'), floor: tile('floor_welcome_mat') },
});

// 3. Hallway (26x3, y=8..10)
const hallTiles = buildRoomTiles(26, 3, tile('floor_carpet_hall'), {
  '2,0': { object: tile('hallway_sign') },
  '5,0': {
    object: tile('door_frame_bottom'),
    floor: tile('floor_welcome_mat'),
  },
  '12,0': { object: tile('exit_sign') },
  '19,0': {
    object: tile('door_frame_bottom'),
    floor: tile('floor_welcome_mat'),
  },
  '23,0': { object: tile('wall_clock') },

  '10,1': { object: tile('floor_cable_bridge') },
  '15,1': { object: tile('floor_cable_bridge') },

  '5,2': { object: tile('door_frame_top'), floor: tile('floor_welcome_mat') },
  '19,2': { object: tile('door_frame_top'), floor: tile('floor_welcome_mat') },
});

// 4. Dev Lab (12x7, y=11..17)
const devTiles = buildRoomTiles(12, 7, tile('floor_carpet_dev'), {
  ...fillRow(0, 'wall_drywall_mid', 12),
  ...fillRow(6, 'wall_baseboard', 12),

  '5,0': {
    object: tile('door_frame_bottom'),
    floor: tile('floor_welcome_mat'),
  },

  '0,1': { object: tile('wall_baseboard') },
  '11,1': { object: tile('wall_baseboard') },

  '2,2': { object: tile('desk_tech_monitors') },
  '3,2': { object: tile('desk_tech_monitors') },
  '4,2': { object: tile('desk_laptop_coffee') },
  '5,2': { object: tile('workstation_pc_tower') },
  '7,2': { object: tile('desk_tech_monitors') },
  '8,2': { object: tile('desk_laptop_coffee') },
  '9,2': { object: tile('workstation_pc_tower') },
  '10,2': { object: tile('retro_crt_terminal') },

  '1,3': { object: tile('office_wastebin') },
  '2,3': { object: tile('chair_ergonomic_front') },
  '3,3': { object: tile('chair_ergonomic_front') },
  '4,3': { object: tile('chair_ergonomic_front') },
  '8,3': { object: tile('chair_ergonomic_front') },
  '9,3': { object: tile('chair_ergonomic_front') },
  '10,3': { object: tile('filing_cabinet') },

  '7,4': { object: tile('meeting_table_tl') },
  '8,4': { object: tile('meeting_table_tr') },
  '9,4': { object: tile('pizza_box_open') },
  '10,4': { object: tile('potted_plant_succulent') },

  '7,5': { object: tile('meeting_table_bl') },
  '8,5': { object: tile('meeting_table_br') },
});

// 5. Lounge / Breakroom (12x7, y=11..17)
const loungeTiles = buildRoomTiles(12, 7, tile('floor_tile_lounge'), {
  ...fillRow(0, 'wall_drywall_mid', 12),
  ...fillRow(6, 'wall_baseboard', 12),

  '5,0': {
    object: tile('door_frame_bottom'),
    floor: tile('floor_welcome_mat'),
  },

  '1,1': { object: tile('coffee_counter_machine') },
  '2,1': { object: tile('water_cooler') },
  '3,1': { object: tile('drink_fridge') },
  '10,1': { object: tile('potted_plant_monstera') },

  '1,2': { object: tile('coffee_counter_base') },
  '2,2': { object: tile('donut_box') },

  '5,3': { object: tile('couch_left') },
  '6,3': { object: tile('couch_center') },
  '7,3': { object: tile('couch_right') },

  '1,4': { object: tile('office_wastebin') },
  '6,4': { object: tile('coffee_table') },
});

export const ROOMS: readonly RoomDefinition[] = [
  {
    id: 'ceo',
    name: 'CEO Suite',
    icon: '👔',
    bounds: { x: 1, y: 1, width: 12, height: 7 },
    mainWaypoint: WAYPOINTS['ceo_desk'],
    doorWaypoint: WAYPOINTS['ceo_door'],
    waypoints: [
      WAYPOINTS['ceo_desk'],
      WAYPOINTS['ceo_board'],
      WAYPOINTS['ceo_door'],
    ],
    tiles: ceoTiles,
  },
  {
    id: 'hall',
    name: 'Flur',
    icon: '🚪',
    bounds: { x: 1, y: 8, width: 26, height: 3 },
    mainWaypoint: WAYPOINTS['hall_center'],
    doorWaypoint: WAYPOINTS['hall_center'],
    waypoints: [
      WAYPOINTS['hall_ceo_door'],
      WAYPOINTS['hall_qa_door'],
      WAYPOINTS['hall_west'],
      WAYPOINTS['hall_center'],
      WAYPOINTS['hall_east'],
      WAYPOINTS['hall_dev_door'],
      WAYPOINTS['hall_lounge_door'],
    ],
    tiles: hallTiles,
  },
  {
    id: 'dev',
    name: 'Dev Lab',
    icon: '💻',
    bounds: { x: 1, y: 11, width: 12, height: 7 },
    mainWaypoint: WAYPOINTS['dev_desk'],
    doorWaypoint: WAYPOINTS['dev_door'],
    waypoints: [
      WAYPOINTS['dev_desk'],
      WAYPOINTS['dev_meeting'],
      WAYPOINTS['dev_door'],
    ],
    tiles: devTiles,
  },
  {
    id: 'qa',
    name: 'QS Station',
    icon: '🔍',
    bounds: { x: 15, y: 1, width: 12, height: 7 },
    mainWaypoint: WAYPOINTS['qa_desk'],
    doorWaypoint: WAYPOINTS['qa_door'],
    waypoints: [
      WAYPOINTS['qa_desk'],
      WAYPOINTS['qa_servers'],
      WAYPOINTS['qa_door'],
    ],
    tiles: qaTiles,
  },
  {
    id: 'lounge',
    name: 'Lounge',
    icon: '☕',
    bounds: { x: 15, y: 11, width: 12, height: 7 },
    mainWaypoint: WAYPOINTS['lounge_couch'],
    doorWaypoint: WAYPOINTS['lounge_door'],
    waypoints: [
      WAYPOINTS['lounge_couch'],
      WAYPOINTS['lounge_coffee'],
      WAYPOINTS['lounge_door'],
    ],
    tiles: loungeTiles,
  },
] as const;

export const ROOM_SLOTS: Record<RoomId, readonly { x: number; y: number }[]> = {
  ceo: [
    { x: 4, y: 4 },
    { x: 12, y: 4 },
    { x: 1, y: 5 },
    { x: 6, y: 6 },
    { x: 8, y: 4 },
    { x: 2, y: 6 },
    { x: 10, y: 6 },
    { x: 5, y: 5 },
    { x: 9, y: 5 },
  ],
  hall: [
    { x: 4, y: 8 },
    { x: 11, y: 8 },
    { x: 18, y: 8 },
    { x: 6, y: 9 },
    { x: 13, y: 9 },
    { x: 20, y: 9 },
    { x: 4, y: 10 },
    { x: 11, y: 10 },
    { x: 18, y: 10 },
  ],
  dev: [
    { x: 6, y: 14 },
    { x: 10, y: 16 },
    { x: 3, y: 16 },
    { x: 3, y: 12 },
    { x: 2, y: 13 },
    { x: 2, y: 15 },
    { x: 9, y: 12 },
    { x: 7, y: 13 },
    { x: 7, y: 15 },
  ],
  qa: [
    { x: 18, y: 4 },
    { x: 22, y: 4 },
    { x: 19, y: 6 },
    { x: 15, y: 6 },
    { x: 21, y: 5 },
    { x: 24, y: 6 },
    { x: 26, y: 4 },
    { x: 16, y: 5 },
    { x: 25, y: 5 },
  ],
  lounge: [
    { x: 19, y: 12 },
    { x: 24, y: 12 },
    { x: 17, y: 14 },
    { x: 19, y: 15 },
    { x: 18, y: 13 },
    { x: 20, y: 16 },
    { x: 24, y: 15 },
    { x: 23, y: 13 },
    { x: 24, y: 14 },
  ],
};

export function getRoom(id: RoomId): RoomDefinition {
  const room = ROOMS.find((r) => r.id === id);
  if (!room) {
    throw new Error(`Room with ID "${id}" not found`);
  }
  return room;
}

const adjacencyList = new Map<string, string[]>();
for (const [u, v] of WAYPOINT_CONNECTIONS) {
  if (!adjacencyList.has(u)) adjacencyList.set(u, []);
  if (!adjacencyList.has(v)) adjacencyList.set(v, []);
  adjacencyList.get(u)!.push(v);
  adjacencyList.get(v)!.push(u);
}

export function findWaypointPath(
  startId: string,
  targetId: string,
): Waypoint[] {
  if (startId === targetId) {
    const wp = WAYPOINTS[startId];
    return wp ? [wp] : [];
  }

  const queue: string[] = [startId];
  const visited = new Set<string>([startId]);
  const parent = new Map<string, string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetId) {
      break;
    }
    const neighbors = adjacencyList.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }

  if (!parent.has(targetId)) {
    throw new Error(
      `No waypoint path found between "${startId}" and "${targetId}"`,
    );
  }

  const pathIds: string[] = [];
  let curr: string | undefined = targetId;
  while (curr) {
    pathIds.unshift(curr);
    curr = parent.get(curr);
  }

  return pathIds.map((id) => WAYPOINTS[id]);
}

export function getPathBetweenRooms(from: RoomId, to: RoomId): Waypoint[] {
  if (from === to) {
    return [getRoom(from).mainWaypoint];
  }
  const fromMain = getRoom(from).mainWaypoint;
  const toMain = getRoom(to).mainWaypoint;
  return findWaypointPath(fromMain.id, toMain.id);
}

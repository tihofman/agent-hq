export type RoomId = 'ceo' | 'hall' | 'dev' | 'qa' | 'lounge';

export const ROOM_IDS: readonly RoomId[] = [
  'ceo',
  'hall',
  'dev',
  'qa',
  'lounge',
] as const;

export const TILE_SIZE = 32;
export const GRID_WIDTH = 28;
export const GRID_HEIGHT = 19;
export const TOTAL_WIDTH_PX = GRID_WIDTH * TILE_SIZE;
export const TOTAL_HEIGHT_PX = GRID_HEIGHT * TILE_SIZE;

export interface RoomBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WaypointType = 'desk' | 'door' | 'hallway' | 'transit' | 'rest';

export interface Waypoint {
  id: string;
  roomId: RoomId;
  x: number;
  y: number;
  label: string;
  type: WaypointType;
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
  label: string;
  icon: string;
  bounds: RoomBounds;
  doorTile: { x: number; y: number };
  mainWaypoint: Waypoint;
  doorWaypoint: Waypoint;
  waypoints: Waypoint[];
  tiles: TileCell[];
}

export const WAYPOINTS: Record<string, Waypoint> = {
  // CEO Suite
  ceo_desk: {
    id: 'ceo_desk',
    roomId: 'ceo',
    x: 6,
    y: 4,
    label: 'Claude Executive Desk',
    type: 'desk',
  },
  ceo_board: {
    id: 'ceo_board',
    roomId: 'ceo',
    x: 9,
    y: 3,
    label: 'Architektur Whiteboard',
    type: 'desk',
  },
  ceo_door: {
    id: 'ceo_door',
    roomId: 'ceo',
    x: 6,
    y: 7,
    label: 'CEO Türschwelle',
    type: 'door',
  },

  // Flur & Übergabezone
  hall_ceo_door: {
    id: 'hall_ceo_door',
    roomId: 'hall',
    x: 6,
    y: 8,
    label: 'Flur CEO Eingang',
    type: 'door',
  },
  hall_qa_door: {
    id: 'hall_qa_door',
    roomId: 'hall',
    x: 20,
    y: 8,
    label: 'Flur QA Eingang',
    type: 'door',
  },
  hall_west: {
    id: 'hall_west',
    roomId: 'hall',
    x: 6,
    y: 9,
    label: 'Flur West-Kreuzung',
    type: 'hallway',
  },
  hall_center: {
    id: 'hall_center',
    roomId: 'hall',
    x: 13,
    y: 9,
    label: 'Übergabezone (Handover)',
    type: 'transit',
  },
  hall_east: {
    id: 'hall_east',
    roomId: 'hall',
    x: 20,
    y: 9,
    label: 'Flur Ost-Kreuzung',
    type: 'hallway',
  },
  hall_dev_door: {
    id: 'hall_dev_door',
    roomId: 'hall',
    x: 6,
    y: 10,
    label: 'Flur Dev Eingang',
    type: 'door',
  },
  hall_lounge_door: {
    id: 'hall_lounge_door',
    roomId: 'hall',
    x: 20,
    y: 10,
    label: 'Flur Lounge Eingang',
    type: 'door',
  },

  // Dev Lab
  dev_door: {
    id: 'dev_door',
    roomId: 'dev',
    x: 6,
    y: 11,
    label: 'Dev Lab Türschwelle',
    type: 'door',
  },
  dev_desk: {
    id: 'dev_desk',
    roomId: 'dev',
    x: 6,
    y: 14,
    label: 'Agy/Codex Workstation',
    type: 'desk',
  },
  dev_meeting: {
    id: 'dev_meeting',
    roomId: 'dev',
    x: 9,
    y: 14,
    label: 'Dev Besprechungstisch',
    type: 'desk',
  },

  // QA Station
  qa_desk: {
    id: 'qa_desk',
    roomId: 'qa',
    x: 20,
    y: 4,
    label: 'QA Review Station',
    type: 'desk',
  },
  qa_servers: {
    id: 'qa_servers',
    roomId: 'qa',
    x: 17,
    y: 4,
    label: 'Test Server Racks',
    type: 'desk',
  },
  qa_door: {
    id: 'qa_door',
    roomId: 'qa',
    x: 20,
    y: 7,
    label: 'QA Türschwelle',
    type: 'door',
  },

  // Lounge
  lounge_door: {
    id: 'lounge_door',
    roomId: 'lounge',
    x: 20,
    y: 11,
    label: 'Lounge Türschwelle',
    type: 'door',
  },
  lounge_couch: {
    id: 'lounge_couch',
    roomId: 'lounge',
    x: 20,
    y: 14,
    label: 'Lounge Sofa',
    type: 'rest',
  },
  lounge_coffee: {
    id: 'lounge_coffee',
    roomId: 'lounge',
    x: 17,
    y: 13,
    label: 'Espresso Bar',
    type: 'rest',
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
const ceoTiles = buildRoomTiles(12, 7, 0, {
  // localY = 0: Wall top molding & windows & architecture frame
  '0,0': { object: 14 }, // corner left
  '1,0': { object: 8 },
  '2,0': { object: 8 },
  '3,0': { object: 60 }, // window daylight
  '4,0': { object: 60 }, // window daylight
  '5,0': { object: 8 },
  '6,0': { object: 46 }, // framed architecture
  '7,0': { object: 8 },
  '8,0': { object: 60 }, // window daylight
  '9,0': { object: 60 }, // window daylight
  '10,0': { object: 8 },
  '11,0': { object: 15 }, // corner right

  // localY = 1: Drywall & upper objects
  '0,1': { object: 9 },
  '1,1': { object: 28 }, // bookshelf top
  '2,1': { object: 9 },
  '3,1': { object: 9 },
  '4,1': { object: 9 },
  '5,1': { object: 45 }, // wall clock
  '6,1': { object: 9 },
  '7,1': { object: 9 },
  '8,1': { object: 24 }, // whiteboard top left
  '9,1': { object: 25 }, // whiteboard top right
  '10,1': { object: 9 },
  '11,1': { object: 9 },

  // localY = 2: Baseboard & lower wall objects
  '0,2': { object: 10 },
  '1,2': { object: 29 }, // bookshelf bottom
  '2,2': { object: 10 },
  '3,2': { object: 10 },
  '4,2': { object: 10 },
  '5,2': { object: 10 },
  '6,2': { object: 10 },
  '7,2': { object: 10 },
  '8,2': { object: 26 }, // whiteboard bottom left
  '9,2': { object: 27 }, // whiteboard bottom right
  '10,2': { object: 10 },
  '11,2': { object: 10 },

  // localY = 3: Executive Desk & Props
  '1,3': { object: 30 }, // filing cabinet
  '4,3': { object: 16 }, // desk wood left
  '5,3': { object: 17 }, // desk wood center
  '6,3': { object: 18 }, // desk wood right
  '10,3': { object: 39 }, // potted plant monstera

  // localY = 4: Chairs & Accessories
  '3,4': { object: 31 }, // office wastebin
  '5,4': { object: 21 }, // chair ergonomic front
  '10,4': { object: 44 }, // potted succulent

  // localY = 6: Bottom wall & Door frame
  '0,6': { object: 9 },
  '1,6': { object: 9 },
  '2,6': { object: 9 },
  '3,6': { object: 9 },
  '4,6': { object: 9 },
  '5,6': { object: 48, floor: 7 }, // door frame top + welcome mat
  '6,6': { object: 9 },
  '7,6': { object: 9 },
  '8,6': { object: 9 },
  '9,6': { object: 9 },
  '10,6': { object: 9 },
  '11,6': { object: 9 },
});

// 2. QA Station (12x7, y=1..7)
const qaTiles = buildRoomTiles(12, 7, 5, {
  // localY = 0: Wall top molding & monitors
  '0,0': { object: 14 },
  '1,0': { object: 8 },
  '2,0': { object: 59 }, // trophy shelf
  '3,0': { object: 8 },
  '4,0': { object: 8 },
  '5,0': { object: 42 }, // qa dashboard wall top
  '6,0': { object: 42 },
  '7,0': { object: 8 },
  '8,0': { object: 60 },
  '9,0': { object: 60 },
  '10,0': { object: 8 },
  '11,0': { object: 15 },

  // localY = 1: Server top & QA screen bottom
  '0,1': { object: 9 },
  '1,1': { object: 40 }, // server rack top
  '2,1': { object: 40 }, // server rack top
  '3,1': { object: 9 },
  '4,1': { object: 9 },
  '5,1': { object: 43 }, // qa dashboard wall bottom
  '6,1': { object: 43 },
  '7,1': { object: 9 },
  '8,1': { object: 9 },
  '9,1': { object: 9 },
  '10,1': { object: 9 },
  '11,1': { object: 9 },

  // localY = 2: Baseboard & server rack bottom
  '0,2': { object: 10 },
  '1,2': { object: 41 }, // server rack bottom
  '2,2': { object: 41 }, // server rack bottom
  '3,2': { object: 10 },
  '4,2': { object: 10 },
  '5,2': { object: 10 },
  '6,2': { object: 10 },
  '7,2': { object: 10 },
  '8,2': { object: 10 },
  '9,2': { object: 10 },
  '10,2': { object: 10 },
  '11,2': { object: 10 },

  // localY = 3: QA Review desks
  '1,3': { object: 30 }, // filing cabinet
  '4,3': { object: 19 }, // desk tech monitors
  '5,3': { object: 20 }, // desk laptop coffee
  '6,3': { object: 23 }, // workstation pc tower
  '10,3': { object: 44 }, // succulent

  // localY = 4: Chairs
  '4,4': { object: 21 },
  '5,4': { object: 21 },
  '2,4': { object: 31 },

  // localY = 6: Bottom wall & Door frame
  '0,6': { object: 9 },
  '1,6': { object: 9 },
  '2,6': { object: 9 },
  '3,6': { object: 9 },
  '4,6': { object: 9 },
  '5,6': { object: 48, floor: 7 }, // door frame top + welcome mat
  '6,6': { object: 9 },
  '7,6': { object: 9 },
  '8,6': { object: 9 },
  '9,6': { object: 9 },
  '10,6': { object: 9 },
  '11,6': { object: 9 },
});

// 3. Hallway (26x3, y=8..10)
const hallTiles = buildRoomTiles(26, 3, 3, {
  // localY = 0: Entrances from CEO and QA
  '2,0': { object: 51 }, // hallway sign
  '5,0': { object: 49, floor: 7 }, // CEO doorway
  '12,0': { object: 62 }, // exit sign
  '19,0': { object: 49, floor: 7 }, // QA doorway
  '23,0': { object: 45 }, // wall clock

  // localY = 1: Center walking lane
  '10,1': { object: 50 }, // cable bridge
  '15,1': { object: 50 }, // cable bridge

  // localY = 2: Entrances to Dev and Lounge
  '5,2': { object: 48, floor: 7 }, // Dev doorway
  '19,2': { object: 48, floor: 7 }, // Lounge doorway
});

// 4. Dev Lab (12x7, y=11..17)
const devTiles = buildRoomTiles(12, 7, 2, {
  // localY = 0: Top wall with Doorway
  '0,0': { object: 9 },
  '1,0': { object: 9 },
  '2,0': { object: 9 },
  '3,0': { object: 9 },
  '4,0': { object: 9 },
  '5,0': { object: 49, floor: 7 }, // door frame bottom + welcome mat
  '6,0': { object: 9 },
  '7,0': { object: 9 },
  '8,0': { object: 9 },
  '9,0': { object: 9 },
  '10,0': { object: 9 },
  '11,0': { object: 9 },

  // localY = 1: Baseboard & walkway
  '0,1': { object: 10 },
  '11,1': { object: 10 },

  // localY = 2: Developer Workstations & Terminals
  '2,2': { object: 19 }, // desk tech monitors
  '3,2': { object: 19 }, // desk tech monitors
  '4,2': { object: 20 }, // desk laptop coffee
  '5,2': { object: 23 }, // pc tower
  '8,2': { object: 58 }, // retro crt terminal
  '9,2': { object: 30 }, // filing cabinet

  // localY = 3: Chairs & Pizza
  '1,3': { object: 31 }, // wastebin
  '2,3': { object: 21 }, // chair
  '3,3': { object: 21 }, // chair
  '4,3': { object: 21 }, // chair

  // localY = 4: Collaboration table & Pizza box
  '7,4': { object: 52 }, // meeting table tl
  '8,4': { object: 53 }, // meeting table tr
  '9,4': { object: 56 }, // pizza box open
  '10,4': { object: 44 }, // succulent

  // localY = 5: Meeting table bottom
  '7,5': { object: 54 }, // meeting table bl
  '8,5': { object: 55 }, // meeting table br

  // localY = 6: Bottom baseboard
  '0,6': { object: 10 },
  '1,6': { object: 10 },
  '2,6': { object: 10 },
  '3,6': { object: 10 },
  '4,6': { object: 10 },
  '5,6': { object: 10 },
  '6,6': { object: 10 },
  '7,6': { object: 10 },
  '8,6': { object: 10 },
  '9,6': { object: 10 },
  '10,6': { object: 10 },
  '11,6': { object: 10 },
});

// 5. Lounge / Breakroom (12x7, y=11..17)
const loungeTiles = buildRoomTiles(12, 7, 4, {
  // localY = 0: Top wall with Doorway
  '0,0': { object: 9 },
  '1,0': { object: 9 },
  '2,0': { object: 9 },
  '3,0': { object: 9 },
  '4,0': { object: 9 },
  '5,0': { object: 49, floor: 7 }, // door frame bottom + welcome mat
  '6,0': { object: 9 },
  '7,0': { object: 9 },
  '8,0': { object: 9 },
  '9,0': { object: 9 },
  '10,0': { object: 9 },
  '11,0': { object: 9 },

  // localY = 1: Kitchen corner & plants
  '1,1': { object: 36 }, // coffee counter machine
  '2,1': { object: 38 }, // water cooler
  '3,1': { object: 47 }, // drink fridge
  '10,1': { object: 39 }, // monstera plant

  // localY = 2: Counter base & Donut box
  '1,2': { object: 37 }, // coffee counter base
  '2,2': { object: 57 }, // donut box

  // localY = 3: Modular plush couch
  '5,3': { object: 32 }, // couch left
  '6,3': { object: 33 }, // couch center
  '7,3': { object: 34 }, // couch right

  // localY = 4: Coffee table
  '6,4': { object: 35 }, // coffee table
  '1,4': { object: 31 }, // wastebin

  // localY = 6: Bottom baseboard
  '0,6': { object: 10 },
  '1,6': { object: 10 },
  '2,6': { object: 10 },
  '3,6': { object: 10 },
  '4,6': { object: 10 },
  '5,6': { object: 10 },
  '6,6': { object: 10 },
  '7,6': { object: 10 },
  '8,6': { object: 10 },
  '9,6': { object: 10 },
  '10,6': { object: 10 },
  '11,6': { object: 10 },
});

export const ROOMS: readonly RoomDefinition[] = [
  {
    id: 'ceo',
    name: 'CEO Suite',
    label: 'Architect & Lead Office',
    icon: '👔',
    bounds: { x: 1, y: 1, width: 12, height: 7 },
    doorTile: { x: 6, y: 7 },
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
    label: 'Übergabezone & Korridor',
    icon: '🚪',
    bounds: { x: 1, y: 8, width: 26, height: 3 },
    doorTile: { x: 13, y: 9 },
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
    label: 'Entwickler Workstations',
    icon: '💻',
    bounds: { x: 1, y: 11, width: 12, height: 7 },
    doorTile: { x: 6, y: 11 },
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
    label: 'Review & Test Server',
    icon: '🔍',
    bounds: { x: 15, y: 1, width: 12, height: 7 },
    doorTile: { x: 20, y: 7 },
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
    label: 'Breakroom & Cooldown',
    icon: '☕',
    bounds: { x: 15, y: 11, width: 12, height: 7 },
    doorTile: { x: 20, y: 11 },
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

export function getRoom(id: RoomId): RoomDefinition {
  const room = ROOMS.find((r) => r.id === id);
  if (!room) {
    throw new Error(`Room with ID "${id}" not found`);
  }
  return room;
}

export function getAllRooms(): readonly RoomDefinition[] {
  return ROOMS;
}

export function isTileInRoom(x: number, y: number, roomId: RoomId): boolean {
  const room = getRoom(roomId);
  const { bounds } = room;
  return (
    x >= bounds.x &&
    x < bounds.x + bounds.width &&
    y >= bounds.y &&
    y < bounds.y + bounds.height
  );
}

export function doRoomsOverlap(): boolean {
  for (let i = 0; i < ROOMS.length; i++) {
    for (let j = i + 1; j < ROOMS.length; j++) {
      const a = ROOMS[i].bounds;
      const b = ROOMS[j].bounds;
      const overlapsX = a.x < b.x + b.width && a.x + a.width > b.x;
      const overlapsY = a.y < b.y + b.height && a.y + a.height > b.y;
      if (overlapsX && overlapsY) {
        return true;
      }
    }
  }
  return false;
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

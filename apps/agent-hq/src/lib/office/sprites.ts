import {
  findWaypointPath,
  WAYPOINTS,
  TILE_SIZE,
  TEAM_DESKS,
  type RoomId,
  type Team,
} from './layout';
import type {
  Agent,
  AgentStatus,
  Run,
  RunStatus,
  AgentState,
  TeamState,
} from '../server/state';
import claudeMeta from '../assets/sprites/claude.json';
import agyMeta from '../assets/sprites/agy.json';
import codexMeta from '../assets/sprites/codex.json';

export type CharacterStatus = AgentStatus | 'waiting_input';

export const TEAM_LEADS: Record<Team, Agent> = {
  frontend: 'agy',
  backend: 'claude',
  qa: 'codex',
};

export type Direction = 'down' | 'left' | 'right' | 'up';

export type AnimationName =
  | 'idle'
  | 'walk_down'
  | 'walk_left'
  | 'walk_right'
  | 'walk_up'
  | 'typing'
  | 'handover'
  | 'review'
  | 'cooldown';

export interface SpriteAnimationMeta {
  frames: number[];
  frameRate: number;
  loop: boolean;
  description?: string;
}

export interface SpriteMetadata {
  name: string;
  displayName: string;
  role: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  totalFrames: number;
  palette?: string;
  animations: Record<string, SpriteAnimationMeta>;
}

export interface SpeechBubble {
  type: 'testing' | 'review' | 'alert' | 'cooldown' | 'coding';
  text: string;
  icon?: string;
  tooltip?: string;
}

export interface InstanceOffset {
  dx: number;
  dy: number;
}

export interface Spot {
  wp: string;
  dx: number;
  dy: number;
  instanceOffsets?: readonly InstanceOffset[];
}

const METADATA_BY_AGENT: Record<Agent, SpriteMetadata> = {
  claude: claudeMeta as SpriteMetadata,
  agy: agyMeta as SpriteMetadata,
  codex: codexMeta as SpriteMetadata,
};

export function getSpriteMetadata(agent: Agent): SpriteMetadata {
  return METADATA_BY_AGENT[agent];
}

export function getDirection(
  from: { x: number; y: number },
  to: { x: number; y: number },
  fallback: Direction = 'down',
): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return fallback;
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  } else {
    return dy >= 0 ? 'down' : 'up';
  }
}

export function walkAnimationForDirection(
  dir: Direction,
): 'walk_down' | 'walk_left' | 'walk_right' | 'walk_up' {
  return `walk_${dir}`;
}

const STATUS_ANIMATION: Partial<Record<AgentStatus, AnimationName>> = {
  handover: 'handover',
  coding: 'typing',
  testing: 'typing',
  reviewing: 'review',
  cooldown: 'cooldown',
};

export function statusToAnimation(
  status: CharacterStatus,
  direction: Direction = 'down',
): AnimationName {
  if (status === 'walking') return walkAnimationForDirection(direction);
  if (status === 'waiting_input') return 'idle';
  return STATUS_ANIMATION[status] ?? 'idle';
}

export function getFrameIndex(
  anim: { frames: number[]; frameRate: number; loop?: boolean },
  elapsedMs: number,
): number {
  if (!anim.frames || anim.frames.length === 0) return 0;
  const frameDurationMs = 1000 / Math.max(1, anim.frameRate);
  const totalFrames = Math.floor(elapsedMs / frameDurationMs);
  if (anim.loop ?? true) {
    return anim.frames[totalFrames % anim.frames.length];
  } else {
    return anim.frames[Math.min(totalFrames, anim.frames.length - 1)];
  }
}

export function getFrameBackgroundPosition(
  frameIndex: number,
  columnsOrMeta:
    | number
    | { columns?: number; frameWidth?: number; frameHeight?: number } = 8,
  frameSize = TILE_SIZE,
): { x: number; y: number; css: string } {
  let columns: number;
  let width = frameSize;
  let height = frameSize;

  if (typeof columnsOrMeta === 'object' && columnsOrMeta !== null) {
    columns = columnsOrMeta.columns ?? 8;
    width = columnsOrMeta.frameWidth ?? TILE_SIZE;
    height = columnsOrMeta.frameHeight ?? width;
  } else {
    columns = columnsOrMeta;
  }

  const col = frameIndex % columns;
  const row = Math.floor(frameIndex / columns);
  const x = col * width;
  const y = row * height;
  return {
    x,
    y,
    css: `background-position: -${x}px -${y}px;`,
  };
}

export function formatCooldown(remainingMs: number): string {
  if (remainingMs <= 0) return 'Zzz (0s)';
  if (remainingMs >= 60000) {
    const mins = Math.ceil(remainingMs / 60000);
    return `Zzz (${mins}m)`;
  }
  const secs = Math.ceil(remainingMs / 1000);
  return `Zzz (${secs}s)`;
}

export function getSpeechBubble(
  status: CharacterStatus,
  options?: {
    ticketId?: string;
    title?: string;
    prNumber?: number;
    statusText?: string;
    cooldownUntil?: string;
    now?: number;
  },
): SpeechBubble | null {
  if (status === 'waiting_input') {
    return {
      type: 'alert',
      text: '?',
      icon: '❓',
      tooltip: options?.statusText || 'Rückfrage wartet auf Antwort',
    };
  }
  if (status === 'testing') {
    return {
      type: 'testing',
      text: options?.statusText || 'Testing...',
      icon: '⚙️',
    };
  }
  if (status === 'reviewing') {
    const target = options?.ticketId
      ? `#${options.ticketId}`
      : options?.prNumber
        ? `PR #${options.prNumber}`
        : '';
    return {
      type: 'review',
      text: target ? `Reviewing ${target}` : 'Reviewing...',
      icon: '🔍',
    };
  }
  if (status === 'errorAlert') {
    return {
      type: 'alert',
      text: '!',
      icon: '⚠️',
    };
  }
  if (status === 'cooldown' && options?.cooldownUntil) {
    const nowMs = options.now ?? Date.now();
    const untilMs = Date.parse(options.cooldownUntil);
    const remainingMs = Number.isFinite(untilMs) ? untilMs - nowMs : 0;
    return {
      type: 'cooldown',
      text: formatCooldown(remainingMs),
      icon: '💤',
    };
  }
  if (status === 'coding' || status === 'walking' || status === 'handover') {
    const rawTicket = options?.ticketId?.trim();
    if (rawTicket) {
      const ticket = rawTicket.startsWith('#') ? rawTicket : `#${rawTicket}`;
      const cleanTitle = options?.title?.trim();
      if (cleanTitle) {
        const MAX_TITLE_LEN = 32;
        const shortTitle =
          cleanTitle.length > MAX_TITLE_LEN
            ? `${cleanTitle.slice(0, MAX_TITLE_LEN - 1)}…`
            : cleanTitle;
        return {
          type: 'coding',
          text: `${ticket} ${shortTitle}`,
          tooltip: `${ticket} ${cleanTitle}`,
        };
      }
      return {
        type: 'coding',
        text: ticket,
      };
    }
    if (status === 'coding') {
      return {
        type: 'coding',
        text: 'Coding…',
      };
    }
  }
  return null;
}

const PX = TILE_SIZE / 32;

export const SPOTS: Record<Agent, Record<RoomId, Spot>> = {
  claude: {
    ceo: {
      wp: 'ceo_desk',
      dx: 0,
      dy: 0,
      instanceOffsets: [{ dx: 0, dy: 36 * PX }],
    },
    dev: {
      wp: 'dev_meeting',
      dx: -24 * PX,
      dy: 0,
      instanceOffsets: [{ dx: 0, dy: -36 * PX }],
    },
    qa: {
      wp: 'qa_servers',
      dx: 0,
      dy: 0,
      instanceOffsets: [{ dx: 0, dy: 36 * PX }],
    },
    lounge: {
      wp: 'lounge_couch',
      dx: -24 * PX,
      dy: 0,
      instanceOffsets: [{ dx: 0, dy: -36 * PX }],
    },
    hall: {
      wp: 'hall_center',
      dx: -24 * PX,
      dy: 0,
      instanceOffsets: [{ dx: 0, dy: 36 * PX }],
    },
  },
  agy: {
    ceo: {
      wp: 'ceo_board',
      dx: -24 * PX,
      dy: 0,
      instanceOffsets: [
        { dx: 0, dy: 36 * PX },
        { dx: -36 * PX, dy: 0 },
      ],
    },
    dev: {
      wp: 'dev_desk',
      dx: 0,
      dy: 0,
      instanceOffsets: [
        { dx: 0, dy: -36 * PX },
        { dx: -36 * PX, dy: 0 },
      ],
    },
    qa: {
      wp: 'qa_desk',
      dx: -24 * PX,
      dy: 0,
      instanceOffsets: [
        { dx: 0, dy: 36 * PX },
        { dx: -36 * PX, dy: 0 },
      ],
    },
    lounge: {
      wp: 'lounge_coffee',
      dx: 0,
      dy: 0,
      instanceOffsets: [
        { dx: 0, dy: -36 * PX },
        { dx: -36 * PX, dy: 0 },
      ],
    },
    hall: {
      wp: 'hall_center',
      dx: 24 * PX,
      dy: 0,
      instanceOffsets: [
        { dx: 0, dy: 36 * PX },
        { dx: 36 * PX, dy: 0 },
      ],
    },
  },
  codex: {
    ceo: {
      wp: 'ceo_board',
      dx: 24 * PX,
      dy: 0,
      instanceOffsets: [
        { dx: 0, dy: 36 * PX },
        { dx: 36 * PX, dy: 0 },
      ],
    },
    dev: {
      wp: 'dev_meeting',
      dx: 24 * PX,
      dy: 0,
      instanceOffsets: [
        { dx: 0, dy: -36 * PX },
        { dx: 36 * PX, dy: 0 },
      ],
    },
    qa: {
      wp: 'qa_desk',
      dx: 24 * PX,
      dy: 0,
      instanceOffsets: [
        { dx: 0, dy: 36 * PX },
        { dx: 36 * PX, dy: 0 },
      ],
    },
    lounge: {
      wp: 'lounge_couch',
      dx: 24 * PX,
      dy: 0,
      instanceOffsets: [
        { dx: 0, dy: -36 * PX },
        { dx: 36 * PX, dy: 0 },
      ],
    },
    hall: {
      wp: 'hall_east',
      dx: 0,
      dy: 0,
      instanceOffsets: [
        { dx: 0, dy: 36 * PX },
        { dx: 36 * PX, dy: 0 },
      ],
    },
  },
};

export function getAgentSpot(
  agent: Agent,
  room: RoomId,
  instanceIndex = 0,
): { x: number; y: number; wpId: string } {
  const spot = SPOTS[agent]?.[room] ?? { wp: 'hall_center', dx: 0, dy: 0 };
  const wp = WAYPOINTS[spot.wp] ?? WAYPOINTS['hall_center'];

  let extraDx = 0;
  let extraDy = 0;

  if (instanceIndex > 0) {
    if (spot.instanceOffsets && spot.instanceOffsets[instanceIndex - 1]) {
      extraDx = spot.instanceOffsets[instanceIndex - 1].dx;
      extraDy = spot.instanceOffsets[instanceIndex - 1].dy;
    } else {
      const step = Math.ceil(instanceIndex / 2);
      const sign = instanceIndex % 2 === 1 ? 1 : -1;
      extraDy = sign * step * 36 * PX;
    }
  }

  return {
    x: wp.x * TILE_SIZE + spot.dx + extraDx,
    y: wp.y * TILE_SIZE + spot.dy + extraDy,
    wpId: spot.wp,
  };
}

const TEAM_WORKER_OFFSETS: Record<Team, readonly InstanceOffset[]> = {
  frontend: [
    { dx: -36 * PX, dy: 0 },
    { dx: -72 * PX, dy: 0 },
    { dx: 0, dy: 36 * PX },
  ],
  backend: [
    { dx: 36 * PX, dy: 0 },
    { dx: -36 * PX, dy: 0 },
    { dx: 0, dy: 36 * PX },
  ],
  qa: [
    { dx: -36 * PX, dy: 0 },
    { dx: 36 * PX, dy: 0 },
    { dx: 0, dy: 36 * PX },
  ],
};

export function getTeamSpot(
  team: Team,
  instanceIndex = 0,
): { x: number; y: number; wpId: string } {
  const desk = TEAM_DESKS[team];
  const wp = WAYPOINTS[desk.waypointId] ?? WAYPOINTS['hall_center'];
  const off =
    instanceIndex > 0
      ? TEAM_WORKER_OFFSETS[team]?.[instanceIndex - 1]
      : undefined;

  return {
    x: wp.x * TILE_SIZE + (off?.dx ?? 0),
    y: wp.y * TILE_SIZE + (off?.dy ?? 0),
    wpId: desk.waypointId,
  };
}

export function doSpotsOverlap(
  posA: { x: number; y: number },
  posB: { x: number; y: number },
  size = TILE_SIZE,
): boolean {
  return Math.abs(posA.x - posB.x) < size && Math.abs(posA.y - posB.y) < size;
}

export interface Character {
  id: string;
  agent: Agent;
  runId?: string;
  instanceIndex: number;
  team?: Team;
  isTeamLead?: boolean;
}

export type OfficeCharacter = Character;

export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = [
  'handover',
  'running',
  'cooldown',
] as const;

export function deriveCharacters(
  state?: {
    runs?: Record<string, Run>;
    agents?: Record<Agent, AgentState>;
    teams?: Record<Team, TeamState>;
  } | null,
): Character[] {
  const agents: Agent[] = ['claude', 'agy', 'codex'];
  if (!state) {
    return agents.map((agent) => ({ id: agent, agent, instanceIndex: 0 }));
  }

  const runs = Object.values(state.runs ?? {});
  const activeSet = new Set<string>(ACTIVE_RUN_STATUSES);

  const baseCharacters = agents.flatMap((agent): Character[] => {
    const agentRuns = runs
      .filter((r) => r.agent === agent && activeSet.has(r.status))
      .sort(
        (a, b) =>
          (a.timestamp ?? '').localeCompare(b.timestamp ?? '') ||
          a.runId.localeCompare(b.runId),
      );

    if (agentRuns.length === 0) {
      return [{ id: agent, agent, instanceIndex: 0 }];
    }

    return agentRuns.map((run, index) => ({
      id: run.runId,
      agent,
      runId: run.runId,
      instanceIndex: index,
    }));
  });

  if (!state.teams) {
    return baseCharacters;
  }

  const teamLeads: Character[] = (['frontend', 'backend', 'qa'] as const).map(
    (team) => ({
      id: `team-lead-${team}`,
      agent: TEAM_LEADS[team],
      team,
      isTeamLead: true,
      instanceIndex: 0,
    }),
  );

  return [...baseCharacters, ...teamLeads];
}

export function getClosestWaypointId(pixelX: number, pixelY: number): string {
  let closestId = 'hall_center';
  let minDistance = Infinity;

  for (const [id, wp] of Object.entries(WAYPOINTS)) {
    const wpPx = wp.x * TILE_SIZE;
    const wpPy = wp.y * TILE_SIZE;
    const dist = Math.hypot(pixelX - wpPx, pixelY - wpPy);
    if (dist < minDistance) {
      minDistance = dist;
      closestId = id;
    }
  }

  return closestId;
}

export function interpolatePosition(
  from: { x: number; y: number },
  to: { x: number; y: number },
  distance: number,
): {
  position: { x: number; y: number };
  remainingDistance: number;
  arrived: boolean;
} {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const segLen = Math.hypot(dx, dy);

  if (segLen < 0.001 || distance >= segLen) {
    return {
      position: { x: to.x, y: to.y },
      remainingDistance: Math.max(0, distance - segLen),
      arrived: true,
    };
  }

  const ratio = distance / segLen;
  return {
    position: {
      x: from.x + dx * ratio,
      y: from.y + dy * ratio,
    },
    remainingDistance: 0,
    arrived: false,
  };
}

export type HandoverPhase =
  'idle' | 'walking_to_hall' | 'meeting' | 'walking_to_target';

export class AgentController {
  agent: Agent;
  instanceIndex: number;
  team?: Team;
  isTeamLead: boolean;
  x: number;
  y: number;
  direction: Direction = 'down';
  handoverPhase: HandoverPhase = 'idle';
  private path: { x: number; y: number }[] = [];
  private meetingElapsedMs = 0;
  private currentRoom: RoomId;
  private deferredRoom: RoomId | null = null;
  readonly walkSpeed = 3 * TILE_SIZE;

  constructor(
    agent: Agent,
    initialRoom: RoomId = 'lounge',
    instanceIndex = 0,
    team?: Team,
    isTeamLead = false,
  ) {
    this.agent = agent;
    this.instanceIndex = instanceIndex;
    this.team = team;
    this.isTeamLead = isTeamLead;
    this.currentRoom = initialRoom;
    const spot = this.getSpot(initialRoom);
    this.x = spot.x;
    this.y = spot.y;
  }

  getSpot(room: RoomId): { x: number; y: number; wpId: string } {
    if (this.team && room === TEAM_DESKS[this.team].roomId) {
      return getTeamSpot(this.team, this.instanceIndex);
    }
    return getAgentSpot(this.agent, room, this.instanceIndex);
  }

  startHandover(): void {
    if (this.isTeamLead) return;
    this.handoverPhase = 'walking_to_hall';
    this.meetingElapsedMs = 0;
    const hallSpot = getAgentSpot(this.agent, 'hall', this.instanceIndex);
    this.walkTo(hallSpot.x, hallSpot.y, hallSpot.wpId);
  }

  setTargetRoom(room: RoomId): void {
    if (this.isTeamLead) {
      this.snapToRoom(room);
      return;
    }
    if (
      this.handoverPhase === 'walking_to_hall' ||
      this.handoverPhase === 'meeting'
    ) {
      this.deferredRoom = room;
      return;
    }
    const spot = this.getSpot(room);
    if (
      room === this.currentRoom &&
      this.path.length === 0 &&
      this.handoverPhase === 'idle'
    ) {
      if (Math.hypot(this.x - spot.x, this.y - spot.y) < 1) {
        return;
      }
    }
    this.currentRoom = room;
    this.walkTo(spot.x, spot.y, spot.wpId);
  }

  snapToRoom(room: RoomId): void {
    this.currentRoom = room;
    this.deferredRoom = null;
    this.handoverPhase = 'idle';
    this.path = [];
    const spot = this.getSpot(room);
    this.x = spot.x;
    this.y = spot.y;
    this.direction = 'down';
  }

  private walkTo(targetX: number, targetY: number, targetWpId: string): void {
    const startWpId = getClosestWaypointId(this.x, this.y);
    const wpPath = findWaypointPath(startWpId, targetWpId);
    if (wpPath.length === 0) {
      this.x = targetX;
      this.y = targetY;
      this.path = [];
      return;
    }
    this.path = wpPath.map((wp, i) => {
      const isFinal = i === wpPath.length - 1;
      return {
        x: isFinal ? targetX : wp.x * TILE_SIZE,
        y: isFinal ? targetY : wp.y * TILE_SIZE,
      };
    });
  }

  tick(
    dt: number,
    stateStatus: CharacterStatus,
    stateRoom: RoomId,
  ): {
    x: number;
    y: number;
    direction: Direction;
    animation: AnimationName;
    isWalking: boolean;
  } {
    if (this.path.length > 0) {
      let moveDist = this.walkSpeed * dt;
      while (moveDist > 0 && this.path.length > 0) {
        const nextTarget = this.path[0];
        this.direction = getDirection(
          { x: this.x, y: this.y },
          nextTarget,
          this.direction,
        );
        const step = interpolatePosition(
          { x: this.x, y: this.y },
          nextTarget,
          moveDist,
        );
        this.x = step.position.x;
        this.y = step.position.y;
        moveDist = step.remainingDistance;

        if (step.arrived) {
          this.path.shift();
        } else {
          break;
        }
      }
    }

    if (this.handoverPhase === 'walking_to_hall') {
      if (this.path.length === 0) {
        this.handoverPhase = 'meeting';
        this.meetingElapsedMs = 0;
        this.direction = this.agent === 'claude' ? 'right' : 'left';
      }
    } else if (this.handoverPhase === 'meeting') {
      this.direction = this.agent === 'claude' ? 'right' : 'left';
      this.meetingElapsedMs += dt * 1000;
      if (this.meetingElapsedMs >= 1500) {
        this.handoverPhase = 'walking_to_target';
        const targetRoom = this.deferredRoom ?? stateRoom ?? this.currentRoom;
        this.deferredRoom = null;
        this.currentRoom = targetRoom;
        const targetSpot = this.getSpot(targetRoom);
        this.walkTo(targetSpot.x, targetSpot.y, targetSpot.wpId);
      }
    } else if (this.handoverPhase === 'walking_to_target') {
      if (this.path.length === 0) {
        this.handoverPhase = 'idle';
      }
    }

    const isWalking = this.path.length > 0;

    let animation: AnimationName;
    if (isWalking) {
      animation = walkAnimationForDirection(this.direction);
    } else if (this.handoverPhase === 'meeting') {
      animation = 'handover';
    } else {
      animation = statusToAnimation(stateStatus, this.direction);
    }

    return {
      x: this.x,
      y: this.y,
      direction: this.direction,
      animation,
      isWalking,
    };
  }
}

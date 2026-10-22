import {
  findWaypointPath,
  WAYPOINTS,
  TILE_SIZE,
  type RoomId,
  type Waypoint,
} from './layout';
import type { Agent, AgentStatus } from '../server/state';
import claudeMeta from '../assets/sprites/claude.json';
import agyMeta from '../assets/sprites/agy.json';
import codexMeta from '../assets/sprites/codex.json';

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
  | 'cooldown'
  | 'alert'
  | 'success';

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
  type: 'testing' | 'review' | 'alert' | 'cooldown';
  text: string;
  icon?: string;
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

export function statusToAnimation(
  status: AgentStatus,
  direction: Direction = 'down',
): AnimationName {
  switch (status) {
    case 'idle':
      return 'idle';
    case 'walking':
      return walkAnimationForDirection(direction);
    case 'handover':
      return 'handover';
    case 'coding':
      return 'typing';
    case 'testing':
      return 'typing';
    case 'reviewing':
      return 'review';
    case 'errorAlert':
      return 'idle';
    case 'cooldown':
      return 'cooldown';
    default:
      return 'idle';
  }
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
  columns = 8,
  frameSize = 32,
): { x: number; y: number; css: string } {
  const col = frameIndex % columns;
  const row = Math.floor(frameIndex / columns);
  const x = col * frameSize;
  const y = row * frameSize;
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
  status: AgentStatus,
  options?: {
    ticketId?: string;
    statusText?: string;
    cooldownUntil?: string;
    now?: number;
  },
): SpeechBubble | null {
  if (status === 'testing') {
    return {
      type: 'testing',
      text: options?.statusText || 'Testing...',
      icon: '⚙️',
    };
  }
  if (status === 'reviewing') {
    const ticket = options?.ticketId ? `#${options.ticketId}` : '';
    return {
      type: 'review',
      text: ticket ? `Reviewing ${ticket}` : 'Reviewing...',
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
  return null;
}

export function getAgentTargetWaypointId(
  agent: Agent,
  room: RoomId,
  isHandover = false,
): string {
  if (isHandover && room === 'hall') {
    return 'hall_center';
  }
  switch (room) {
    case 'ceo':
      return agent === 'claude' ? 'ceo_desk' : 'ceo_board';
    case 'dev':
      return agent === 'agy' ? 'dev_desk' : 'dev_meeting';
    case 'qa':
      return agent === 'claude' ? 'qa_servers' : 'qa_desk';
    case 'lounge':
      return agent === 'agy' ? 'lounge_coffee' : 'lounge_couch';
    case 'hall':
      return 'hall_center';
    default:
      return 'hall_center';
  }
}

export function getAgentRoomOffset(
  agent: Agent,
  room: RoomId,
  isHandover = false,
): { x: number; y: number } {
  if (isHandover && room === 'hall') {
    if (agent === 'claude') {
      return { x: -16, y: 0 };
    }
    return { x: 16, y: 0 };
  }
  if (room === 'lounge' && agent === 'codex') {
    return { x: 20, y: 0 };
  }
  return { x: 0, y: 0 };
}

export function findPathBetweenWaypoints(
  startWaypointId: string,
  targetWaypointId: string,
): Waypoint[] {
  if (startWaypointId === targetWaypointId) {
    const wp = WAYPOINTS[startWaypointId];
    return wp ? [wp] : [];
  }
  return findWaypointPath(startWaypointId, targetWaypointId);
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

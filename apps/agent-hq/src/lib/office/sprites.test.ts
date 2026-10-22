import { describe, expect, it } from 'vitest';
import {
  formatCooldown,
  getDirection,
  getFrameBackgroundPosition,
  getFrameIndex,
  getSpeechBubble,
  getSpriteMetadata,
  interpolatePosition,
  statusToAnimation,
  walkAnimationForDirection,
  getAgentTargetWaypointId,
  getAgentRoomOffset,
  findPathBetweenWaypoints,
  getClosestWaypointId,
} from './sprites';
import { WAYPOINTS, TILE_SIZE } from './layout';

describe('office/sprites', () => {
  describe('Metadata and assets', () => {
    it.each(['claude', 'agy', 'codex'] as const)(
      'provides valid sprite metadata for agent %s',
      (agent) => {
        const meta = getSpriteMetadata(agent);
        expect(meta.name).toBe(agent);
        expect(meta.frameWidth).toBe(32);
        expect(meta.frameHeight).toBe(32);
        expect(meta.columns).toBe(8);
        expect(meta.rows).toBe(4);
        expect(meta.totalFrames).toBe(32);

        // Required animations per acceptance criteria
        const requiredAnims = [
          'idle',
          'walk_down',
          'walk_left',
          'walk_right',
          'walk_up',
          'typing',
          'handover',
          'review',
          'cooldown',
        ];
        for (const anim of requiredAnims) {
          expect(meta.animations[anim]).toBeDefined();
          expect(meta.animations[anim].frames.length).toBeGreaterThan(0);
          expect(meta.animations[anim].frameRate).toBeGreaterThan(0);
        }
      },
    );
  });

  describe('Direction and Animation mappings', () => {
    it('determines primary direction correctly', () => {
      expect(getDirection({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe('right');
      expect(getDirection({ x: 10, y: 0 }, { x: 0, y: 0 })).toBe('left');
      expect(getDirection({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe('down');
      expect(getDirection({ x: 0, y: 10 }, { x: 0, y: 0 })).toBe('up');

      // Diagonal tie-breaker (prefers horizontal when dx >= dy)
      expect(getDirection({ x: 0, y: 0 }, { x: 10, y: 10 })).toBe('right');
      expect(getDirection({ x: 10, y: 0 }, { x: 0, y: 10 })).toBe('left');

      // Zero delta returns fallback
      expect(getDirection({ x: 5, y: 5 }, { x: 5, y: 5 }, 'up')).toBe('up');
    });

    it('maps direction to walk animation name', () => {
      expect(walkAnimationForDirection('down')).toBe('walk_down');
      expect(walkAnimationForDirection('left')).toBe('walk_left');
      expect(walkAnimationForDirection('right')).toBe('walk_right');
      expect(walkAnimationForDirection('up')).toBe('walk_up');
    });

    it('maps agent status to correct animation', () => {
      expect(statusToAnimation('idle')).toBe('idle');
      expect(statusToAnimation('walking', 'up')).toBe('walk_up');
      expect(statusToAnimation('walking', 'left')).toBe('walk_left');
      expect(statusToAnimation('handover')).toBe('handover');
      expect(statusToAnimation('coding')).toBe('typing');
      expect(statusToAnimation('testing')).toBe('typing');
      expect(statusToAnimation('reviewing')).toBe('review');
      expect(statusToAnimation('errorAlert')).toBe('idle');
      expect(statusToAnimation('cooldown')).toBe('cooldown');
    });
  });

  describe('Frame selection and CSS positioning', () => {
    it('calculates frame index over time with loop=true', () => {
      const anim = { frames: [0, 1, 2, 3], frameRate: 4, loop: true };
      // 4 fps = 250ms per frame
      expect(getFrameIndex(anim, 0)).toBe(0);
      expect(getFrameIndex(anim, 249)).toBe(0);
      expect(getFrameIndex(anim, 250)).toBe(1);
      expect(getFrameIndex(anim, 500)).toBe(2);
      expect(getFrameIndex(anim, 750)).toBe(3);
      expect(getFrameIndex(anim, 1000)).toBe(0); // Loops around
      expect(getFrameIndex(anim, 1250)).toBe(1);
    });

    it('calculates frame index over time with loop=false (clamps at end)', () => {
      const anim = { frames: [23, 24], frameRate: 2, loop: false };
      // 2 fps = 500ms per frame
      expect(getFrameIndex(anim, 0)).toBe(23);
      expect(getFrameIndex(anim, 499)).toBe(23);
      expect(getFrameIndex(anim, 500)).toBe(24);
      expect(getFrameIndex(anim, 2000)).toBe(24); // Clamped at last frame
    });

    it('handles empty frames gracefully', () => {
      expect(getFrameIndex({ frames: [], frameRate: 4 }, 100)).toBe(0);
    });

    it('computes correct background position for sprite sheet frames', () => {
      expect(getFrameBackgroundPosition(0)).toEqual({
        x: 0,
        y: 0,
        css: 'background-position: -0px -0px;',
      });
      expect(getFrameBackgroundPosition(7)).toEqual({
        x: 224,
        y: 0,
        css: 'background-position: -224px -0px;',
      });
      expect(getFrameBackgroundPosition(8)).toEqual({
        x: 0,
        y: 32,
        css: 'background-position: -0px -32px;',
      });
      expect(getFrameBackgroundPosition(23)).toEqual({
        x: 224,
        y: 64,
        css: 'background-position: -224px -64px;',
      });
      expect(getFrameBackgroundPosition(24)).toEqual({
        x: 0,
        y: 96,
        css: 'background-position: -0px -96px;',
      });
      expect(getFrameBackgroundPosition(31)).toEqual({
        x: 224,
        y: 96,
        css: 'background-position: -224px -96px;',
      });
    });
  });

  describe('Speech bubbles and cooldown format', () => {
    it('formats cooldown durations properly', () => {
      expect(formatCooldown(0)).toBe('Zzz (0s)');
      expect(formatCooldown(-100)).toBe('Zzz (0s)');
      expect(formatCooldown(5000)).toBe('Zzz (5s)');
      expect(formatCooldown(45000)).toBe('Zzz (45s)');
      expect(formatCooldown(60000)).toBe('Zzz (1m)');
      expect(formatCooldown(1320000)).toBe('Zzz (22m)');
    });

    it('generates speech bubbles for relevant statuses', () => {
      // Testing bubble
      expect(getSpeechBubble('testing')).toEqual({
        type: 'testing',
        text: 'Testing...',
        icon: '⚙️',
      });
      expect(
        getSpeechBubble('testing', { statusText: 'Vitest running...' }),
      ).toEqual({
        type: 'testing',
        text: 'Vitest running...',
        icon: '⚙️',
      });

      // Review bubble
      expect(getSpeechBubble('reviewing')).toEqual({
        type: 'review',
        text: 'Reviewing...',
        icon: '🔍',
      });
      expect(getSpeechBubble('reviewing', { ticketId: '12' })).toEqual({
        type: 'review',
        text: 'Reviewing #12',
        icon: '🔍',
      });

      // Error alert bubble
      expect(getSpeechBubble('errorAlert')).toEqual({
        type: 'alert',
        text: '!',
        icon: '⚠️',
      });

      // Cooldown bubble
      const now = 1761150000000;
      const cooldownUntil = new Date(now + 120000).toISOString();
      expect(getSpeechBubble('cooldown', { cooldownUntil, now })).toEqual({
        type: 'cooldown',
        text: 'Zzz (2m)',
        icon: '💤',
      });

      // Idle and coding have no speech bubble
      expect(getSpeechBubble('idle')).toBeNull();
      expect(getSpeechBubble('coding')).toBeNull();
      expect(getSpeechBubble('walking')).toBeNull();
    });
  });

  describe('Waypoints, target assignments and pathfinding', () => {
    it('assigns appropriate targets per agent and room', () => {
      expect(getAgentTargetWaypointId('claude', 'ceo')).toBe('ceo_desk');
      expect(getAgentTargetWaypointId('agy', 'dev')).toBe('dev_desk');
      expect(getAgentTargetWaypointId('codex', 'dev')).toBe('dev_meeting');
      expect(getAgentTargetWaypointId('agy', 'lounge')).toBe('lounge_coffee');
      expect(getAgentTargetWaypointId('claude', 'lounge')).toBe('lounge_couch');
      expect(getAgentTargetWaypointId('codex', 'lounge')).toBe('lounge_couch');
    });

    it('assigns handover hallway offsets properly', () => {
      expect(getAgentRoomOffset('claude', 'hall', true)).toEqual({
        x: -16,
        y: 0,
      });
      expect(getAgentRoomOffset('agy', 'hall', true)).toEqual({
        x: 16,
        y: 0,
      });
      expect(getAgentRoomOffset('codex', 'lounge', false)).toEqual({
        x: 20,
        y: 0,
      });
      expect(getAgentRoomOffset('claude', 'ceo', false)).toEqual({
        x: 0,
        y: 0,
      });
    });

    it('finds path between waypoints across rooms', () => {
      const path = findPathBetweenWaypoints('lounge_coffee', 'dev_desk');
      expect(path.length).toBeGreaterThan(2);
      expect(path[0].id).toBe('lounge_coffee');
      expect(path[path.length - 1].id).toBe('dev_desk');

      // Traversing hallway
      const hallWaypoints = path.filter((wp) => wp.roomId === 'hall');
      expect(hallWaypoints.length).toBeGreaterThan(0);
    });

    it('returns single waypoint when start and target are identical', () => {
      const path = findPathBetweenWaypoints('dev_desk', 'dev_desk');
      expect(path).toHaveLength(1);
      expect(path[0].id).toBe('dev_desk');
    });

    it('identifies the closest waypoint to given pixel coordinates', () => {
      const deskWp = WAYPOINTS['dev_desk'];
      const closest = getClosestWaypointId(
        deskWp.x * TILE_SIZE + 4,
        deskWp.y * TILE_SIZE + 4,
      );
      expect(closest).toBe('dev_desk');
    });
  });

  describe('Position interpolation', () => {
    it('interpolates point along vector towards target', () => {
      const from = { x: 0, y: 0 };
      const to = { x: 100, y: 0 };
      const step = interpolatePosition(from, to, 40);
      expect(step.position.x).toBeCloseTo(40);
      expect(step.position.y).toBeCloseTo(0);
      expect(step.remainingDistance).toBe(0);
      expect(step.arrived).toBe(false);
    });

    it('stops exactly at target when distance exceeds segment length', () => {
      const from = { x: 0, y: 0 };
      const to = { x: 100, y: 0 };
      const step = interpolatePosition(from, to, 120);
      expect(step.position.x).toBe(100);
      expect(step.position.y).toBe(0);
      expect(step.remainingDistance).toBeCloseTo(20);
      expect(step.arrived).toBe(true);
    });

    it('handles identical points without error', () => {
      const from = { x: 50, y: 50 };
      const to = { x: 50, y: 50 };
      const step = interpolatePosition(from, to, 10);
      expect(step.position).toEqual({ x: 50, y: 50 });
      expect(step.remainingDistance).toBe(10);
      expect(step.arrived).toBe(true);
    });
  });
});

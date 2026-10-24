import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error pngjs lacks bundled TypeScript type declarations
import { PNG } from 'pngjs';
import officeTilesData from '../assets/tilesets/office_tiles.json';
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
  SPOTS,
  getAgentSpot,
  getClosestWaypointId,
  AgentController,
  deriveCharacters,
  doSpotsOverlap,
  ACTIVE_RUN_STATUSES,
  TEAM_LEADS,
  getTeamSpot,
} from './sprites';
import {
  WAYPOINTS,
  TILE_SIZE,
  ROOM_IDS,
  findWaypointPath,
  TEAMS,
  type RoomId,
} from './layout';
import type { Agent, AgentStatus } from '../server/state';

describe('office/sprites', () => {
  describe('Metadata and assets', () => {
    it.each(['claude', 'agy', 'codex'] as const)(
      'provides valid sprite metadata for agent %s',
      (agent) => {
        const meta = getSpriteMetadata(agent);
        expect(meta.name).toBe(agent);
        expect(meta.frameWidth).toBe(128);
        expect(meta.frameHeight).toBe(128);
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

    it.each(['claude', 'agy', 'codex'] as const)(
      'verifies spritesheet PNG dimensions (1024x512) for %s',
      (agent) => {
        const pngPath = path.resolve(
          __dirname,
          `../assets/sprites/${agent}.png`,
        );
        const buffer = fs.readFileSync(pngPath);
        const png = PNG.sync.read(buffer);
        expect(png.width).toBe(1024);
        expect(png.height).toBe(512);
      },
    );

    it('verifies that character sprite frames are not composed of uniform 4x4 pixel blocks (not a naive 4x upscale)', () => {
      // In a naive 4x upscale of a 32x32 image to 128x128, 100% of the 4x4 blocks are uniform
      // (every 4x4 block has 16 identical pixels). In detailed 128x128 pixel art, frames contain
      // substantial intra-block pixel variation (lines, eyes, hair highlights, folds, shading).
      for (const agent of ['claude', 'agy', 'codex'] as const) {
        const pngPath = path.resolve(
          __dirname,
          `../assets/sprites/${agent}.png`,
        );
        const png = PNG.sync.read(fs.readFileSync(pngPath));

        let nonUniform4x4Blocks = 0;
        // Check Frame 0 (x: 0..127, y: 0..127)
        for (let by = 0; by < 32; by++) {
          for (let bx = 0; bx < 32; bx++) {
            const x0 = bx * 4;
            const y0 = by * 4;
            const baseIdx = (y0 * png.width + x0) * 4;
            let isUniform = true;

            for (let dy = 0; dy < 4; dy++) {
              for (let dx = 0; dx < 4; dx++) {
                const idx = ((y0 + dy) * png.width + (x0 + dx)) * 4;
                if (
                  png.data[idx] !== png.data[baseIdx] ||
                  png.data[idx + 1] !== png.data[baseIdx + 1] ||
                  png.data[idx + 2] !== png.data[baseIdx + 2] ||
                  png.data[idx + 3] !== png.data[baseIdx + 3]
                ) {
                  isUniform = false;
                  break;
                }
              }
              if (!isUniform) break;
            }

            if (!isUniform) {
              nonUniform4x4Blocks++;
            }
          }
        }

        // Frame must have numerous non-uniform 4x4 blocks proving sub-block detail
        expect(nonUniform4x4Blocks).toBeGreaterThan(50);
      }
    });

    it('verifies office tileset PNG is 1024x1024 and office_tiles.json reports 128x128 tile size', () => {
      const tilesetPath = path.resolve(
        __dirname,
        '../assets/tilesets/office_tiles.png',
      );
      const png = PNG.sync.read(fs.readFileSync(tilesetPath));
      expect(png.width).toBe(1024);
      expect(png.height).toBe(1024);
      expect(officeTilesData.tileWidth).toBe(128);
      expect(officeTilesData.tileHeight).toBe(128);
      expect(officeTilesData.columns).toBe(8);
      expect(officeTilesData.rows).toBe(8);
      expect(officeTilesData.totalTiles).toBe(64);
    });
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

    it('maps agent status to correct animation via Record lookup', () => {
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
        x: 896,
        y: 0,
        css: 'background-position: -896px -0px;',
      });
      expect(getFrameBackgroundPosition(8)).toEqual({
        x: 0,
        y: 128,
        css: 'background-position: -0px -128px;',
      });
      expect(getFrameBackgroundPosition(23)).toEqual({
        x: 896,
        y: 256,
        css: 'background-position: -896px -256px;',
      });
      expect(getFrameBackgroundPosition(24)).toEqual({
        x: 0,
        y: 384,
        css: 'background-position: -0px -384px;',
      });
      expect(getFrameBackgroundPosition(31)).toEqual({
        x: 896,
        y: 384,
        css: 'background-position: -896px -384px;',
      });
    });

    it('supports sheet geometry from metadata', () => {
      const meta = { columns: 8, frameWidth: 128, frameHeight: 128 };
      expect(getFrameBackgroundPosition(9, meta)).toEqual({
        x: 128,
        y: 128,
        css: 'background-position: -128px -128px;',
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

      // Review bubble with ticketId
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

      // Review bubble with activePR fallback (Item 4)
      expect(getSpeechBubble('reviewing', { prNumber: 44 })).toEqual({
        type: 'review',
        text: 'Reviewing PR #44',
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

      // Idle has no speech bubble; walking and handover without ticketId have none
      expect(getSpeechBubble('idle')).toBeNull();
      expect(getSpeechBubble('walking')).toBeNull();
      expect(getSpeechBubble('handover')).toBeNull();

      // Coding without ticketId shows generic bubble
      expect(getSpeechBubble('coding')).toEqual({
        type: 'coding',
        text: 'Coding…',
      });
    });

    it('generates task bubble for coding with ticketId only (#<ticketId>)', () => {
      expect(getSpeechBubble('coding', { ticketId: '75' })).toEqual({
        type: 'coding',
        text: '#75',
      });
      // Already prefixed with #
      expect(getSpeechBubble('coding', { ticketId: '#75' })).toEqual({
        type: 'coding',
        text: '#75',
      });
    });

    it('generates task bubble with title, truncating at max 32 chars with ellipsis and full text in tooltip', () => {
      // Short title (<= 32 chars) stays unshortened
      const shortTitle = 'Fix speech bubble bug';
      expect(
        getSpeechBubble('coding', { ticketId: '75', title: shortTitle }),
      ).toEqual({
        type: 'coding',
        text: `#75 ${shortTitle}`,
        tooltip: `#75 ${shortTitle}`,
      });

      // Exactly 32 chars: stays unshortened
      const title32 = '12345678901234567890123456789012';
      expect(title32.length).toBe(32);
      expect(
        getSpeechBubble('coding', { ticketId: '75', title: title32 }),
      ).toEqual({
        type: 'coding',
        text: `#75 ${title32}`,
        tooltip: `#75 ${title32}`,
      });

      // 33 chars: truncated to 31 chars + … (length 32)
      const title33 = '123456789012345678901234567890123';
      const truncated32 = '1234567890123456789012345678901…';
      expect(truncated32.length).toBe(32);
      expect(
        getSpeechBubble('coding', { ticketId: '75', title: title33 }),
      ).toEqual({
        type: 'coding',
        text: `#75 ${truncated32}`,
        tooltip: `#75 ${title33}`,
      });

      // Long realistic title
      const longTitle = 'Sprechblase mit aktuellem Task über dem Character';
      const expectedShort = `${longTitle.slice(0, 31)}…`;
      expect(expectedShort.length).toBe(32);
      expect(
        getSpeechBubble('coding', { ticketId: '78', title: longTitle }),
      ).toEqual({
        type: 'coding',
        text: `#78 ${expectedShort}`,
        tooltip: `#78 ${longTitle}`,
      });
    });

    it('shows task bubble during walking and handover when ticketId is known', () => {
      expect(getSpeechBubble('walking', { ticketId: '75' })).toEqual({
        type: 'coding',
        text: '#75',
      });
      expect(
        getSpeechBubble('walking', { ticketId: '75', title: 'Walk to dev' }),
      ).toEqual({
        type: 'coding',
        text: '#75 Walk to dev',
        tooltip: '#75 Walk to dev',
      });
      expect(getSpeechBubble('handover', { ticketId: '75' })).toEqual({
        type: 'coding',
        text: '#75',
      });
      expect(
        getSpeechBubble('handover', {
          ticketId: '75',
          title: 'Handover to worker',
        }),
      ).toEqual({
        type: 'coding',
        text: '#75 Handover to worker',
        tooltip: '#75 Handover to worker',
      });
    });

    it('returns generic text for coding when ticketId is missing, even if title is provided', () => {
      expect(getSpeechBubble('coding', { title: 'Some title' })).toEqual({
        type: 'coding',
        text: 'Coding…',
      });
    });

    it('preserves precedence for testing, reviewing, errorAlert and cooldown over ticket bubble', () => {
      const opts = {
        ticketId: '75',
        title: 'Some feature task',
      };

      // Testing bubble has precedence
      expect(getSpeechBubble('testing', opts)).toEqual({
        type: 'testing',
        text: 'Testing...',
        icon: '⚙️',
      });

      // Reviewing bubble has precedence
      expect(getSpeechBubble('reviewing', opts)).toEqual({
        type: 'review',
        text: 'Reviewing #75',
        icon: '🔍',
      });

      // Error alert bubble has precedence
      expect(getSpeechBubble('errorAlert', opts)).toEqual({
        type: 'alert',
        text: '!',
        icon: '⚠️',
      });

      // Cooldown bubble has precedence
      const now = 1761150000000;
      const cooldownUntil = new Date(now + 60000).toISOString();
      expect(
        getSpeechBubble('cooldown', { ...opts, cooldownUntil, now }),
      ).toEqual({
        type: 'cooldown',
        text: 'Zzz (1m)',
        icon: '💤',
      });
    });

    it('resolves distinct speech bubbles for parallel runs with their own ticket IDs', () => {
      const run1 = { ticketId: '75', title: 'Feature Alpha' };
      const run2 = { ticketId: '76', title: 'Bugfix Beta' };

      const bubble1 = getSpeechBubble('coding', run1);
      const bubble2 = getSpeechBubble('coding', run2);

      expect(bubble1).toEqual({
        type: 'coding',
        text: '#75 Feature Alpha',
        tooltip: '#75 Feature Alpha',
      });
      expect(bubble2).toEqual({
        type: 'coding',
        text: '#76 Bugfix Beta',
        tooltip: '#76 Bugfix Beta',
      });
      expect(bubble1?.text).not.toBe(bubble2?.text);
    });
  });

  describe('Waypoints, SPOTS table and pairwise distance', () => {
    it('defines spots for every agent in every room', () => {
      const agents: Agent[] = ['claude', 'agy', 'codex'];
      for (const room of ROOM_IDS) {
        for (const agent of agents) {
          const spot = SPOTS[agent]?.[room];
          expect(spot).toBeDefined();
          expect(WAYPOINTS[spot.wp]).toBeDefined();
        }
      }
    });

    it('guarantees pairwise distance >= 40 px between all agents in every room', () => {
      const agents: Agent[] = ['claude', 'agy', 'codex'];
      for (const room of ROOM_IDS) {
        const positions = agents.map((agent) => getAgentSpot(agent, room));
        for (let i = 0; i < positions.length; i++) {
          for (let j = i + 1; j < positions.length; j++) {
            const dist = Math.hypot(
              positions[i].x - positions[j].x,
              positions[i].y - positions[j].y,
            );
            expect(dist).toBeGreaterThanOrEqual(40);
          }
        }
      }
    });

    it('finds path between waypoints across rooms using findWaypointPath', () => {
      const path = findWaypointPath('lounge_coffee', 'dev_desk');
      expect(path.length).toBeGreaterThan(2);
      expect(path[0].id).toBe('lounge_coffee');
      expect(path[path.length - 1].id).toBe('dev_desk');

      // Traversing hallway
      const hallWaypoints = path.filter((wp) => wp.roomId === 'hall');
      expect(hallWaypoints.length).toBeGreaterThan(0);
    });

    it('returns single waypoint when start and target are identical', () => {
      const path = findWaypointPath('dev_desk', 'dev_desk');
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

  describe('Client-side Handover sequence', () => {
    it('HANDOVER + START direkt hintereinander → beide passieren hall_center', () => {
      const claude = new AgentController('claude', 'ceo');
      const agy = new AgentController('agy', 'lounge');

      // Trigger handover sequence
      claude.startHandover();
      agy.startHandover();

      // Immediately after, TASK_START arrives moving agy to 'dev' with status 'coding'
      const stateStatusAgy: AgentStatus = 'coding';
      const stateRoomAgy: RoomId = 'dev';
      const stateStatusClaude: AgentStatus = 'idle';
      const stateRoomClaude: RoomId = 'ceo';

      agy.setTargetRoom(stateRoomAgy);
      claude.setTargetRoom(stateRoomClaude);

      const hallCenterWp = WAYPOINTS['hall_center'];
      const hallCenterBaseX = hallCenterWp.x * TILE_SIZE; // 416
      const hallCenterBaseY = hallCenterWp.y * TILE_SIZE; // 288

      let claudePassedHallCenter = false;
      let agyPassedHallCenter = false;
      let claudeHandoverAnimAtHall = false;
      let agyHandoverAnimAtHall = false;

      // Simulate movement forward over ~12 seconds
      const dt = 0.05;
      for (let t = 0; t < 12; t += dt) {
        const claudeRes = claude.tick(dt, stateStatusClaude, stateRoomClaude);
        const agyRes = agy.tick(dt, stateStatusAgy, stateRoomAgy);

        // Check if Claude passes hall_center (spot is x: 392, y: 288)
        if (
          Math.hypot(
            claudeRes.x - (hallCenterBaseX - 24),
            claudeRes.y - hallCenterBaseY,
          ) < 5
        ) {
          claudePassedHallCenter = true;
          if (claudeRes.animation === 'handover') {
            claudeHandoverAnimAtHall = true;
          }
        }

        // Check if Agy passes hall_center (spot is x: 440, y: 288)
        if (
          Math.hypot(
            agyRes.x - (hallCenterBaseX + 24),
            agyRes.y - hallCenterBaseY,
          ) < 5
        ) {
          agyPassedHallCenter = true;
          if (agyRes.animation === 'handover') {
            agyHandoverAnimAtHall = true;
          }
        }
      }

      // Both must pass hall_center and participate in handover animation
      expect(claudePassedHallCenter).toBe(true);
      expect(agyPassedHallCenter).toBe(true);
      expect(claudeHandoverAnimAtHall).toBe(true);
      expect(agyHandoverAnimAtHall).toBe(true);

      // And finally, Agy arrives at dev_desk and Claude at ceo_desk
      const devSpot = getAgentSpot('agy', 'dev');
      const ceoSpot = getAgentSpot('claude', 'ceo');
      expect(agy.x).toBeCloseTo(devSpot.x);
      expect(agy.y).toBeCloseTo(devSpot.y);
      expect(claude.x).toBeCloseTo(ceoSpot.x);
      expect(claude.y).toBeCloseTo(ceoSpot.y);
    });
  });

  describe('deriveCharacters (Runs -> Characters)', () => {
    it('returns default 3 characters for claude, agy, codex when state is empty or undefined', () => {
      expect(deriveCharacters(null)).toEqual([
        { id: 'claude', agent: 'claude', instanceIndex: 0 },
        { id: 'agy', agent: 'agy', instanceIndex: 0 },
        { id: 'codex', agent: 'codex', instanceIndex: 0 },
      ]);
      expect(deriveCharacters({})).toEqual([
        { id: 'claude', agent: 'claude', instanceIndex: 0 },
        { id: 'agy', agent: 'agy', instanceIndex: 0 },
        { id: 'codex', agent: 'codex', instanceIndex: 0 },
      ]);
    });

    it('Claude and agents without active runs remain exactly one character', () => {
      const state = {
        runs: {
          'run-1': {
            runId: 'run-1',
            agent: 'agy' as const,
            status: 'running' as const,
            timestamp: '2026-10-23T10:00:00Z',
            data: {},
          },
        },
      };
      const chars = deriveCharacters(state);
      expect(chars.filter((c) => c.agent === 'claude')).toEqual([
        { id: 'claude', agent: 'claude', instanceIndex: 0 },
      ]);
      expect(chars.filter((c) => c.agent === 'codex')).toEqual([
        { id: 'codex', agent: 'codex', instanceIndex: 0 },
      ]);
    });

    it('derives two agy characters for two parallel agy runs with runId as key', () => {
      const state = {
        runs: {
          'run-1': {
            runId: 'run-1',
            agent: 'agy' as const,
            status: 'running' as const,
            timestamp: '2026-10-23T10:00:00Z',
            data: {},
          },
          'run-2': {
            runId: 'run-2',
            agent: 'agy' as const,
            status: 'running' as const,
            timestamp: '2026-10-23T10:05:00Z',
            data: {},
          },
        },
      };
      const chars = deriveCharacters(state);
      const agyChars = chars.filter((c) => c.agent === 'agy');
      expect(agyChars).toHaveLength(2);
      expect(agyChars[0]).toEqual({
        id: 'run-1',
        agent: 'agy',
        runId: 'run-1',
        instanceIndex: 0,
      });
      expect(agyChars[1]).toEqual({
        id: 'run-2',
        agent: 'agy',
        runId: 'run-2',
        instanceIndex: 1,
      });
    });

    it('returns only one agy character after one run ends, and one idle agy after both end', () => {
      // 1. One run ended, one still active
      const stateOneActive = {
        runs: {
          'run-1': {
            runId: 'run-1',
            agent: 'agy' as const,
            status: 'complete' as const,
            timestamp: '2026-10-23T10:00:00Z',
            data: {},
          },
          'run-2': {
            runId: 'run-2',
            agent: 'agy' as const,
            status: 'running' as const,
            timestamp: '2026-10-23T10:05:00Z',
            data: {},
          },
        },
      };
      const charsOne = deriveCharacters(stateOneActive);
      const agyCharsOne = charsOne.filter((c) => c.agent === 'agy');
      expect(agyCharsOne).toHaveLength(1);
      expect(agyCharsOne[0]).toEqual({
        id: 'run-2',
        agent: 'agy',
        runId: 'run-2',
        instanceIndex: 0,
      });

      // 2. Both runs ended
      const stateBothEnded = {
        runs: {
          'run-1': {
            runId: 'run-1',
            agent: 'agy' as const,
            status: 'complete' as const,
            timestamp: '2026-10-23T10:00:00Z',
            data: {},
          },
          'run-2': {
            runId: 'run-2',
            agent: 'agy' as const,
            status: 'failed' as const,
            timestamp: '2026-10-23T10:05:00Z',
            data: {},
          },
        },
      };
      const charsEnded = deriveCharacters(stateBothEnded);
      const agyCharsEnded = charsEnded.filter((c) => c.agent === 'agy');
      expect(agyCharsEnded).toHaveLength(1);
      expect(agyCharsEnded[0]).toEqual({
        id: 'agy',
        agent: 'agy',
        instanceIndex: 0,
      });
    });

    it('considers handover, running, cooldown as active, but complete, failed, aborted as inactive', () => {
      const state = {
        runs: {
          'r-handover': {
            runId: 'r-handover',
            agent: 'agy' as const,
            status: 'handover' as const,
            timestamp: '2026-10-23T10:01:00Z',
            data: {},
          },
          'r-running': {
            runId: 'r-running',
            agent: 'agy' as const,
            status: 'running' as const,
            timestamp: '2026-10-23T10:02:00Z',
            data: {},
          },
          'r-cooldown': {
            runId: 'r-cooldown',
            agent: 'agy' as const,
            status: 'cooldown' as const,
            timestamp: '2026-10-23T10:03:00Z',
            data: {},
          },
          'r-complete': {
            runId: 'r-complete',
            agent: 'agy' as const,
            status: 'complete' as const,
            timestamp: '2026-10-23T10:04:00Z',
            data: {},
          },
          'r-failed': {
            runId: 'r-failed',
            agent: 'agy' as const,
            status: 'failed' as const,
            timestamp: '2026-10-23T10:05:00Z',
            data: {},
          },
          'r-aborted': {
            runId: 'r-aborted',
            agent: 'agy' as const,
            status: 'aborted' as const,
            timestamp: '2026-10-23T10:06:00Z',
            data: {},
          },
        },
      };
      expect(ACTIVE_RUN_STATUSES).toEqual(['handover', 'running', 'cooldown']);
      const chars = deriveCharacters(state);
      const agyRuns = chars
        .filter((c) => c.agent === 'agy')
        .map((c) => c.runId);
      expect(agyRuns).toEqual(['r-handover', 'r-running', 'r-cooldown']);
    });

    it('does not derive character for run with status stale', () => {
      const state = {
        runs: {
          'run-stale-status': {
            runId: 'run-stale-status',
            agent: 'claude' as const,
            status: 'stale' as const,
            timestamp: '2026-10-23T10:00:00Z',
            data: {},
          },
        },
      };
      const chars = deriveCharacters(state);
      const claudeChars = chars.filter((c) => c.agent === 'claude');
      expect(claudeChars).toEqual([
        { id: 'claude', agent: 'claude', instanceIndex: 0 },
      ]);
    });
  });

  describe('Multi-instance positioning and non-overlapping in rooms', () => {
    it('guarantees instances of the same agent do not overlap in any room', () => {
      const agents: Agent[] = ['agy', 'codex', 'claude'];
      for (const room of ROOM_IDS) {
        for (const agent of agents) {
          const spot0 = getAgentSpot(agent, room, 0);
          const spot1 = getAgentSpot(agent, room, 1);
          expect(doSpotsOverlap(spot0, spot1)).toBe(false);
          const dist = Math.hypot(spot0.x - spot1.x, spot0.y - spot1.y);
          expect(dist).toBeGreaterThanOrEqual(36);
        }
      }
    });

    it('guarantees all characters in the same room (including parallel runs) never overlap', () => {
      // In any room, even if we have claude + agy#0 + agy#1 + codex#0 + codex#1
      for (const room of ROOM_IDS) {
        const positions = [
          getAgentSpot('claude', room, 0),
          getAgentSpot('agy', room, 0),
          getAgentSpot('agy', room, 1),
          getAgentSpot('codex', room, 0),
          getAgentSpot('codex', room, 1),
        ];

        for (let i = 0; i < positions.length; i++) {
          for (let j = i + 1; j < positions.length; j++) {
            const posA = positions[i];
            const posB = positions[j];
            expect(doSpotsOverlap(posA, posB)).toBe(false);
            const dist = Math.hypot(posA.x - posB.x, posA.y - posB.y);
            expect(dist).toBeGreaterThanOrEqual(36);
          }
        }
      }
    });

    it('positions parallel agents at distinct spots during handover walk', () => {
      const agy0 = new AgentController('agy', 'lounge', 0);
      const agy1 = new AgentController('agy', 'lounge', 1);
      agy0.startHandover();
      agy1.startHandover();

      // In hall, their target positions differ and do not overlap
      const spot0 = getAgentSpot('agy', 'hall', 0);
      const spot1 = getAgentSpot('agy', 'hall', 1);
      expect(doSpotsOverlap(spot0, spot1)).toBe(false);
    });
  });

  describe('TeamLeads and Team-Bereiche (V2 / #102)', () => {
    it('maps teams to primary team leads (frontend->agy, backend->claude, qa->codex)', () => {
      expect(TEAM_LEADS).toEqual({
        frontend: 'agy',
        backend: 'claude',
        qa: 'codex',
      });
    });

    it('derives team spots at team desks with non-overlapping worker offsets', () => {
      for (const team of TEAMS) {
        const leadSpot = getTeamSpot(team, 0);
        const worker1Spot = getTeamSpot(team, 1);
        const worker2Spot = getTeamSpot(team, 2);

        expect(leadSpot.x).toBeGreaterThan(0);
        expect(leadSpot.y).toBeGreaterThan(0);
        expect(doSpotsOverlap(leadSpot, worker1Spot)).toBe(false);
        expect(doSpotsOverlap(leadSpot, worker2Spot)).toBe(false);
        expect(doSpotsOverlap(worker1Spot, worker2Spot)).toBe(false);
      }
    });

    it('produces identical output to main when state has no teams', () => {
      expect(deriveCharacters(null)).toEqual([
        { id: 'claude', agent: 'claude', instanceIndex: 0 },
        { id: 'agy', agent: 'agy', instanceIndex: 0 },
        { id: 'codex', agent: 'codex', instanceIndex: 0 },
      ]);
      expect(deriveCharacters({})).toEqual([
        { id: 'claude', agent: 'claude', instanceIndex: 0 },
        { id: 'agy', agent: 'agy', instanceIndex: 0 },
        { id: 'codex', agent: 'codex', instanceIndex: 0 },
      ]);
      const stateWithoutTeams = {
        runs: {
          'r-active': {
            runId: 'r-active',
            agent: 'claude' as const,
            status: 'running' as const,
            timestamp: '2026-10-23T10:00:00Z',
            data: {},
          },
        },
      };
      expect(deriveCharacters(stateWithoutTeams)).toEqual([
        {
          id: 'r-active',
          agent: 'claude',
          runId: 'r-active',
          instanceIndex: 0,
        },
        { id: 'agy', agent: 'agy', instanceIndex: 0 },
        { id: 'codex', agent: 'codex', instanceIndex: 0 },
      ]);
    });

    it('derives TeamLead characters in addition to existing V1 characters when state has teams', () => {
      const state = {
        teams: {
          frontend: { status: 'idle' as const },
          backend: { status: 'idle' as const },
          qa: { status: 'idle' as const },
        },
        runs: {},
      };
      const chars = deriveCharacters(state);
      expect(chars).toEqual([
        { id: 'claude', agent: 'claude', instanceIndex: 0 },
        { id: 'agy', agent: 'agy', instanceIndex: 0 },
        { id: 'codex', agent: 'codex', instanceIndex: 0 },
        {
          id: 'team-lead-frontend',
          agent: 'agy',
          team: 'frontend',
          isTeamLead: true,
          instanceIndex: 0,
        },
        {
          id: 'team-lead-backend',
          agent: 'claude',
          team: 'backend',
          isTeamLead: true,
          instanceIndex: 0,
        },
        {
          id: 'team-lead-qa',
          agent: 'codex',
          team: 'qa',
          isTeamLead: true,
          instanceIndex: 0,
        },
      ]);
    });

    it('generates a question speech bubble with ? for waiting_input', () => {
      const bubble = getSpeechBubble('waiting_input', {
        statusText: 'Welche Farbe?',
      });
      expect(bubble).toEqual({
        type: 'alert',
        text: '?',
        icon: '❓',
        tooltip: 'Welche Farbe?',
      });
    });

    it('maps waiting_input status to idle animation', () => {
      expect(statusToAnimation('waiting_input')).toBe('idle');
    });
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'svelte/server';
import OfficeFloor from './OfficeFloor.svelte';
import {
  TOTAL_WIDTH_PX,
  TOTAL_HEIGHT_PX,
  TILE_SIZE,
  CANVAS_BASE_SCALE,
} from '../../office/layout';
import { liveStore, resetLiveStore } from '../../live.svelte';

describe('OfficeFloor.svelte scaling and layout', () => {
  afterEach(() => {
    resetLiveStore();
  });

  it('renders Zoom 1x with exact screen dimensions matching 32px per tile', () => {
    // 28 columns * 32px = 896px; 19 rows * 32px = 608px
    const expectedWidth = 28 * 32;
    const expectedHeight = 19 * 32;

    const { html } = render(OfficeFloor, { props: { scale: 1 } });
    expect(html).toContain(`width: ${expectedWidth}px`);
    expect(html).toContain(`height: ${expectedHeight}px`);
    expect(html).toContain(`scale(${CANVAS_BASE_SCALE})`);
    expect(html).toContain(`--tile-size: ${TILE_SIZE}px`);
    expect(html).toContain(`--tileset-size: ${8 * TILE_SIZE}px`);
  });

  it('renders Zoom 2x with exact screen dimensions matching 64px per tile', () => {
    // 28 columns * 64px = 1792px; 19 rows * 64px = 1216px
    const expectedWidth = 28 * 64;
    const expectedHeight = 19 * 64;

    const { html } = render(OfficeFloor, { props: { scale: 2 } });
    expect(html).toContain(`width: ${expectedWidth}px`);
    expect(html).toContain(`height: ${expectedHeight}px`);
    expect(html).toContain(`scale(${2 * CANVAS_BASE_SCALE})`);
  });

  it('verifies TILE_SIZE is 128 and canvas size is 3584x2432', () => {
    expect(TILE_SIZE).toBe(128);
    expect(CANVAS_BASE_SCALE).toBe(0.25);
    expect(TOTAL_WIDTH_PX).toBe(28 * 128);
    expect(TOTAL_HEIGHT_PX).toBe(19 * 128);
  });

  it('counter-scales UI overlays (speech bubbles, agent badges, room labels, waypoints) by 1 / CANVAS_BASE_SCALE', () => {
    const overlayScale = 1 / CANVAS_BASE_SCALE; // 4
    expect(overlayScale).toBe(4);

    // Put agy into coding state so a speech bubble is rendered
    liveStore.state.agents.agy = {
      status: 'coding',
      room: 'dev',
      runId: 'run-test',
    };
    liveStore.state.runs['run-test'] = {
      runId: 'run-test',
      agent: 'agy',
      status: 'running',
      room: 'dev',
      ticketId: '136',
      timestamp: '2026-10-24T12:00:00Z',
      data: { title: 'Sprites 128x128' },
    };

    const { html } = render(OfficeFloor, {
      props: { scale: 1, showRoomLabels: true, showWaypoints: true },
    });

    // 1. Speech bubble & agent nametag badge counter-scaled with bottom center origin
    expect(html).toContain('data-testid="speech-bubble-agy"');
    expect(html).toContain(
      `style="transform: translateX(-50%) scale(${overlayScale}); transform-origin: bottom center;"`,
    );
    expect(html).toContain(`--overlay-scale: ${overlayScale};`);

    // 2. Room labels counter-scaled (top right for rooms, top left for hall)
    expect(html).toContain(
      `style="transform: scale(${overlayScale}); transform-origin: top right;"`,
    );
    expect(html).toContain(
      `style="transform: scale(${overlayScale}); transform-origin: top left;"`,
    );

    // 3. Waypoint markers counter-scaled with center origin
    expect(html).toContain(
      `transform: scale(${overlayScale}); transform-origin: center;`,
    );
  });
});

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

  it('renders Zoom 1x with exact screen dimensions matching 64px per tile', () => {
    // 28 columns * 64px = 1792px; 19 rows * 64px = 1216px
    const expectedWidth = 28 * 64;
    const expectedHeight = 19 * 64;

    const { html } = render(OfficeFloor, { props: { scale: 1 } });
    expect(html).toContain(`width: ${expectedWidth}px`);
    expect(html).toContain(`height: ${expectedHeight}px`);
    expect(html).toContain(`scale(${CANVAS_BASE_SCALE})`);
    expect(html).toContain(`--tile-size: ${TILE_SIZE}px`);
    expect(html).toContain(`--tileset-size: ${8 * TILE_SIZE}px`);
  });

  it('renders Zoom 2x with exact screen dimensions matching 128px per tile', () => {
    // 28 columns * 128px = 3584px; 19 rows * 128px = 2432px
    const expectedWidth = 28 * 128;
    const expectedHeight = 19 * 128;

    const { html } = render(OfficeFloor, { props: { scale: 2 } });
    expect(html).toContain(`width: ${expectedWidth}px`);
    expect(html).toContain(`height: ${expectedHeight}px`);
    expect(html).toContain(`scale(${2 * CANVAS_BASE_SCALE})`);
  });

  it('verifies TILE_SIZE is 128 and canvas size is 3584x2432', () => {
    expect(TILE_SIZE).toBe(128);
    expect(CANVAS_BASE_SCALE).toBe(0.5);
    expect(TOTAL_WIDTH_PX).toBe(28 * 128);
    expect(TOTAL_HEIGHT_PX).toBe(19 * 128);
  });

  it('counter-scales UI overlays (speech bubbles, agent badges, room labels, waypoints) by 1 / CANVAS_BASE_SCALE', () => {
    const overlayScale = 1 / CANVAS_BASE_SCALE; // 2
    expect(overlayScale).toBe(2);

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
      `right: ${6 / CANVAS_BASE_SCALE}px; top: ${6 / CANVAS_BASE_SCALE}px; transform: scale(${overlayScale}); transform-origin: top right;`,
    );
    expect(html).toContain(
      `left: ${12 / CANVAS_BASE_SCALE}px; top: ${4 / CANVAS_BASE_SCALE}px; transform: scale(${overlayScale}); transform-origin: top left;`,
    );

    // 3. Waypoint markers counter-scaled with center origin
    expect(html).toContain(
      `transform: scale(${overlayScale}); transform-origin: center;`,
    );
  });

  it('reflects repo in character tooltip and attributes when present in run', () => {
    liveStore.state.agents.agy = {
      status: 'coding',
      room: 'dev',
      runId: 'run-custom-repo',
    };
    liveStore.state.runs['run-custom-repo'] = {
      runId: 'run-custom-repo',
      agent: 'agy',
      status: 'running',
      room: 'dev',
      ticketId: '149',
      timestamp: '2026-10-25T12:00:00Z',
      repo: 'acme/webapp',
      data: { title: 'Multi-Repo' },
    };

    const { html } = render(OfficeFloor, { props: { scale: 1 } });
    expect(html).toContain('data-repo="acme/webapp"');
    expect(html).toContain('[acme/webapp]');
    expect(html).toContain('title="#149 Multi-Repo • acme/webapp"');
  });
});

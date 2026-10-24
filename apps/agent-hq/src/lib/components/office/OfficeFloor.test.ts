import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import OfficeFloor from './OfficeFloor.svelte';
import {
  TOTAL_WIDTH_PX,
  TOTAL_HEIGHT_PX,
  TILE_SIZE,
} from '../../office/layout';

describe('OfficeFloor.svelte scaling and layout', () => {
  it('renders Zoom 1x with exact screen dimensions matching 32px per tile', () => {
    // 28 columns * 32px = 896px; 19 rows * 32px = 608px
    const expectedWidth = 28 * 32;
    const expectedHeight = 19 * 32;

    const { html } = render(OfficeFloor, { props: { scale: 1 } });
    expect(html).toContain(`width: ${expectedWidth}px`);
    expect(html).toContain(`height: ${expectedHeight}px`);
    expect(html).toContain('scale(0.25)');
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
    expect(html).toContain('scale(0.5)');
  });

  it('verifies TILE_SIZE is 128 and canvas size is 3584x2432', () => {
    expect(TILE_SIZE).toBe(128);
    expect(TOTAL_WIDTH_PX).toBe(28 * 128);
    expect(TOTAL_HEIGHT_PX).toBe(19 * 128);
  });
});

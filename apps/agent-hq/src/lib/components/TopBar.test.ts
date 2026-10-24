import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'svelte/server';
import TopBar from './TopBar.svelte';
import { liveStore, resetLiveStore } from '../live.svelte';
import type { Team, TeamState } from '../server/state';

describe('TopBar.svelte', () => {
  beforeEach(() => {
    resetLiveStore();
  });

  afterEach(() => {
    resetLiveStore();
  });

  it('renders without V2 badge when state.teams is undefined', () => {
    const { html } = render(TopBar);
    expect(html).not.toContain('data-testid="v2-badge"');
    expect(html).not.toContain('V2-Worker-Pool aktiv');
  });

  it('renders V2 badge with tooltip and aria-label when state.teams is set', () => {
    const teams: Record<Team, TeamState> = {
      frontend: { status: 'idle' },
      backend: { status: 'idle' },
      qa: { status: 'idle' },
    };
    liveStore.state = {
      ...liveStore.state,
      teams,
    };

    const { html } = render(TopBar);
    expect(html).toContain('data-testid="v2-badge"');
    expect(html).toContain('title="V2-Worker-Pool aktiv"');
    expect(html).toContain('aria-label="V2-Worker-Pool aktiv"');
    expect(html).toContain('>V2<');
  });
});

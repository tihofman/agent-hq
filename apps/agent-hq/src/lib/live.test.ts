import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { liveStore, connect, resetLiveStore } from './live.svelte';
import type { State, HQEvent, InternalAction } from './server/state';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  listeners: Record<string, ((ev: { data: string }) => void)[]> = {};
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (ev: { data: string }) => void) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(listener);
  }

  emit(type: string, data: unknown) {
    const payload = {
      data: typeof data === 'string' ? data : JSON.stringify(data),
    };
    for (const listener of this.listeners[type] || []) {
      listener(payload);
    }
  }

  open() {
    this.onopen?.();
  }

  error(err?: unknown) {
    this.onerror?.(err);
  }

  close() {
    this.closed = true;
  }
}

describe('liveStore & connect', () => {
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    MockEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource =
      MockEventSource;
    resetLiveStore();
  });

  afterEach(() => {
    (globalThis as unknown as { EventSource: unknown }).EventSource =
      originalEventSource;
    resetLiveStore();
    vi.restoreAllMocks();
  });

  it('initializes with default state, empty feed and disconnected', () => {
    expect(liveStore.connected).toBe(false);
    expect(liveStore.feed).toEqual([]);
    expect(liveStore.state.agents.claude.status).toBe('idle');
    expect(liveStore.state.agents.agy.status).toBe('idle');
    expect(liveStore.state.agents.codex.status).toBe('idle');
    expect(liveStore.state.runs).toEqual({});
    expect(liveStore.state.activePR).toBeNull();
  });

  it('connects to /api/stream and updates connected state on open/error', () => {
    const disconnect = connect();
    expect(MockEventSource.instances).toHaveLength(1);
    const es = MockEventSource.instances[0];
    expect(es.url).toBe('/api/stream');
    expect(liveStore.connected).toBe(false);

    es.open();
    expect(liveStore.connected).toBe(true);

    es.error();
    expect(liveStore.connected).toBe(false);

    // EventSource reconnects itself; upon reconnect onopen fires again
    es.open();
    expect(liveStore.connected).toBe(true);

    disconnect();
    expect(es.closed).toBe(true);
    expect(liveStore.connected).toBe(false);
  });

  it('supports custom url in connect()', () => {
    const disconnect = connect('/api/custom-stream');
    expect(MockEventSource.instances[0].url).toBe('/api/custom-stream');
    disconnect();
  });

  it('handles INIT_STATE by replacing state and clearing feed', () => {
    connect();
    const es = MockEventSource.instances[0];

    // Seed feed with an event
    liveStore.feed.push({
      event: 'TASK_START',
      agent: 'codex',
      room: 'dev',
      timestamp: '2026-10-22T20:00:00.000Z',
      data: {},
    });
    expect(liveStore.feed).toHaveLength(1);

    const snapshot: State = {
      agents: {
        claude: { status: 'reviewing', room: 'qa' },
        agy: { status: 'idle', room: 'lounge' },
        codex: { status: 'coding', room: 'dev', runId: 'run-1' },
      },
      runs: {
        'run-1': {
          runId: 'run-1',
          agent: 'codex',
          status: 'running',
          timestamp: '2026-10-22T20:00:00.000Z',
          data: {},
        },
      },
      activePR: null,
    };

    es.emit('INIT_STATE', snapshot);

    expect(liveStore.state).toEqual(snapshot);
    expect(liveStore.feed).toEqual([]);
  });

  it('handles UPDATE by replacing state and appending event to feed', () => {
    connect();
    const es = MockEventSource.instances[0];

    const testEvent: HQEvent = {
      event: 'TASK_START',
      agent: 'agy',
      room: 'dev',
      runId: 'run-update-1',
      timestamp: '2026-10-22T20:01:00.000Z',
      data: { title: 'Working on #39' },
    };

    const nextState: State = {
      agents: {
        claude: { status: 'idle', room: 'lounge' },
        agy: { status: 'coding', room: 'dev', runId: 'run-update-1' },
        codex: { status: 'idle', room: 'lounge' },
      },
      runs: {
        'run-update-1': {
          runId: 'run-update-1',
          agent: 'agy',
          status: 'running',
          timestamp: '2026-10-22T20:01:00.000Z',
          data: { title: 'Working on #39' },
        },
      },
      activePR: null,
    };

    es.emit('UPDATE', { event: testEvent, state: nextState });

    expect(liveStore.state).toEqual(nextState);
    expect(liveStore.feed).toHaveLength(1);
    expect(liveStore.feed[0]).toEqual(testEvent);
  });

  it('does not append SET_TEAM_STATUSES actions to feed', () => {
    connect();
    const es = MockEventSource.instances[0];

    const teamAction: InternalAction = {
      type: 'SET_TEAM_STATUSES',
      teams: { frontend: 'working', backend: 'idle', qa: 'idle' },
    };
    const nextState: State = {
      ...liveStore.state,
      teams: {
        frontend: { status: 'working' },
        backend: { status: 'idle' },
        qa: { status: 'idle' },
      },
    };

    es.emit('UPDATE', { event: teamAction, state: nextState });

    expect(liveStore.state).toEqual(nextState);
    expect(liveStore.feed).toHaveLength(0);
  });

  it('caps feed at 1000 items and drops oldest items', () => {
    connect();
    const es = MockEventSource.instances[0];

    const dummyState: State = {
      agents: {
        claude: { status: 'idle', room: 'lounge' },
        agy: { status: 'idle', room: 'lounge' },
        codex: { status: 'idle', room: 'lounge' },
      },
      runs: {},
      activePR: null,
    };

    // Pre-populate with 1000 items
    for (let i = 0; i < 1000; i++) {
      liveStore.feed.push({
        event: 'TASK_PROGRESS',
        agent: 'codex',
        room: 'dev',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: { statusText: `event-${i}` },
      });
    }
    expect(liveStore.feed).toHaveLength(1000);
    expect((liveStore.feed[0] as HQEvent).data.statusText).toBe('event-0');

    // Emit 1001st event
    const newestEvent: HQEvent = {
      event: 'TASK_COMPLETE',
      agent: 'codex',
      room: 'dev',
      timestamp: '2026-10-22T20:02:00.000Z',
      data: { statusText: 'event-1000' },
    };
    es.emit('UPDATE', { event: newestEvent, state: dummyState });

    expect(liveStore.feed).toHaveLength(1000);
    expect((liveStore.feed[0] as HQEvent).data.statusText).toBe('event-1');
    expect((liveStore.feed[999] as HQEvent).data.statusText).toBe('event-1000');
  });

  it('closes existing EventSource when connect() is called again', () => {
    const disconnect1 = connect();
    const es1 = MockEventSource.instances[0];
    expect(es1.closed).toBe(false);

    const disconnect2 = connect();
    expect(es1.closed).toBe(true);
    const es2 = MockEventSource.instances[1];
    expect(es2.closed).toBe(false);

    disconnect2();
    expect(es2.closed).toBe(true);
    disconnect1();
  });

  it('returns no-op cleanup when EventSource is undefined in environment', () => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = undefined;
    const disconnect = connect();
    expect(typeof disconnect).toBe('function');
    expect(() => disconnect()).not.toThrow();
  });
});

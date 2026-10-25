import type { HQState, HQEvent, InternalAction } from '@agent-hq/queue/types';

const initial = (): HQState => ({
  agents: {
    claude: { status: 'idle', room: 'lounge' },
    agy: { status: 'idle', room: 'lounge' },
    codex: { status: 'idle', room: 'lounge' },
  },
  runs: {},
  activePR: null,
});

export interface LiveStore {
  state: HQState;
  feed: (HQEvent | InternalAction)[];
  connected: boolean;
}

export const liveStore = $state<LiveStore>({
  state: initial(),
  feed: [],
  connected: false,
});

let currentEs: EventSource | undefined;

export function connect(url = '/api/stream'): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  currentEs?.close();
  const es = new EventSource(url);
  currentEs = es;

  es.onopen = () => {
    liveStore.connected = true;
  };
  es.onerror = () => {
    liveStore.connected = false;
  };
  es.addEventListener('INIT_STATE', (e) => {
    liveStore.state = JSON.parse((e as MessageEvent).data) as HQState;
    liveStore.feed = [];
  });
  es.addEventListener('UPDATE', (e) => {
    const { event, state } = JSON.parse((e as MessageEvent).data) as {
      event: HQEvent | InternalAction;
      state: HQState;
    };
    liveStore.state = state;
    if ('type' in event && event.type === 'SET_TEAM_STATUSES') {
      return;
    }
    liveStore.feed.push(event);
    while (liveStore.feed.length > 1000) liveStore.feed.shift();
  });

  return () => {
    es.close();
    if (currentEs === es) {
      currentEs = undefined;
      liveStore.connected = false;
    }
  };
}

export function resetLiveStore(): void {
  currentEs?.close();
  currentEs = undefined;
  liveStore.state = initial();
  liveStore.feed = [];
  liveStore.connected = false;
}

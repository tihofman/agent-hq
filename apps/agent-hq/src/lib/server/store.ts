import {
  initialState,
  reduce,
  type HQEvent,
  type InternalAction,
  type State,
} from './state';

type Subscriber = (state: State, event: HQEvent | InternalAction) => void;

let currentState: State = structuredClone(initialState);
const subscribers = new Set<Subscriber>();

export function getState(): State {
  return currentState;
}

export function dispatch(event: HQEvent | InternalAction): State {
  currentState = reduce(currentState, event);
  for (const fn of [...subscribers]) {
    try {
      fn(currentState, event);
    } catch (err) {
      console.error('Store subscriber error:', err);
    }
  }
  return currentState;
}

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function resetStore(): void {
  currentState = structuredClone(initialState);
  subscribers.clear();
}

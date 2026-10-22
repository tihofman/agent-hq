import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getState, dispatch, subscribe, resetStore } from './store';
import { initialState, parseEvent } from './state';

describe('store', () => {
  beforeEach(() => {
    resetStore();
  });

  it('initializes with initialState', () => {
    expect(getState()).toEqual(initialState);
  });

  it('updates state and notifies subscribers on dispatch', () => {
    const subscriber = vi.fn();
    const unsubscribe = subscribe(subscriber);

    const event = parseEvent({
      event: 'TASK_START',
      agent: 'codex',
      runId: 'run-1',
    });
    const nextState = dispatch(event);

    expect(nextState.agents.codex.status).toBe('coding');
    expect(getState()).toBe(nextState);
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledWith(nextState, event);

    unsubscribe();
  });

  it('unsubscribes cleanly', () => {
    const subscriber = vi.fn();
    const unsubscribe = subscribe(subscriber);

    unsubscribe();

    const event = parseEvent({
      event: 'TASK_START',
      agent: 'codex',
      runId: 'run-2',
    });
    dispatch(event);

    expect(subscriber).not.toHaveBeenCalled();
  });

  it('resets state and subscribers on resetStore', () => {
    const subscriber = vi.fn();
    subscribe(subscriber);

    const event = parseEvent({
      event: 'TASK_START',
      agent: 'codex',
      runId: 'run-3',
    });
    dispatch(event);
    expect(getState().agents.codex.status).toBe('coding');

    resetStore();

    expect(getState()).toEqual(initialState);

    dispatch(event);
    expect(subscriber).toHaveBeenCalledTimes(1);
  });
});

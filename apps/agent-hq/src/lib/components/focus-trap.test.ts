import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { focusTrap } from './focus-trap';

describe('focusTrap action', () => {
  let listeners: Record<string, (e: KeyboardEvent) => void>;
  let originalWindow: typeof globalThis.window;
  let originalDocument: typeof globalThis.document;

  beforeEach(() => {
    listeners = {};
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;

    // Simulate window event listener in node environment
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: (
        type: string,
        listener: (e: KeyboardEvent) => void,
      ) => {
        listeners[type] = listener;
      },
      removeEventListener: (type: string) => {
        delete listeners[type];
      },
    };
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
    (globalThis as unknown as { document: unknown }).document =
      originalDocument;
  });

  function createMockElement(id: string) {
    return {
      id,
      focus: vi.fn(),
    } as unknown as HTMLElement;
  }

  it('calls onEscape callback and prevents default when Escape is pressed (function param)', () => {
    const onEscape = vi.fn();
    const node = {
      querySelectorAll: vi.fn().mockReturnValue([]),
    } as unknown as HTMLElement;

    const action = focusTrap(node, onEscape);
    expect(listeners['keydown']).toBeDefined();

    const preventDefault = vi.fn();
    const event = {
      key: 'Escape',
      preventDefault,
    } as unknown as KeyboardEvent;

    listeners['keydown'](event);
    expect(preventDefault).toHaveBeenCalled();
    expect(onEscape).toHaveBeenCalledTimes(1);

    action?.destroy?.();
    expect(listeners['keydown']).toBeUndefined();
  });

  it('calls onEscape callback when passed as object param', () => {
    const onEscape = vi.fn();
    const node = {
      querySelectorAll: vi.fn().mockReturnValue([]),
    } as unknown as HTMLElement;

    const action = focusTrap(node, { onEscape });
    const preventDefault = vi.fn();
    listeners['keydown']({
      key: 'Escape',
      preventDefault,
    } as unknown as KeyboardEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(onEscape).toHaveBeenCalledTimes(1);

    action?.destroy?.();
  });

  it('updates onEscape callback on update', () => {
    const firstEscape = vi.fn();
    const secondEscape = vi.fn();
    const node = {
      querySelectorAll: vi.fn().mockReturnValue([]),
    } as unknown as HTMLElement;

    const action = focusTrap(node, firstEscape);
    action?.update?.(secondEscape);

    listeners['keydown']({
      key: 'Escape',
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent);

    expect(firstEscape).not.toHaveBeenCalled();
    expect(secondEscape).toHaveBeenCalledTimes(1);

    action?.destroy?.();
  });

  it('wraps focus to first element when Tab is pressed on last element', () => {
    const el1 = createMockElement('first');
    const el2 = createMockElement('second');
    const node = {
      querySelectorAll: vi.fn().mockReturnValue([el1, el2]),
    } as unknown as HTMLElement;

    (globalThis as unknown as { document: unknown }).document = {
      activeElement: el2,
    };

    const action = focusTrap(node);
    const preventDefault = vi.fn();

    listeners['keydown']({
      key: 'Tab',
      shiftKey: false,
      preventDefault,
    } as unknown as KeyboardEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(el1.focus as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);

    action?.destroy?.();
  });

  it('wraps focus to last element when Shift+Tab is pressed on first element', () => {
    const el1 = createMockElement('first');
    const el2 = createMockElement('second');
    const node = {
      querySelectorAll: vi.fn().mockReturnValue([el1, el2]),
    } as unknown as HTMLElement;

    (globalThis as unknown as { document: unknown }).document = {
      activeElement: el1,
    };

    const action = focusTrap(node);
    const preventDefault = vi.fn();

    listeners['keydown']({
      key: 'Tab',
      shiftKey: true,
      preventDefault,
    } as unknown as KeyboardEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(el2.focus as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);

    action?.destroy?.();
  });

  it('does not prevent default when Tab is pressed on an element that is neither first nor last', () => {
    const el1 = createMockElement('first');
    const el2 = createMockElement('second');
    const el3 = createMockElement('third');
    const node = {
      querySelectorAll: vi.fn().mockReturnValue([el1, el2, el3]),
    } as unknown as HTMLElement;

    (globalThis as unknown as { document: unknown }).document = {
      activeElement: el2,
    };

    const action = focusTrap(node);
    const preventDefault = vi.fn();

    listeners['keydown']({
      key: 'Tab',
      shiftKey: false,
      preventDefault,
    } as unknown as KeyboardEvent);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(el1.focus as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(el3.focus as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();

    action?.destroy?.();
  });
});

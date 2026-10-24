import type { Action } from 'svelte/action';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface FocusTrapOptions {
  onEscape?: () => void;
}

export type FocusTrapParam = (() => void) | FocusTrapOptions | undefined;

/**
 * Svelte action to trap keyboard focus within a modal node and handle Escape key.
 */
export const focusTrap: Action<HTMLElement, FocusTrapParam> = (
  node: HTMLElement,
  param?: FocusTrapParam,
) => {
  let onEscape = typeof param === 'function' ? param : param?.onEscape;

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscape?.();
      return;
    }

    if (event.key === 'Tab') {
      const focusable = node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeyDown);
  }

  return {
    update(newParam?: FocusTrapParam) {
      onEscape = typeof newParam === 'function' ? newParam : newParam?.onEscape;
    },
    destroy() {
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', handleKeyDown);
      }
    },
  };
};

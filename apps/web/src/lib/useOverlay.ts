import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface UseOverlayOptions {
  /** Whether the overlay is currently open/mounted. */
  open: boolean;
  /** Invoked when the user requests to close (Esc key). */
  onClose: () => void;
  /** The overlay container element to trap focus within. */
  containerRef: RefObject<HTMLElement | null>;
}

/**
 * Shared overlay behavior for modal-style surfaces (Modal, drawers):
 * - Locks body scroll while open and restores it on close.
 * - Closes on Escape.
 * - Moves focus into the overlay on open and restores it to the previously
 *   focused element on close.
 * - Traps Tab focus within the overlay so the page behind is not reachable.
 *
 * Centralizing this keeps every overlay consistent and accessible.
 */
export function useOverlay({ open, onClose, containerRef }: UseOverlayOptions): void {
  // Hold the latest onClose in a ref so it is NOT an effect dependency.
  // Modals typically pass an inline `onClose={() => ...}` whose identity changes
  // every render; if it were a dependency, the effect below would tear down and
  // re-run on every keystroke — refocusing the overlay and stealing focus from
  // the input the user is typing in (the "types one char then loses focus" bug).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && container) {
        const focusable = Array.from(
          container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => el.offsetParent !== null || el === container);
        if (focusable.length === 0) {
          e.preventDefault();
          container.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || active === container || !container.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the overlay so Esc / Tab work immediately.
    if (container) {
      const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable ?? container).focus();
    }

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      // Restore focus to whatever was focused before the overlay opened.
      previouslyFocused?.focus?.();
    };
    // containerRef is a stable ref object; onClose is read via onCloseRef.
    // Effect runs only on open/close — never on every render.
  }, [open, containerRef]);
}

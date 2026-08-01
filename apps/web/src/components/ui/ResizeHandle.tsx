/**
 * ResizeHandle — a draggable divider that resizes the panel to its left.
 *
 * Built as a primitive rather than inline in the Docs surface because the
 * board, the issue drawer and the graph all have the same fixed-width-panel
 * problem; this is the single place to fix it.
 *
 * Three things it deliberately does that a naive `onMouseDown` version doesn't:
 *
 *  - **Pointer capture.** Drag with the mouse moving faster than React can
 *    re-render and the pointer leaves the 6px handle; without capture the
 *    element stops receiving events and the drag dies mid-gesture. Capture
 *    binds the pointer to the handle until release.
 *  - **Keyboard operable.** It is a `separator` with `aria-valuenow`, and
 *    Arrow keys move it. A resize that only works with a mouse is not a
 *    feature everyone gets, and this codebase already holds that line for the
 *    page tree (which is why its up/down move buttons exist alongside drag).
 *  - **Persisted per key.** Width outlives reload via localStorage, because a
 *    width you have to re-set on every visit is worse than a fixed one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export interface ResizeHandleProps {
  /** Current width in px of the panel being resized. */
  width: number;
  onWidthChange: (next: number) => void;
  min: number;
  max: number;
  /** Accessible name, e.g. "Resize the page list". */
  label: string;
  /** Px moved per arrow key press. Shift multiplies by 4. */
  step?: number;
  'data-testid'?: string;
}

export function ResizeHandle({
  width,
  onWidthChange,
  min,
  max,
  label,
  step = 16,
  'data-testid': testId,
}: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  // The drag reads from a ref, not from `width`, so a re-render mid-gesture
  // can't reset the origin and make the panel jump.
  const origin = useRef({ x: 0, width: 0 });

  const clamp = useCallback(
    (n: number) => Math.min(max, Math.max(min, Math.round(n))),
    [min, max],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Primary button only — a right-click or a two-finger tap must not start
    // a drag the user can't see themselves having started.
    if (e.button !== 0) return;
    e.preventDefault();
    origin.current = { x: e.clientX, width };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    onWidthChange(clamp(origin.current.width + (e.clientX - origin.current.x)));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // While dragging, kill text selection and force the resize cursor document-
  // wide. Without this the gesture selects page text as it sweeps across the
  // document, which looks broken even though the resize itself works.
  useEffect(() => {
    if (!dragging) return;
    const { body } = document;
    const prevSelect = body.style.userSelect;
    const prevCursor = body.style.cursor;
    body.style.userSelect = 'none';
    body.style.cursor = 'col-resize';
    return () => {
      body.style.userSelect = prevSelect;
      body.style.cursor = prevCursor;
    };
  }, [dragging]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = e.shiftKey ? step * 4 : step;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onWidthChange(clamp(width - delta));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onWidthChange(clamp(width + delta));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onWidthChange(min);
    } else if (e.key === 'End') {
      e.preventDefault();
      onWidthChange(max);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-testid={testId}
      data-dragging={dragging ? '' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onWidthChange(clamp(Math.round((min + max) / 2)))}
      className={cn(
        // 6px of grabbable width, but only a 1px painted line — a divider that
        // looks 6px thick reads as a gap, not an edge.
        'group relative w-1.5 shrink-0 cursor-col-resize touch-none self-stretch',
        'focus-visible:outline-none',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors',
          dragging ? 'bg-signal-500' : 'bg-transparent group-hover:bg-signal-300',
        )}
      />
      {/* Focus ring on the hit area, not the hairline, so keyboard focus is
          actually visible against both themes. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 rounded-full group-focus-visible:ring-2 group-focus-visible:ring-signal-500"
      />
    </div>
  );
}

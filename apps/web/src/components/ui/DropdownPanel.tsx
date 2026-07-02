/**
 * Viewport-clamped, portalled dropdown/menu panel.
 *
 * Toolbar dropdowns (board "Group by", filter pills, saved-filter menu, ...)
 * used to be plain `position: absolute; left: 0` boxes nested inside the
 * page shell's `overflow-x-clip` wrapper (`Shell` in `BoardPage.tsx`). Once
 * a trigger sat near the right edge of a narrow (mobile) viewport, the
 * panel's box could extend past `100vw` — and Chromium's `overflow-x-clip`
 * suppresses paint of the *entire* absolutely-positioned box in that case,
 * not just the overflowing slice, making the (fully interactive, DOM-
 * present) menu invisible to a real touchscreen user.
 *
 * `DropdownPanel` fixes this at the pattern level: it portals the panel to
 * `document.body` (escaping any clipping ancestor, mirroring the existing
 * `Modal` / `MobileSidebarDrawer` portal pattern) and positions it with
 * `position: fixed`, measuring the trigger + panel and clamping the panel
 * fully inside the viewport (with an 8px margin) on every open, resize, and
 * scroll.
 *
 * Outside-click/escape-to-close remains the caller's responsibility (it
 * already has a ref around the trigger); pass `panelRef` through so the
 * caller's outside-click check also treats clicks inside the (now-portalled)
 * panel as "inside."
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

const VIEWPORT_MARGIN = 8;
const GAP = 6;

export interface DropdownPanelProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Which edge of the anchor the panel prefers to align to before clamping. */
  align?: 'start' | 'end';
  className?: string;
  role?: string;
  'aria-label'?: string;
  children: ReactNode;
  panelRef?: React.RefObject<HTMLDivElement>;
}

export function DropdownPanel({
  open,
  anchorRef,
  align = 'start',
  className,
  role = 'menu',
  'aria-label': ariaLabel,
  children,
  panelRef: externalPanelRef,
}: DropdownPanelProps) {
  const internalRef = useRef<HTMLDivElement>(null);
  const panelRef = externalPanelRef ?? internalRef;
  // Start hidden (but rendered, so we can measure it) to avoid a one-frame
  // flash at the wrong position before the first layout pass.
  const [style, setStyle] = useState<CSSProperties>({
    position: 'fixed',
    top: -9999,
    left: -9999,
    visibility: 'hidden',
  });

  useLayoutEffect(() => {
    if (!open) return;

    function reposition() {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const anchorRect = anchor.getBoundingClientRect();
      const panelWidth = panel.offsetWidth;
      const panelHeight = panel.offsetHeight;

      let left = align === 'end' ? anchorRect.right - panelWidth : anchorRect.left;
      const maxLeft = Math.max(window.innerWidth - panelWidth - VIEWPORT_MARGIN, VIEWPORT_MARGIN);
      left = Math.min(Math.max(left, VIEWPORT_MARGIN), maxLeft);

      let top = anchorRect.bottom + GAP;
      const overflowsBottom = top + panelHeight > window.innerHeight - VIEWPORT_MARGIN;
      if (overflowsBottom && anchorRect.top - panelHeight - GAP > VIEWPORT_MARGIN) {
        // Flip above the trigger when there's more room there.
        top = anchorRect.top - panelHeight - GAP;
      }

      setStyle({ position: 'fixed', top, left, visibility: 'visible' });
    }

    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, align, anchorRef, panelRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      role={role}
      aria-label={ariaLabel}
      style={style}
      className={cn('z-40', className)}
    >
      {children}
    </div>,
    document.body,
  );
}

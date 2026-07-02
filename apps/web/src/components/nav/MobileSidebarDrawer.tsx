/**
 * Below-`lg` overlay drawer version of the primary sidebar.
 *
 * Opened via the header hamburger (`nav-sidebar-drawer-toggle`), closed via
 * the backdrop, the close button, Escape, or navigating to any link inside
 * it. Reuses `useOverlay` — the same focus-trap / body-scroll-lock / Escape
 * behavior as `Modal` and `IssueDetailDrawer`, per the BACKLOG acceptance
 * criteria ("matches the existing Modal/useOverlay pattern").
 *
 * Only mounted while open (matches `Modal`'s `if (!open) return null`) so
 * there is never a second, merely-hidden copy of the nav links competing
 * with the desktop sidebar's for accessible-name lookups in tests.
 */
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSidebarContext } from '@/contexts/SidebarContext';
import { useOverlay } from '@/lib/useOverlay';
import { SidebarNavContent } from './SidebarNavContent';
import { CloseIcon } from './sidebarIcons';

export function MobileSidebarDrawer() {
  const { mobileOpen, closeMobile } = useSidebarContext();
  const panelRef = useRef<HTMLDivElement>(null);

  useOverlay({ open: mobileOpen, onClose: closeMobile, containerRef: panelRef });

  if (!mobileOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-40 flex lg:hidden" role="presentation">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink-900/35 backdrop-blur-[2px] animate-nl-fade-in"
        onClick={closeMobile}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        data-testid="nav-sidebar-drawer"
        className="nl-sidebar-drawer-animate relative z-10 flex h-full w-72 max-w-[85vw] flex-col border-r border-ink-200 bg-white shadow-modal outline-none"
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-3 py-2.5">
          <span className="font-display text-sm font-semibold tracking-[-0.01em] text-ink-900">
            Navigate
          </span>
          <button
            type="button"
            onClick={closeMobile}
            aria-label="Close navigation"
            className="-mr-1 rounded p-1.5 text-ink-400 transition-colors duration-[120ms] hover:bg-ink-100 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        <SidebarNavContent collapsed={false} onNavigate={closeMobile} />
      </div>
    </div>,
    document.body,
  );
}

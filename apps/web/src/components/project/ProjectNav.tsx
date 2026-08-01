import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useUnsavedChangesGuard } from '@/lib/unsavedChangesGuard';
import { PRIMARY_PROJECT_VIEWS, SECONDARY_PROJECT_VIEWS } from './projectViews';

/**
 * Per-project sub-navigation shown under the app header.
 *
 * Layout:
 *  [Board] [Backlog] [Triage] [Docs] [Reports]  [More ▾]     [Settings ⚙]
 *
 * The primary tabs live in a horizontally scrollable strip; More and Settings
 * sit outside it and are therefore visible and clickable at every viewport
 * width. Do NOT move More back inside the strip: an `overflow-x-auto`
 * ancestor clips on both axes and would swallow its dropdown.
 *
 * "More" collapses: Analytics · Roadmap · Poker · Standup · Automation.
 * When the active route is one of those, the button reads "More · <label>"
 * and adopts the cobalt-signal active styling so the user never feels lost.
 *
 * Settings is right-pinned so it is always one click away.
 *
 * DISPATCH design-system tokens:
 *  - ink-* graphite neutrals for inactive states
 *  - signal-600 (#2563EB cobalt) for active tab underline, More active state,
 *    focus rings, and the Settings hover
 *  - IBM Plex Sans medium weight (font-sans is IBM Plex Sans)
 *  - border-b-2 underline indicator for primary active tabs
 *  - shadow-dropdown + rounded-md for the More menu
 *
 * ACCESSIBILITY:
 *  - nav aria-label="Project navigation"
 *  - More button: aria-haspopup="menu", aria-expanded, aria-controls
 *  - Menu: role="menu", aria-label="More project views"
 *  - Menu items: role="menuitem"
 *  - Escape closes menu; clicking outside closes; clicking item navigates+closes
 *  - Focus management: first item receives focus on open; tab-within cycles
 *  - Visible focus-visible ring using signal-* cobalt
 *  - prefers-reduced-motion: transition durations honoured through Tailwind
 */

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/*
 * Both lists come from `projectViews.ts` now — see its header for why. They
 * were two hand-maintained arrays that had drifted apart from the sidebar's
 * own third list, so the app disagreed with itself about which views a project
 * even has.
 */
const PRIMARY_TABS = PRIMARY_PROJECT_VIEWS;
const MORE_TABS = SECONDARY_PROJECT_VIEWS;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shared active-tab style: cobalt underline + ink-900 text */
const activeTabCls =
  'border-signal-600 text-signal-700 font-semibold';

/** Shared inactive-tab style */
const inactiveTabCls =
  'border-transparent text-ink-500 hover:text-ink-800 hover:border-ink-300';

/**
 * Base style shared by all primary NavLink tabs.
 *
 * NOTE: the `-mb-px` that pulls the active underline onto the nav's own
 * bottom border lives on the SCROLLER (see the render below), not here. On
 * the tab it would make each tab 1px taller than its scroll container, and
 * the container's `overflow-y` would clip exactly the 2px underline that
 * marks the active tab.
 */
const tabBaseCls =
  'relative shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ' +
  'transition-colors duration-[120ms] ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-300 focus-visible:ring-offset-1 rounded-t';

// ---------------------------------------------------------------------------
// GearIcon — inline SVG so we avoid an icon-lib dependency
// ---------------------------------------------------------------------------

function GearIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// ChevronDownIcon
// ---------------------------------------------------------------------------

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        'transition-transform duration-[120ms] motion-reduce:transition-none',
        open ? 'rotate-180' : 'rotate-0',
      )}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// MoreMenu — dropdown for collapsed tabs
// ---------------------------------------------------------------------------

interface MoreMenuProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
  /** Ref so the menu container can be measured for positioning */
  menuRef: React.RefObject<HTMLDivElement>;
  /** See `ProjectNav`'s `guardNavClick` — same unsaved-changes gate, applied per-item. */
  guardNavClick: (to: string, andThen?: () => void) => (e: React.MouseEvent) => void;
}

function MoreMenu({ projectId, open, onClose, menuRef, guardNavClick }: MoreMenuProps) {
  // Close on focus-out — but ONLY when focus actually lands somewhere else.
  //
  // `relatedTarget === null` means focus went nowhere (it fell back to the
  // document body). That happens when a re-render replaces the currently
  // focused node — and this menu focuses its first item on open, so a board
  // still streaming in data would blur that item a beat later and the menu
  // slammed shut on its own, before the user could pick anything. It made
  // every "open More, choose a view" flow intermittently impossible, and it
  // is why the analytics/automation/roadmap/standups e2e specs hung.
  //
  // A null relatedTarget is never a deliberate "user moved away": real
  // click-away is handled by the document pointerdown listener below, and
  // keyboard tab-away still reports the element being moved to.
  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      if (e.relatedTarget === null) return;
      if (!menuRef.current?.contains(e.relatedTarget as Node)) {
        onClose();
      }
    },
    [menuRef, onClose],
  );

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="More project views"
      id="more-project-views-menu"
      onBlur={handleBlur}
      className={cn(
        // Right-anchored by default, left-anchored from `sm` up. Once the
        // tabs scroll (narrow viewports) the More button sits near the right
        // edge, and a left-anchored 176px menu ran off-screen — where the
        // shell's `overflow-x-clip` silently cut it off. From `sm` the
        // button is mid-nav, so the original left anchoring is preserved.
        'absolute right-0 top-full z-50 mt-1 sm:left-0 sm:right-auto',
        'w-44 rounded-md border border-ink-200 bg-surface py-1',
        'shadow-dropdown',
        'motion-safe:animate-nl-fade-in',
      )}
    >
      {MORE_TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={`/projects/${projectId}/${tab.to}`}
          data-testid={'testId' in tab ? tab.testId : undefined}
          role="menuitem"
          onClick={guardNavClick(`/projects/${projectId}/${tab.to}`, onClose)}
          className={({ isActive }) =>
            cn(
              'flex w-full items-center px-3 py-1.5 text-sm transition-colors duration-[120ms]',
              'focus:outline-none focus-visible:bg-signal-50 focus-visible:text-signal-700',
              isActive
                ? 'bg-signal-50 text-signal-700 font-semibold'
                : 'text-ink-700 hover:bg-ink-50 hover:text-ink-900',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <span
                  className="mr-2 h-1.5 w-1.5 shrink-0 rounded-full bg-signal-600"
                  aria-hidden="true"
                />
              )}
              {!isActive && <span className="mr-2 h-1.5 w-1.5 shrink-0" aria-hidden="true" />}
              {tab.label}
            </>
          )}
        </NavLink>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProjectNav
// ---------------------------------------------------------------------------

export function ProjectNav({ projectId }: { projectId: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { isBlocking, confirmDiscard } = useUnsavedChangesGuard();

  // Guards every tab click against an in-progress unsaved edit elsewhere in
  // the project (today: the Pages editor). When nothing is blocking this is
  // a no-op and the `NavLink`'s own href navigates normally; when blocking,
  // it intercepts the click, confirms via the same themed dialog every other
  // destructive/discard flow uses, and only then performs the navigation.
  const guardNavClick = useCallback(
    (to: string, andThen?: () => void) => (e: React.MouseEvent) => {
      if (!isBlocking) {
        andThen?.();
        return;
      }
      e.preventDefault();
      void confirmDiscard().then((ok) => {
        if (!ok) return;
        navigate(to);
        andThen?.();
      });
    },
    [isBlocking, confirmDiscard, navigate],
  );

  // Determine whether the current route is one of the collapsed (More) tabs.
  // useLocation is safe and stable; we derive active tab by inspecting pathname.
  const location = useLocation();
  const activeMoreTab =
    MORE_TABS.find((tab) =>
      location.pathname === `/projects/${projectId}/${tab.to}` ||
      location.pathname.startsWith(`/projects/${projectId}/${tab.to}/`),
    ) ?? null;
  const isMoreActive = activeMoreTab !== null;

  // Close menu on outside click
  useEffect(() => {
    if (!moreOpen) return;
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node;
      const inButton = buttonRef.current?.contains(target) ?? false;
      const inMenu = menuRef.current?.contains(target) ?? false;
      if (!inButton && !inMenu) {
        setMoreOpen(false);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [moreOpen]);

  // Escape key closes menu and returns focus to the trigger button
  useEffect(() => {
    if (!moreOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMoreOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [moreOpen]);

  // When menu opens, move focus to the first menu item
  useEffect(() => {
    if (moreOpen) {
      // Defer so the element is in the DOM
      requestAnimationFrame(() => {
        const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
        first?.focus();
      });
    }
  }, [moreOpen]);

  function toggleMore() {
    setMoreOpen((v) => !v);
  }

  return (
    <nav
      aria-label="Project navigation"
      className="flex items-center border-b border-ink-200 bg-surface px-2 sm:px-4"
    >
      {/*
        Primary tabs — scroll sideways when they don't fit.

        This used to be `flex-1` with `shrink-0` children and no overflow
        handling, on the (since-broken) assumption that "the primary FOUR
        tabs + More + Settings always fit in one row". Promoting Docs to a
        first-class tab made five, and at 390px the row overflowed: because
        the app shell is `overflow-x-clip`, the spilled tabs were invisible,
        and the right-pinned Settings block rendered ON TOP of the "More"
        button — Chromium reported the gear icon "intercepts pointer events"
        and every "open More" test hung until it timed out.

        Now only the tabs scroll; More and Settings sit outside the scroller
        so both stay visible and hit-testable at any width.
      */}
      <div className="nl-tabstrip -mb-px flex min-w-0 items-center overflow-x-auto">
        {PRIMARY_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={`/projects/${projectId}/${tab.to}`}
            data-testid={'testId' in tab ? tab.testId : undefined}
            onClick={guardNavClick(`/projects/${projectId}/${tab.to}`)}
            className={({ isActive }) =>
              cn(tabBaseCls, isActive ? activeTabCls : inactiveTabCls)
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      {/*
        More button + dropdown — deliberately OUTSIDE the scroller above:
        an `overflow-x-auto` ancestor also clips on the Y axis, which would
        cut off this absolutely-positioned dropdown entirely.
      */}
      <div ref={containerRef} className="relative ml-0.5 shrink-0">
          <button
            ref={buttonRef}
            type="button"
            id="more-project-views-trigger"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-controls="more-project-views-menu"
            onClick={toggleMore}
            className={cn(
              // Match the tab baseline geometry so it sits flush with siblings
              'relative -mb-px flex shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
              'transition-colors duration-[120ms] motion-reduce:transition-none',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-300 focus-visible:ring-offset-1 rounded-t',
              isMoreActive
                ? // Active: cobalt underline, signal-700 text — user can see what collapsed tab is live
                  'border-signal-600 text-signal-700 font-semibold'
                : moreOpen
                  ? // Open but no active child: subtle ink tint
                    'border-ink-300 text-ink-800'
                  : 'border-transparent text-ink-500 hover:text-ink-800 hover:border-ink-300',
            )}
          >
            {/* Label: "More" normally; "More · <ActiveLabel>" when collapsed route is active */}
            <span>
              {isMoreActive ? (
                <>
                  More
                  <span className="mx-1 text-signal-400" aria-hidden="true">·</span>
                  {activeMoreTab.label}
                </>
              ) : (
                'More'
              )}
            </span>
            <ChevronDownIcon open={moreOpen} />
          </button>

          <MoreMenu
            projectId={projectId}
            open={moreOpen}
            onClose={() => setMoreOpen(false)}
            menuRef={menuRef}
            guardNavClick={guardNavClick}
          />
      </div>

      {/* Settings — right-pinned, always reachable */}
      <div className="ml-auto shrink-0 pl-2">
        <NavLink
          to={`/projects/${projectId}/settings`}
          onClick={guardNavClick(`/projects/${projectId}/settings`)}
          className={({ isActive }) =>
            cn(
              'relative -mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2 text-sm font-medium',
              'transition-colors duration-[120ms] motion-reduce:transition-none',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-300 focus-visible:ring-offset-1 rounded-t',
              isActive
                ? 'border-signal-600 text-signal-700 font-semibold'
                : 'border-transparent text-ink-400 hover:text-ink-700 hover:border-ink-300',
            )
          }
        >
          {({ isActive }) => (
            <>
              <GearIcon
                className={cn(
                  'transition-colors duration-[120ms]',
                  isActive ? 'text-signal-600' : 'text-ink-400',
                )}
              />
              <span className="hidden sm:inline">Settings</span>
            </>
          )}
        </NavLink>
      </div>
    </nav>
  );
}

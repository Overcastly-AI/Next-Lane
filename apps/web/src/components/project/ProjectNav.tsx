import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useUnsavedChangesGuard } from '@/lib/unsavedChangesGuard';

/**
 * Per-project sub-navigation shown under the app header.
 *
 * Layout:
 *  [Board] [Backlog] [Triage] [Reports]  [More ▾]       [Settings ⚙]
 *
 * On any viewport (including 390 px mobile) the primary four tabs + More +
 * Settings always fit in one row with no horizontal overflow.
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

const PRIMARY_TABS = [
  { to: 'board',       label: 'Board'   },
  { to: 'backlog',     label: 'Backlog' },
  { to: 'triage',      label: 'Triage'  },
  // Pages is a flagship pillar (project wiki + knowledge graph) — a
  // first-class tab, not a "More" item (the founder couldn't find it there).
  { to: 'pages',       label: 'Pages',    testId: 'nav-pages' as const },
  { to: 'reports',     label: 'Reports' },
] as const;

const MORE_TABS = [
  { to: 'analytics',   label: 'Analytics'  },
  { to: 'dashboards',  label: 'Dashboards' },
  { to: 'roadmap',     label: 'Roadmap'    },
  { to: 'poker',       label: 'Poker'      },
  { to: 'standups',    label: 'Standup'    },
  { to: 'automations', label: 'Automation', testId: 'nav-automation' as const },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shared active-tab style: cobalt underline + ink-900 text */
const activeTabCls =
  'border-signal-600 text-signal-700 font-semibold';

/** Shared inactive-tab style */
const inactiveTabCls =
  'border-transparent text-ink-500 hover:text-ink-800 hover:border-ink-300';

/** Base style shared by all primary NavLink tabs */
const tabBaseCls =
  'relative -mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ' +
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
  // Close on outside click / focus-out
  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
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
        'absolute left-0 top-full z-50 mt-1',
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
      {/* Primary tabs — always visible */}
      <div className="flex min-w-0 flex-1 items-center">
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

        {/* More button + dropdown */}
        <div ref={containerRef} className="relative ml-0.5">
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

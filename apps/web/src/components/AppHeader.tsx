import { useState, useRef, useEffect, useMemo } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import type { WorkspaceDto } from '@next-lane/shared';
import { Logo } from './Logo';
import { Avatar } from './ui/Avatar';
import { NotificationBell } from './NotificationBell';
import { QuickLinksMenu } from './QuickLinksMenu';
import { useAuth } from '@/auth/AuthContext';
import { useCommandPalette } from './CommandPaletteProvider';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { getApiUrl } from '@/api/config';

// ── Workspace logo (existing helper) ─────────────────────────────────────────

/** Renders the workspace logo if one is set, otherwise the default product mark. */
function WorkspaceLogoMark() {
  const { activeWorkspace } = useWorkspaceContext();

  if (activeWorkspace?.logoUrl) {
    const src = `${getApiUrl()}/api${activeWorkspace.logoUrl}`;
    return (
      <img
        src={src}
        alt={activeWorkspace.name}
        data-testid="workspace-logo"
        className="h-7 w-auto max-w-[96px] rounded object-contain sm:max-w-[120px]"
      />
    );
  }

  // Mark-only on mobile (no wordmark) so the header bar has room for the
  // workspace chip + action icons without clipping; full wordmark on sm+.
  return (
    <>
      <span className="sm:hidden">
        <Logo compact />
      </span>
      <span className="hidden sm:inline-flex">
        <Logo />
      </span>
    </>
  );
}

// ── Workspace chip + switcher ─────────────────────────────────────────────────

// Below this many workspaces a flat list is perfectly usable; above it we add
// search/filter + a "Recent" shortcut section (product-audit finding: the
// demo account has 50+ workspaces and the plain list becomes unusable).
const SEARCH_THRESHOLD = 8;

/** A single row in the workspace switcher dropdown (also used for "Recent"). */
function WorkspaceItem({
  ws,
  isActive,
  onSelect,
}: {
  ws: WorkspaceDto;
  isActive: boolean;
  onSelect: (ws: WorkspaceDto) => void;
}) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={() => onSelect(ws)}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-[120ms] hover:bg-ink-50 focus-visible:outline-none focus-visible:bg-ink-50 ${
        isActive ? 'font-semibold text-signal-700' : 'text-ink-700'
      }`}
      data-testid="workspace-switcher-item"
    >
      <span className="min-w-0 truncate">{ws.name}</span>
      {isActive && (
        <svg
          className="ml-auto h-3.5 w-3.5 shrink-0 text-signal-600"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}

function WorkspaceChip() {
  const { activeWorkspace, workspaces, setActiveWorkspaceId, recentWorkspaces } =
    useWorkspaceContext();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Autofocus the search box every time the dropdown opens, so typing works
  // immediately (per-keystroke, no extra click). The query itself is reset
  // synchronously in the trigger's onClick (not here) — resetting it in an
  // effect left a one-paint window where the freshly-mounted dropdown (the
  // `{open && …}` block below unmounts/remounts the search input on every
  // toggle) still showed the previous query, which a fast reopen-and-type
  // could race and type into.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    // Batched with the setOpen above (React 18) — the freshly-mounted
    // dropdown's first render already has an empty query, no race.
    if (next) setQuery('');
  }

  const trimmedQuery = query.trim().toLowerCase();
  const filteredWorkspaces = useMemo(() => {
    if (!trimmedQuery) return workspaces;
    return workspaces.filter((ws) => ws.name.toLowerCase().includes(trimmedQuery));
  }, [workspaces, trimmedQuery]);

  if (!activeWorkspace) return null;

  const hasMultiple = workspaces.length > 1;
  const showSearch = workspaces.length > SEARCH_THRESHOLD;
  const showRecent = showSearch && !trimmedQuery && recentWorkspaces.length > 0;

  function selectWorkspace(ws: WorkspaceDto) {
    setActiveWorkspaceId(ws.id);
    setOpen(false);
    // Land on the newly-active workspace's home so the content re-scopes —
    // otherwise switching only recolors the header while you're still
    // looking at the previous workspace.
    if (activeWorkspace && ws.id !== activeWorkspace.id) navigate('/');
  }

  // Shared chip button styling. Width is capped tighter on mobile so the header
  // (logo + chip + actions) fits a 390px viewport without clipping.
  const chipBase =
    'flex max-w-[120px] items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-ink-800 transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 hover:bg-ink-100 sm:max-w-[160px]';

  if (!hasMultiple) {
    // Single workspace — chip is just a link to settings.
    return (
      <Link
        to={`/workspaces/${activeWorkspace.id}/settings`}
        className={chipBase}
        aria-label={`Workspace: ${activeWorkspace.name}. Open settings.`}
        data-testid="workspace-chip"
      >
        <span className="truncate">{activeWorkspace.name}</span>
      </Link>
    );
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Current workspace: ${activeWorkspace.name}. Switch workspace.`}
        data-testid="workspace-chip"
        className={chipBase}
      >
        <span className="truncate">{activeWorkspace.name}</span>
        {/* Chevron */}
        <svg
          className="h-3.5 w-3.5 shrink-0 text-ink-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Switch workspace"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
          className="absolute left-0 z-30 mt-1 w-64 overflow-hidden rounded-xl border border-ink-100 bg-white py-1 shadow-dropdown animate-nl-fade-in"
        >
          {/* Search/filter — only once the list is long enough to need it. */}
          {showSearch && (
            <div className="px-2 pb-1.5 pt-1">
              <div className="relative">
                <svg
                  className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path strokeLinecap="round" d="M21 21l-4.3-4.3" />
                </svg>
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search workspaces…"
                  aria-label="Search workspaces"
                  data-testid="workspace-switcher-search"
                  className="w-full rounded-md border border-ink-200 bg-ink-50 py-1.5 pl-7 pr-2 text-sm text-ink-800 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-signal-500"
                />
              </div>
            </div>
          )}

          {/* Recently visited — hidden while filtering (would just duplicate
              the matching row already in the full list below). */}
          {showRecent && (
            <div className="border-b border-ink-100 pb-1">
              <p
                id="workspace-switcher-recent-heading"
                className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400"
              >
                Recent
              </p>
              {recentWorkspaces.map((ws) => (
                <WorkspaceItem
                  key={`recent-${ws.id}`}
                  ws={ws}
                  isActive={ws.id === activeWorkspace.id}
                  onSelect={selectWorkspace}
                />
              ))}
            </div>
          )}

          {/* Workspace list */}
          <div className={showSearch ? 'max-h-64 overflow-y-auto' : undefined}>
            {filteredWorkspaces.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-ink-400">
                No workspaces match “{query.trim()}”.
              </p>
            ) : (
              filteredWorkspaces.map((ws) => (
                <WorkspaceItem
                  key={ws.id}
                  ws={ws}
                  isActive={ws.id === activeWorkspace.id}
                  onSelect={selectWorkspace}
                />
              ))
            )}
          </div>

          {/* Footer links */}
          <div className="border-t border-ink-100 pt-1">
            <Link
              to={`/workspaces/${activeWorkspace.id}/settings`}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink-600 transition-colors duration-[120ms] hover:bg-ink-50 hover:text-ink-900 focus-visible:outline-none focus-visible:bg-ink-50"
            >
              Workspace settings
            </Link>
            <Link
              to={`/workspaces/${activeWorkspace.id}/members`}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink-600 transition-colors duration-[120ms] hover:bg-ink-50 hover:text-ink-900 focus-visible:outline-none focus-visible:bg-ink-50"
            >
              Members
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AppHeader ─────────────────────────────────────────────────────────────────

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { open: openPalette } = useCommandPalette();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-ink-200 bg-white/96 backdrop-blur-sm px-4 py-2 sm:h-13 sm:flex-nowrap sm:gap-3 sm:py-0">
      {/* Brand / logo */}
      <Link to="/" className="shrink-0" aria-label="Home">
        <WorkspaceLogoMark />
      </Link>

      {/* Workspace chip — placed immediately after the logo */}
      <WorkspaceChip />

      {/*
        Page breadcrumb (e.g. "Projects / {name}"). On mobile it wraps to its
        own full-width row below the icon row — competing for space inline
        with the chip + action icons is what used to crush the project name
        down to 2-3 characters at 393px. From `sm:` up it returns to sitting
        inline between the chip and the nav links, unchanged from before.
      */}
      <div className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:min-w-0 sm:flex-1">
        {children}
      </div>
      <NavLink
        to="/my-work"
        className={({ isActive }) =>
          `hidden shrink-0 rounded px-2.5 py-1.5 text-sm font-medium transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 md:inline-block ${
            isActive
              ? 'bg-signal-50 text-signal-700 font-semibold ring-1 ring-inset ring-signal-100'
              : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
          }`
        }
      >
        My Work
      </NavLink>
      <NavLink
        to="/my-board"
        className={({ isActive }) =>
          `hidden shrink-0 rounded px-2.5 py-1.5 text-sm font-medium transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 md:inline-block ${
            isActive
              ? 'bg-signal-50 text-signal-700 font-semibold ring-1 ring-inset ring-signal-100'
              : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
          }`
        }
      >
        My Board
      </NavLink>
      <NavLink
        to="/me/analytics"
        className={({ isActive }) =>
          `hidden shrink-0 rounded px-2.5 py-1.5 text-sm font-medium transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 md:inline-block ${
            isActive
              ? 'bg-signal-50 text-signal-700 font-semibold ring-1 ring-inset ring-signal-100'
              : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
          }`
        }
        data-testid="nav-my-analytics"
      >
        Insights
      </NavLink>
      {/* Search / command palette trigger — desktop */}
      <button
        type="button"
        onClick={openPalette}
        aria-label="Open command palette"
        aria-keyshortcuts="Meta+K Control+K"
        className="hidden shrink-0 items-center gap-2 rounded border border-ink-200 bg-ink-50 px-2.5 py-1.5 text-sm text-ink-400 transition-all duration-[120ms] hover:border-ink-300 hover:bg-ink-100 hover:text-ink-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 sm:flex"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path strokeLinecap="round" d="M21 21l-4.3-4.3" />
        </svg>
        <span className="text-xs">Search</span>
        <kbd className="rounded border border-ink-200 bg-white px-1 py-0.5 font-mono text-[10px] text-ink-400">
          ⌘K
        </kbd>
      </button>
      {/* Mobile search icon */}
      <button
        type="button"
        onClick={openPalette}
        aria-label="Open command palette"
        className="shrink-0 rounded p-2 text-ink-500 transition-colors duration-[120ms] hover:bg-ink-100 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 sm:hidden"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path strokeLinecap="round" d="M21 21l-4.3-4.3" />
        </svg>
      </button>
      <NotificationBell />
      {/* Quick Links */}
      <QuickLinksMenu />
      {/* User menu */}
      <div className="relative shrink-0">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 rounded-full p-0.5 transition-all duration-[120ms] hover:bg-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-testid="user-menu-button"
        >
          <Avatar user={user} size="md" />
        </button>
        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
            />
            <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-ink-100 bg-white py-1 shadow-dropdown animate-nl-fade-in">
              {user && (
                <div className="border-b border-ink-100 px-3 py-2.5">
                  <p className="truncate text-sm font-semibold text-ink-900">
                    {user.name}
                  </p>
                  <p className="truncate text-xs text-ink-500">{user.email}</p>
                </div>
              )}
              {/* Primary nav — shown here on mobile, where the header links are
                  hidden to keep the bar from overflowing. */}
              <div className="border-b border-ink-100 py-1 md:hidden">
                {[
                  { to: '/my-work', label: 'My Work' },
                  { to: '/my-board', label: 'My Board' },
                  { to: '/me/analytics', label: 'Insights' },
                ].map((item) => (
                  <button
                    key={item.to}
                    onClick={() => {
                      setMenuOpen(false);
                      navigate(item.to);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-ink-700 transition-colors duration-[120ms] hover:bg-ink-50 hover:text-ink-900 focus-visible:outline-none focus-visible:bg-ink-50"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  navigate('/me/settings');
                }}
                className="w-full px-3 py-2 text-left text-sm text-ink-700 transition-colors duration-[120ms] hover:bg-ink-50 hover:text-ink-900 focus-visible:outline-none focus-visible:bg-ink-50"
              >
                Profile settings
              </button>
              <button
                onClick={logout}
                className="w-full px-3 py-2 text-left text-sm text-ink-700 transition-colors duration-[120ms] hover:bg-ink-50 hover:text-ink-900 focus-visible:outline-none focus-visible:bg-ink-50"
              >
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}

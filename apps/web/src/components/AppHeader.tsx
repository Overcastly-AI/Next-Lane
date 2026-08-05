import { useState, useRef, useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Logo } from './Logo';
import { Avatar } from './ui/Avatar';
import { NotificationBell } from './NotificationBell';
import { QuickLinksMenu } from './QuickLinksMenu';
import { ThemeToggle } from './ThemeToggle';
import { WorkspaceSwitcherMenuContent } from './nav/WorkspaceSwitcherMenuContent';
import { useAuth } from '@/auth/AuthContext';
import { useCommandPalette } from './CommandPaletteProvider';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useSwitchWorkspace } from '@/lib/useSwitchWorkspace';
import { useSidebarContext } from '@/contexts/SidebarContext';
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
//
// The searchable dropdown body (search box, "Recent", list, footer links)
// lives in `WorkspaceSwitcherMenuContent` and is shared verbatim with the
// sidebar's workspace switcher — see that file's header comment.

function WorkspaceChip() {
  const { activeWorkspace, workspaces } = useWorkspaceContext();
  const switchWorkspace = useSwitchWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  if (!activeWorkspace) return null;

  const hasMultiple = workspaces.length > 1;

  // Shared chip button styling. Width is capped tighter on mobile so the header
  // (hamburger + logo + chip + actions) fits a 375-390px viewport without
  // wrapping the trailing icons onto their own row.
  const chipBase =
    'flex max-w-[84px] items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-ink-800 transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 hover:bg-ink-100 sm:max-w-[160px]';

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
        onClick={() => setOpen((v) => !v)}
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
          className="absolute left-0 z-30 mt-1 w-64 overflow-hidden rounded-xl border border-ink-100 bg-surface py-1 shadow-dropdown animate-nl-fade-in"
        >
          <WorkspaceSwitcherMenuContent
            onSelect={(ws) => {
              switchWorkspace(ws);
              setOpen(false);
            }}
            onNavigate={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

// ── AppHeader ─────────────────────────────────────────────────────────────────

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { open: openPalette } = useCommandPalette();
  const { openMobile } = useSidebarContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-ink-200 bg-surface/95 backdrop-blur-sm px-4 py-2 sm:h-13 sm:flex-nowrap sm:gap-3 sm:py-0">
      {/* Sidebar drawer toggle — only below the lg breakpoint, where the
          persistent sidebar becomes an overlay drawer. */}
      <button
        type="button"
        onClick={openMobile}
        aria-label="Open navigation"
        data-testid="nav-sidebar-drawer-toggle"
        className="-ml-1 shrink-0 rounded p-1 text-ink-500 transition-colors duration-[120ms] hover:bg-ink-100 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 lg:hidden"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
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
          `hidden shrink-0 rounded px-2.5 py-1.5 text-sm font-medium transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 md:inline-block lg:hidden ${
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
          `hidden shrink-0 rounded px-2.5 py-1.5 text-sm font-medium transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 md:inline-block lg:hidden ${
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
          `hidden shrink-0 rounded px-2.5 py-1.5 text-sm font-medium transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 md:inline-block lg:hidden ${
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
        // h-9 pins this to the 36px of every other control in this cluster
        // (notifications, quick links, avatar). Before, its height was whatever
        // the ⌘K chip happened to compute to — 40px — so the one element with a
        // visible border was also the only one 2px proud of its neighbours top
        // and bottom, which reads as sloppy padding even though the padding
        // itself was fine. Height set explicitly rather than tuning py-*, so a
        // future change to the chip cannot silently resize the button again.
        className="hidden h-9 shrink-0 items-center gap-2 rounded-md border border-ink-200 bg-ink-50 px-2.5 text-sm text-ink-400 transition-all duration-[120ms] hover:border-ink-300 hover:bg-ink-100 hover:text-ink-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 sm:flex"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path strokeLinecap="round" d="M21 21l-4.3-4.3" />
        </svg>
        <span className="text-xs">Search</span>
        {/* `leading-none` matters: Tailwind's text-sm on the button sets an
            ABSOLUTE line-height of 20px, which this 10px chip inherits — so a
            10px glyph occupied a 26px box and was what made the button 40px
            tall in the first place. */}
        <kbd className="rounded border border-ink-200 bg-surface px-1 py-0.5 font-mono text-[10px] leading-none text-ink-400">
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
            <div
              data-testid="user-menu-dropdown"
              className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-ink-100 bg-surface py-1 shadow-dropdown animate-nl-fade-in"
            >
              {user && (
                <div className="border-b border-ink-100 px-3 py-2.5">
                  <p className="truncate text-sm font-semibold text-ink-900">
                    {user.name}
                  </p>
                  <p className="truncate text-xs text-ink-500">{user.email}</p>
                </div>
              )}
              <div className="border-b border-ink-100 px-3 py-2.5">
                <p className="mb-1.5 text-xs font-semibold text-ink-500">Theme</p>
                <ThemeToggle />
              </div>
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
              {/*
               * Instance settings — SSO/OIDC and anything else that applies to
               * the whole install rather than to one workspace.
               *
               * Here rather than in the sidebar, which it used to occupy as a
               * permanently-visible labelled group. You configure SSO once,
               * when you stand the instance up; the sidebar is for the places
               * you go every day. Gated on `isInstanceAdmin`, a strictly
               * narrower check than workspace ADMIN, exactly as the page
               * itself gates.
               */}
              {user?.isInstanceAdmin && (
                <button
                  data-testid="user-menu-instance-settings"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate('/admin');
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-ink-700 transition-colors duration-[120ms] hover:bg-ink-50 hover:text-ink-900 focus-visible:outline-none focus-visible:bg-ink-50"
                >
                  Instance settings
                </button>
              )}
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

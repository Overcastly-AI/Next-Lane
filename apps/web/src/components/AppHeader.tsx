import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Logo } from './Logo';
import { Avatar } from './ui/Avatar';
import { NotificationBell } from './NotificationBell';
import { useAuth } from '@/auth/AuthContext';
import { useCommandPalette } from './CommandPaletteProvider';

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { open: openPalette } = useCommandPalette();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 flex h-13 items-center gap-2 border-b border-ink-200 bg-white/96 backdrop-blur-sm px-4 sm:gap-3">
      <Link to="/" className="shrink-0">
        <Logo />
      </Link>
      <div className="min-w-0 flex-1">{children}</div>
      <NavLink
        to="/my-work"
        className={({ isActive }) =>
          `shrink-0 rounded px-2.5 py-1.5 text-sm font-medium transition-colors duration-[120ms] ${
            isActive
              ? 'bg-signal-50 text-signal-700 font-semibold'
              : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
          }`
        }
      >
        My Work
      </NavLink>
      {/* Search / command palette trigger — desktop */}
      <button
        type="button"
        onClick={openPalette}
        aria-label="Open command palette"
        aria-keyshortcuts="Meta+K Control+K"
        className="hidden shrink-0 items-center gap-2 rounded border border-ink-200 bg-ink-50 px-2.5 py-1.5 text-sm text-ink-400 transition-all duration-[120ms] hover:border-ink-300 hover:bg-ink-100 hover:text-ink-600 sm:flex"
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
        className="shrink-0 rounded p-2 text-ink-500 transition-colors duration-[120ms] hover:bg-ink-100 hover:text-ink-700 sm:hidden"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path strokeLinecap="round" d="M21 21l-4.3-4.3" />
        </svg>
      </button>
      <NotificationBell />
      {/* User menu */}
      <div className="relative shrink-0">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 rounded-full p-0.5 transition-all duration-[120ms] hover:bg-ink-100"
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
              <button
                onClick={() => {
                  setMenuOpen(false);
                  navigate('/me/settings');
                }}
                className="w-full px-3 py-2 text-left text-sm text-ink-700 transition-colors duration-[120ms] hover:bg-ink-50 hover:text-ink-900"
              >
                Profile settings
              </button>
              <button
                onClick={logout}
                className="w-full px-3 py-2 text-left text-sm text-ink-700 transition-colors duration-[120ms] hover:bg-ink-50 hover:text-ink-900"
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

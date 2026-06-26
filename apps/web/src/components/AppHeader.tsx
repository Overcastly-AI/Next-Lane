import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Logo } from './Logo';
import { Avatar } from './ui/Avatar';
import { NotificationBell } from './NotificationBell';
import { useAuth } from '@/auth/AuthContext';
import { useCommandPalette } from './CommandPaletteProvider';

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { open: openPalette } = useCommandPalette();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-gray-200 bg-white px-4 sm:gap-4">
      <Link to="/" className="shrink-0">
        <Logo />
      </Link>
      <div className="min-w-0 flex-1">{children}</div>
      <NavLink
        to="/my-work"
        className={({ isActive }) =>
          `shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${
            isActive
              ? 'bg-brand-50 text-brand-700'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          }`
        }
      >
        My Work
      </NavLink>
      <button
        type="button"
        onClick={openPalette}
        aria-label="Open command palette"
        aria-keyshortcuts="Meta+K Control+K"
        className="hidden shrink-0 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 sm:flex"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path strokeLinecap="round" d="M21 21l-4.3-4.3" />
        </svg>
        <span>Search</span>
        <kbd className="rounded border border-gray-200 bg-white px-1 py-0.5 font-sans text-[10px] text-gray-400">
          ⌘K
        </kbd>
      </button>
      <button
        type="button"
        onClick={openPalette}
        aria-label="Open command palette"
        className="shrink-0 rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 sm:hidden"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path strokeLinecap="round" d="M21 21l-4.3-4.3" />
        </svg>
      </button>
      <NotificationBell />
      <div className="relative shrink-0">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-gray-100"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
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
            <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
              {user && (
                <div className="border-b border-gray-100 px-3 py-2">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {user.name}
                  </p>
                  <p className="truncate text-xs text-gray-500">{user.email}</p>
                </div>
              )}
              <button
                onClick={logout}
                className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
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

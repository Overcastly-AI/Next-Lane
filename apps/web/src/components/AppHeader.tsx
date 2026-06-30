import { useState, useRef, useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Logo } from './Logo';
import { Avatar } from './ui/Avatar';
import { NotificationBell } from './NotificationBell';
import { useAuth } from '@/auth/AuthContext';
import { useCommandPalette } from './CommandPaletteProvider';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { getApiUrl } from '@/api/config';
import {
  useQuickLinks,
  useCreateQuickLink,
  useDeleteQuickLink,
  useUpdateQuickLink,
} from '@/api/quick-links';
import type { QuickLinkDto } from '@next-lane/shared';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';

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

function WorkspaceChip() {
  const { activeWorkspace, workspaces, setActiveWorkspaceId } = useWorkspaceContext();
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
          className="absolute left-0 z-30 mt-1 w-56 overflow-hidden rounded-xl border border-ink-100 bg-white py-1 shadow-dropdown animate-nl-fade-in"
        >
          {/* Workspace list */}
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              role="menuitem"
              type="button"
              onClick={() => {
                setActiveWorkspaceId(ws.id);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-[120ms] hover:bg-ink-50 focus-visible:outline-none focus-visible:bg-ink-50 ${
                ws.id === activeWorkspace.id
                  ? 'font-semibold text-signal-700'
                  : 'text-ink-700'
              }`}
              data-testid="workspace-switcher-item"
            >
              <span className="min-w-0 truncate">{ws.name}</span>
              {ws.id === activeWorkspace.id && (
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
          ))}

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

// ── Quick Links dropdown ──────────────────────────────────────────────────────

function QuickLinksMenu() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const { data: links = [], isLoading } = useQuickLinks();
  const createLink = useCreateQuickLink();
  const deleteLink = useDeleteQuickLink();
  const updateLink = useUpdateQuickLink();

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingId(null);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function validateUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return 'URL must start with http:// or https://';
      }
      return null;
    } catch {
      return 'Please enter a valid URL (http:// or https://)';
    }
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const label = addLabel.trim();
    const url = addUrl.trim();
    if (!label) {
      setAddError('Label is required.');
      return;
    }
    const urlErr = validateUrl(url);
    if (urlErr) {
      setAddError(urlErr);
      return;
    }
    setAddError(null);
    createLink.mutate(
      { label, url },
      {
        onSuccess: () => {
          setAddLabel('');
          setAddUrl('');
          toast.success('Quick link added.');
        },
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not add quick link.')),
      },
    );
  }

  function handleDelete(link: QuickLinkDto) {
    deleteLink.mutate(link.id, {
      onError: (err) =>
        toast.error(errorMessage(err, 'Could not delete quick link.')),
    });
  }

  function startEdit(link: QuickLinkDto) {
    setEditingId(link.id);
    setEditLabel(link.label);
    setEditUrl(link.url);
  }

  function handleEditSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    const label = editLabel.trim();
    const url = editUrl.trim();
    if (!label || validateUrl(url)) return;
    updateLink.mutate(
      { id: editingId, label, url },
      {
        onSuccess: () => {
          setEditingId(null);
          toast.success('Quick link updated.');
        },
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not update quick link.')),
      },
    );
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Quick links"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="quick-links-button"
        className="flex items-center gap-1.5 rounded p-2 text-ink-500 transition-colors duration-[120ms] hover:bg-ink-100 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1"
        title="Quick links"
      >
        {/* External link icon */}
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.828 10.172a4 4 0 0 0-5.656 0l-4 4a4 4 0 1 0 5.656 5.656l1.102-1.101"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.172 13.828a4 4 0 0 0 5.656 0l4-4a4 4 0 0 0-5.656-5.656l-1.1 1.1"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Quick links"
          className="absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-xl border border-ink-100 bg-white shadow-dropdown animate-nl-fade-in"
        >
          {/* Header */}
          <div className="border-b border-ink-100 px-3 py-2.5">
            <p className="text-sm font-semibold text-ink-900">Quick links</p>
          </div>

          {/* Link list */}
          <div className="max-h-56 overflow-y-auto">
            {isLoading ? (
              <p className="px-3 py-4 text-center text-sm text-ink-400">Loading…</p>
            ) : links.length === 0 ? (
              <p
                className="px-3 py-5 text-center text-sm text-ink-400"
                data-testid="quick-links-empty"
              >
                No quick links yet — add shortcuts to your apps.
              </p>
            ) : (
              <ul>
                {links.map((link) =>
                  editingId === link.id ? (
                    <li key={link.id} className="px-3 py-2 border-b border-ink-50 last:border-0">
                      <form onSubmit={handleEditSave} className="flex flex-col gap-1.5">
                        <input
                          type="text"
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          placeholder="Label"
                          required
                          autoFocus
                          className="h-7 w-full rounded border border-ink-200 bg-white px-2 text-xs text-ink-900 focus:border-signal-500 focus:outline-none focus:ring-1 focus:ring-signal-200"
                        />
                        <input
                          type="url"
                          value={editUrl}
                          onChange={(e) => setEditUrl(e.target.value)}
                          placeholder="https://…"
                          required
                          className="h-7 w-full rounded border border-ink-200 bg-white px-2 text-xs text-ink-900 focus:border-signal-500 focus:outline-none focus:ring-1 focus:ring-signal-200"
                        />
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded px-2 py-0.5 text-xs text-ink-500 hover:bg-ink-100"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={updateLink.isPending}
                            className="rounded bg-signal-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-signal-700 disabled:opacity-60"
                          >
                            {updateLink.isPending ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </form>
                    </li>
                  ) : (
                    <li
                      key={link.id}
                      className="flex items-center gap-2 border-b border-ink-50 px-3 py-2 last:border-0"
                      data-testid="quick-link-row"
                    >
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        role="menuitem"
                        className="min-w-0 flex-1 truncate text-sm text-ink-700 underline-offset-2 hover:text-signal-700 hover:underline focus-visible:outline-none focus-visible:underline"
                        title={link.url}
                      >
                        {link.label}
                      </a>
                      <button
                        type="button"
                        onClick={() => startEdit(link)}
                        aria-label={`Edit quick link: ${link.label}`}
                        data-testid="quick-link-edit"
                        className="shrink-0 rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal-500"
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 0 1 2.828 0l.172.172a2 2 0 0 1 0 2.828L12 16H9v-3z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(link)}
                        aria-label={`Delete quick link: ${link.label}`}
                        data-testid="quick-link-delete"
                        disabled={deleteLink.isPending}
                        className="shrink-0 rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400 disabled:opacity-50"
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </li>
                  ),
                )}
              </ul>
            )}
          </div>

          {/* Add link form */}
          <div className="border-t border-ink-100 p-3">
            <form
              onSubmit={handleAdd}
              aria-label="Add quick link"
              data-testid="add-quick-link-form"
            >
              <div className="flex flex-col gap-1.5">
                <input
                  type="text"
                  value={addLabel}
                  onChange={(e) => {
                    setAddLabel(e.target.value);
                    setAddError(null);
                  }}
                  placeholder="Label (e.g. Figma)"
                  aria-label="Quick link label"
                  data-testid="add-quick-link-label"
                  className="h-7 w-full rounded border border-ink-200 bg-white px-2 text-xs text-ink-900 placeholder:text-ink-400 focus:border-signal-500 focus:outline-none focus:ring-1 focus:ring-signal-200"
                />
                <input
                  type="url"
                  value={addUrl}
                  onChange={(e) => {
                    setAddUrl(e.target.value);
                    setAddError(null);
                  }}
                  placeholder="https://…"
                  aria-label="Quick link URL"
                  data-testid="add-quick-link-url"
                  className="h-7 w-full rounded border border-ink-200 bg-white px-2 text-xs text-ink-900 placeholder:text-ink-400 focus:border-signal-500 focus:outline-none focus:ring-1 focus:ring-signal-200"
                />
                {addError && (
                  <p className="text-xs text-red-600" role="alert" data-testid="add-quick-link-error">
                    {addError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={createLink.isPending}
                  data-testid="add-quick-link-submit"
                  className="flex items-center justify-center gap-1.5 rounded bg-signal-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-[120ms] hover:bg-signal-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1"
                >
                  {createLink.isPending ? 'Adding…' : 'Add link'}
                </button>
              </div>
            </form>
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
    <header className="sticky top-0 z-30 flex h-13 items-center gap-2 border-b border-ink-200 bg-white/96 backdrop-blur-sm px-4 sm:gap-3">
      {/* Brand / logo */}
      <Link to="/" className="shrink-0" aria-label="Home">
        <WorkspaceLogoMark />
      </Link>

      {/* Workspace chip — placed immediately after the logo */}
      <WorkspaceChip />

      <div className="min-w-0 flex-1">{children}</div>
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

/**
 * The searchable/filterable workspace list shown inside a switcher dropdown.
 *
 * Extracted from the header `WorkspaceChip` so the exact same search +
 * "Recent" + list + footer-links logic can be reused verbatim by the
 * sidebar's workspace switcher (BACKLOG "Navigation & IA overhaul — Phase 1":
 * "reusing the existing WorkspaceChip logic/context — do NOT duplicate
 * state"). Both callers read `useWorkspaceContext()` directly — there is
 * exactly one copy of the active-workspace state in the app.
 *
 * Each caller owns its own trigger + positioned wrapper (`role="menu"` +
 * Escape handling) and only mounts this component while open, so `query`
 * always starts blank on every open — no manual reset-on-toggle needed.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { WorkspaceDto } from '@next-lane/shared';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';

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

export interface WorkspaceSwitcherMenuContentProps {
  /** Called when the user picks a workspace. */
  onSelect: (ws: WorkspaceDto) => void;
  /** Called when a footer link ("Workspace settings" / "Members") is clicked, so the caller can close its menu. */
  onNavigate?: () => void;
  /** Autofocus the search box on mount. Default true (matches the original chip behavior). */
  autoFocusSearch?: boolean;
}

export function WorkspaceSwitcherMenuContent({
  onSelect,
  onNavigate,
  autoFocusSearch = true,
}: WorkspaceSwitcherMenuContentProps) {
  const { activeWorkspace, workspaces, recentWorkspaces } = useWorkspaceContext();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Autofocus the search box the moment this content mounts — it only ever
  // mounts while the menu is open, so there's no reopen-race to guard against.
  useEffect(() => {
    if (!autoFocusSearch) return;
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [autoFocusSearch]);

  const trimmedQuery = query.trim().toLowerCase();
  const filteredWorkspaces = useMemo(() => {
    if (!trimmedQuery) return workspaces;
    return workspaces.filter((ws) => ws.name.toLowerCase().includes(trimmedQuery));
  }, [workspaces, trimmedQuery]);

  if (!activeWorkspace) return null;

  const showSearch = workspaces.length > SEARCH_THRESHOLD;
  const showRecent = showSearch && !trimmedQuery && recentWorkspaces.length > 0;

  return (
    <>
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
              onSelect={onSelect}
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
              onSelect={onSelect}
            />
          ))
        )}
      </div>

      {/* Footer links */}
      <div className="border-t border-ink-100 pt-1">
        <Link
          to={`/workspaces/${activeWorkspace.id}/settings`}
          role="menuitem"
          onClick={onNavigate}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink-600 transition-colors duration-[120ms] hover:bg-ink-50 hover:text-ink-900 focus-visible:outline-none focus-visible:bg-ink-50"
        >
          Workspace settings
        </Link>
        <Link
          to={`/workspaces/${activeWorkspace.id}/members`}
          role="menuitem"
          onClick={onNavigate}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink-600 transition-colors duration-[120ms] hover:bg-ink-50 hover:text-ink-900 focus-visible:outline-none focus-visible:bg-ink-50"
        >
          Members
        </Link>
      </div>
    </>
  );
}

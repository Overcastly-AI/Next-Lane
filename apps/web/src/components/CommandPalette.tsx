import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SearchIssueDto, SearchProjectDto } from '@next-lane/shared';
import { useSearch } from '@/api/search';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { Spinner } from '@/components/ui/States';
import { cn } from '@/lib/cn';

/**
 * A single selectable row in the palette. `onSelect` runs when the user presses
 * Enter or clicks it. Items are flattened across groups for keyboard navigation
 * but rendered under their group heading.
 */
interface PaletteItem {
  id: string;
  group: string;
  label: ReactNode;
  /** Plain-text label for aria + matching. */
  text: string;
  hint?: string;
  icon: ReactNode;
  onSelect: () => void;
}

/** Extract the current project id from the path, if we're on a project route. */
function useCurrentProjectId(): string | null {
  const { pathname } = useLocation();
  const match = /\/projects\/([^/]+)/.exec(pathname);
  return match ? match[1] : null;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const projectId = useCurrentProjectId();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const debounced = useDebouncedValue(query, 200);
  const searchQuery = useSearch(open ? debounced : '');

  // Reset state whenever the palette opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      // Focus the input on the next frame so the portal is mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Body scroll lock + focus restore while open.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  // Quick actions for the current project (shown always; useful when query is
  // empty, and still reachable while searching).
  const quickActions = useMemo<PaletteItem[]>(() => {
    if (!projectId) return [];
    const proj = projectId;
    return [
      {
        id: 'qa-create',
        group: 'Actions',
        label: 'Create issue',
        text: 'Create issue',
        hint: 'C',
        icon: <GlyphPlus />,
        onSelect: () => go(`/projects/${proj}/board?new=1`),
      },
      {
        id: 'qa-board',
        group: 'Actions',
        label: 'Go to Board',
        text: 'Go to Board',
        icon: <GlyphBoard />,
        onSelect: () => go(`/projects/${proj}/board`),
      },
      {
        id: 'qa-backlog',
        group: 'Actions',
        label: 'Go to Backlog',
        text: 'Go to Backlog',
        icon: <GlyphList />,
        onSelect: () => go(`/projects/${proj}/backlog`),
      },
      {
        id: 'qa-triage',
        group: 'Actions',
        label: 'Triage issues',
        text: 'Triage issues',
        hint: 'T',
        icon: <GlyphTriage />,
        onSelect: () => go(`/projects/${proj}/triage`),
      },
      {
        id: 'qa-reports',
        group: 'Actions',
        label: 'Go to Reports',
        text: 'Go to Reports',
        icon: <GlyphChart />,
        onSelect: () => go(`/projects/${proj}/reports`),
      },
    ];
  }, [projectId]);

  const results = searchQuery.data;
  const hasQuery = debounced.trim().length > 0;

  const issueItems = useMemo<PaletteItem[]>(() => {
    if (!results) return [];
    return results.issues.map((issue: SearchIssueDto) => ({
      id: `issue-${issue.id}`,
      group: 'Issues',
      label: (
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-xs text-ink-400">
            {issue.key}
          </span>
          <span className="truncate">{issue.title}</span>
        </span>
      ),
      text: `${issue.key} ${issue.title}`,
      hint: issue.statusName,
      icon: <TypeDot type={issue.type} />,
      onSelect: () =>
        go(`/projects/${issue.projectId}/board?issue=${issue.id}`),
    }));
  }, [results]);

  const projectItems = useMemo<PaletteItem[]>(() => {
    if (!results) return [];
    return results.projects.map((project: SearchProjectDto) => ({
      id: `project-${project.id}`,
      group: 'Projects',
      label: (
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-xs text-ink-400">
            {project.key}
          </span>
          <span className="truncate">{project.name}</span>
        </span>
      ),
      text: `${project.key} ${project.name}`,
      icon: <GlyphFolder />,
      onSelect: () => go(`/projects/${project.id}/board`),
    }));
  }, [results]);

  // Flattened, ordered item list — Actions first, then search groups.
  const items = useMemo<PaletteItem[]>(
    () => [...quickActions, ...projectItems, ...issueItems],
    [quickActions, projectItems, issueItems],
  );

  // Keep the active index in range as the item list changes.
  useEffect(() => {
    setActiveIndex((i) => (items.length === 0 ? 0 : Math.min(i, items.length - 1)));
  }, [items.length]);

  // Scroll the active option into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) =>
        items.length === 0 ? 0 : (i - 1 + items.length) % items.length,
      );
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      items[activeIndex]?.onSelect();
    }
  };

  // Render the flat list grouped by `group`, preserving the flat index for
  // aria-activedescendant + click handling.
  const groups: { name: string; items: { item: PaletteItem; index: number }[] }[] =
    [];
  items.forEach((item, index) => {
    let g = groups.find((x) => x.name === item.group);
    if (!g) {
      g = { name: item.group, items: [] };
      groups.push(g);
    }
    g.items.push({ item, index });
  });

  const activeId = items[activeIndex]?.id;
  const showEmpty =
    hasQuery && !searchQuery.isFetching && results
      ? issueItems.length === 0 && projectItems.length === 0 && quickActions.length === 0
      : false;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="fixed inset-0 bg-ink-900/35 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-modal ring-1 ring-ink-200/60"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-ink-100 px-4">
          <svg
            className="h-4 w-4 shrink-0 text-ink-400"
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
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search issues and projects…"
            className="w-full bg-transparent py-3.5 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={activeId ? `cp-opt-${activeId}` : undefined}
            aria-label="Search issues and projects"
            autoComplete="off"
            spellCheck={false}
          />
          {searchQuery.isFetching && <Spinner className="h-4 w-4" />}
        </div>

        <ul
          ref={listRef}
          id="command-palette-list"
          role="listbox"
          aria-label="Results"
          className="max-h-[min(60vh,24rem)] overflow-y-auto py-2"
        >
          {groups.map((group) => (
            <li key={group.name} role="presentation">
              <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-400">
                {group.name}
              </div>
              <ul role="presentation">
                {group.items.map(({ item, index }) => (
                  <li
                    key={item.id}
                    id={`cp-opt-${item.id}`}
                    data-index={index}
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => item.onSelect()}
                    className={cn(
                      'mx-2 flex cursor-pointer items-center gap-3 rounded px-2 py-2 text-sm text-ink-700',
                      index === activeIndex && 'bg-signal-50 text-signal-700',
                    )}
                  >
                    <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center', index === activeIndex ? 'text-signal-500' : 'text-ink-400')}>
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint && (
                      <span className="shrink-0 text-xs text-ink-400">
                        {item.hint}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}

          {!hasQuery && quickActions.length === 0 && (
            <li
              role="presentation"
              className="px-4 py-10 text-center text-sm text-ink-400"
            >
              Type to search issues and projects across your workspaces.
            </li>
          )}

          {hasQuery && searchQuery.isFetching && items.length === 0 && (
            <li
              role="presentation"
              className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-ink-400"
            >
              <Spinner className="h-4 w-4" /> Searching…
            </li>
          )}

          {showEmpty && (
            <li
              role="presentation"
              className="px-4 py-10 text-center text-sm text-ink-400"
            >
              No results for "{debounced.trim()}".
            </li>
          )}
        </ul>

        <div className="flex items-center gap-3 border-t border-ink-100 px-4 py-2 text-[11px] text-ink-400">
          <KbdHint keys="↑↓" label="Navigate" />
          <KbdHint keys="↵" label="Open" />
          <KbdHint keys="Esc" label="Close" />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function KbdHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="rounded border border-ink-200 bg-ink-50 px-1.5 py-0.5 font-mono text-[10px] text-ink-500">
        {keys}
      </kbd>
      {label}
    </span>
  );
}

function TypeDot({ type }: { type: string }) {
  const colors: Record<string, string> = {
    STORY: '#22c55e',
    TASK: '#3b82f6',
    BUG: '#ef4444',
    EPIC: '#a855f7',
    SUBTASK: '#6b7280',
  };
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-sm"
      style={{ backgroundColor: colors[type] ?? '#9ca3af' }}
      aria-hidden="true"
    />
  );
}

function GlyphPlus() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}
function GlyphBoard() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M15 4v16" />
    </svg>
  );
}
function GlyphList() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}
function GlyphChart() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}
function GlyphFolder() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}
function GlyphTriage() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h10M4 18h6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 15l2 2 4-4" />
    </svg>
  );
}

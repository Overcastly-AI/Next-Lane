/**
 * PageTree — collapsible, keyboard-navigable sidebar nav for a project's
 * page hierarchy (Confluence-style tree).
 *
 * ARIA: standard WAI-ARIA "tree view" pattern — `role="tree"` container,
 * `role="treeitem"` rows (aria-expanded / aria-level / aria-selected),
 * `role="group"` for a row's children. Roving tabindex: exactly one row is
 * tab-stoppable at a time (the "active" row); Arrow keys move it.
 *   - ArrowDown / ArrowUp   — next / previous VISIBLE row
 *   - ArrowRight            — expand a collapsed row, else move into its first child
 *   - ArrowLeft             — collapse an expanded row, else move to its parent
 *   - Home / End            — first / last visible row
 *   - Enter / Space         — open the row's page
 *
 * Reordering uses the up/down-move affordance (calling `POST /pages/:id/move`
 * via the caller-supplied `onMoveUp`/`onMoveDown`) rather than drag-and-drop —
 * fully keyboard- and screen-reader-operable, no pointer required.
 */
import { useEffect, useRef, useState } from 'react';
import type { PageTreeNode } from '@next-lane/shared';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cn } from '@/lib/cn';

export interface PageTreeProps {
  tree: PageTreeNode[];
  activePageId?: string;
  editable: boolean;
  onOpen: (pageId: string) => void;
  onCreateRoot: () => void;
  onCreateChild: (parentId: string) => void;
  onMoveUp: (nodeId: string) => void;
  onMoveDown: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
}

interface FlatRow {
  node: PageTreeNode;
  depth: number;
  parentId: string | null;
  index: number;
  siblingCount: number;
}

function flattenVisible(
  nodes: PageTreeNode[],
  expanded: Set<string>,
  depth = 0,
  parentId: string | null = null,
): FlatRow[] {
  const out: FlatRow[] = [];
  nodes.forEach((node, index) => {
    out.push({ node, depth, parentId, index, siblingCount: nodes.length });
    if (node.children.length > 0 && expanded.has(node.id)) {
      out.push(...flattenVisible(node.children, expanded, depth + 1, node.id));
    }
  });
  return out;
}

function findAncestorIds(nodes: PageTreeNode[], targetId: string, trail: string[] = []): string[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return trail;
    const found = findAncestorIds(node.children, targetId, [...trail, node.id]);
    if (found) return found;
  }
  return null;
}

export function PageTree({
  tree,
  activePageId,
  editable,
  onOpen,
  onCreateRoot,
  onCreateChild,
  onMoveUp,
  onMoveDown,
  onDelete,
}: PageTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PageTreeNode | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const focusPending = useRef(false);

  // Auto-expand the path down to the currently-open page so it's always
  // visible in the tree without the user having to manually drill down.
  useEffect(() => {
    if (!activePageId) return;
    const ancestors = findAncestorIds(tree, activePageId);
    if (!ancestors || ancestors.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of ancestors) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activePageId, tree]);

  const visible = flattenVisible(tree, expanded);

  // Keep the roving-tabindex target valid as the tree changes; default it to
  // the active page (or the first row).
  useEffect(() => {
    if (activeId && visible.some((r) => r.node.id === activeId)) return;
    setActiveId(activePageId ?? visible[0]?.node.id ?? null);
  }, [visible, activeId, activePageId]);

  useEffect(() => {
    if (!focusPending.current || !activeId) return;
    focusPending.current = false;
    rowRefs.current.get(activeId)?.focus();
  }, [activeId]);

  function moveActiveTo(id: string | undefined) {
    if (!id) return;
    focusPending.current = true;
    setActiveId(id);
  }

  function toggleExpand(id: string, force?: boolean) {
    setExpanded((prev) => {
      const next = new Set(prev);
      const shouldExpand = force ?? !next.has(id);
      if (shouldExpand) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleKeyDown(e: React.KeyboardEvent, row: FlatRow) {
    const idx = visible.findIndex((r) => r.node.id === row.node.id);
    const hasChildren = row.node.children.length > 0;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveActiveTo(visible[idx + 1]?.node.id);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveActiveTo(visible[idx - 1]?.node.id);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (hasChildren && !expanded.has(row.node.id)) {
          toggleExpand(row.node.id, true);
        } else if (hasChildren) {
          moveActiveTo(row.node.children[0]?.id);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (hasChildren && expanded.has(row.node.id)) {
          toggleExpand(row.node.id, false);
        } else if (row.parentId) {
          moveActiveTo(row.parentId);
        }
        break;
      case 'Home':
        e.preventDefault();
        moveActiveTo(visible[0]?.node.id);
        break;
      case 'End':
        e.preventDefault();
        moveActiveTo(visible[visible.length - 1]?.node.id);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onOpen(row.node.id);
        break;
      default:
        break;
    }
  }

  return (
    <nav aria-label="Pages" className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-3 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">Pages</h2>
        {editable && (
          <button
            type="button"
            onClick={onCreateRoot}
            data-testid="page-tree-new-root"
            aria-label="New page"
            title="New page"
            className="flex h-6 w-6 items-center justify-center rounded text-ink-500 transition-colors duration-[120ms] hover:bg-ink-100 hover:text-signal-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>

      <div role="tree" aria-label="Page tree" className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {visible.length === 0 && (
          <p className="px-2 py-4 text-xs text-ink-400" data-testid="page-tree-empty">
            No pages yet.
          </p>
        )}
        {visible.map((row) => (
          <TreeRow
            key={row.node.id}
            row={row}
            rowRef={(el) => {
              if (el) rowRefs.current.set(row.node.id, el);
              else rowRefs.current.delete(row.node.id);
            }}
            isActive={row.node.id === activeId}
            isSelected={row.node.id === activePageId}
            isExpanded={expanded.has(row.node.id)}
            editable={editable}
            onToggle={() => toggleExpand(row.node.id)}
            onOpen={() => {
              moveActiveTo(row.node.id);
              onOpen(row.node.id);
            }}
            onKeyDown={(e) => handleKeyDown(e, row)}
            onCreateChild={() => onCreateChild(row.node.id)}
            onMoveUp={row.index > 0 ? () => onMoveUp(row.node.id) : undefined}
            onMoveDown={row.index < row.siblingCount - 1 ? () => onMoveDown(row.node.id) : undefined}
            onDelete={() => setDeleteTarget(row.node)}
          />
        ))}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete page"
        message={
          deleteTarget && deleteTarget.children.length > 0 ? (
            <>
              Delete <strong>{deleteTarget.title}</strong>? It has {deleteTarget.children.length}{' '}
              child page{deleteTarget.children.length === 1 ? '' : 's'} — move or delete those first.
            </>
          ) : (
            <>
              Delete <strong>{deleteTarget?.title}</strong>? This can’t be undone.
            </>
          )
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </nav>
  );
}

// ---------------------------------------------------------------------------
// One tree row
// ---------------------------------------------------------------------------

function TreeRow({
  row,
  rowRef,
  isActive,
  isSelected,
  isExpanded,
  editable,
  onToggle,
  onOpen,
  onKeyDown,
  onCreateChild,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  row: FlatRow;
  rowRef: (el: HTMLDivElement | null) => void;
  isActive: boolean;
  isSelected: boolean;
  isExpanded: boolean;
  editable: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onCreateChild: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDelete: () => void;
}) {
  const hasChildren = row.node.children.length > 0;

  return (
    <div
      ref={rowRef}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-setsize={row.siblingCount}
      aria-posinset={row.index + 1}
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-selected={isSelected}
      tabIndex={isActive ? 0 : -1}
      data-testid={`page-tree-item-${row.node.id}`}
      onKeyDown={onKeyDown}
      onClick={onOpen}
      style={{ paddingLeft: `${row.depth * 14}px` }}
      className={cn(
        'group flex cursor-pointer items-center gap-0.5 rounded-md py-1 pr-1 text-sm outline-none',
        'focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-inset',
        isSelected ? 'bg-signal-50 text-signal-800 font-medium' : 'text-ink-700 hover:bg-ink-50',
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden={!hasChildren}
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) onToggle();
        }}
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-400',
          hasChildren ? 'hover:bg-ink-100 hover:text-ink-600' : 'invisible',
        )}
      >
        {hasChildren && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            aria-hidden="true"
            className={cn('transition-transform duration-[120ms] motion-reduce:transition-none', isExpanded && 'rotate-90')}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
          </svg>
        )}
      </button>

      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-ink-400" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v4a1 1 0 0 0 1 1h4M6 3h6l6 6v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      </svg>

      <span className="min-w-0 flex-1 truncate px-1.5" title={row.node.title}>
        {row.node.title}
        {row.node.archived && <span className="ml-1.5 text-xs font-normal text-ink-400">(archived)</span>}
      </span>

      {editable && (
        <span className="flex shrink-0 items-center opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-within:opacity-100">
          <RowIconButton label="New child page" onClick={onCreateChild} testId={`page-tree-add-child-${row.node.id}`}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
          </RowIconButton>
          <RowIconButton label="Move up" onClick={onMoveUp} testId={`page-tree-move-up-${row.node.id}`}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M5 12l7-7 7 7" />
          </RowIconButton>
          <RowIconButton label="Move down" onClick={onMoveDown} testId={`page-tree-move-down-${row.node.id}`}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12l7 7 7-7" />
          </RowIconButton>
          <RowIconButton label="Delete page" onClick={onDelete} testId={`page-tree-delete-${row.node.id}`} danger>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13" />
          </RowIconButton>
        </span>
      )}
    </div>
  );
}

function RowIconButton({
  label,
  onClick,
  testId,
  danger,
  children,
}: {
  label: string;
  onClick?: () => void;
  testId: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      disabled={!onClick}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-400 transition-colors duration-[120ms]',
        'hover:bg-ink-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400',
        'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent',
        danger && 'hover:bg-red-50 hover:text-red-600',
      )}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

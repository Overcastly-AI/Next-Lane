import { useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { IssueDto, StatusDto } from '@next-lane/shared';
import { SortableIssueCard } from './SortableIssueCard';
import { cn } from '@/lib/cn';

const CATEGORY_DOT: Record<string, string> = {
  TODO: 'bg-gray-400',
  IN_PROGRESS: 'bg-blue-500',
  DONE: 'bg-green-500',
};

export function BoardColumn({
  status,
  issues,
  onAdd,
  onOpenIssue,
  onEdit,
  onDelete,
  onMove,
  canMoveLeft,
  canMoveRight,
}: {
  status: StatusDto;
  issues: IssueDto[];
  onAdd: (statusId: string) => void;
  onOpenIssue: (id: string) => void;
  /** Open the rename/category editor for this column. */
  onEdit: (status: StatusDto) => void;
  /** Request deletion of this column (parent confirms). */
  onDelete: (status: StatusDto) => void;
  /** Reorder this column one slot left or right (swaps `order` with a neighbor). */
  onMove: (status: StatusDto, direction: 'left' | 'right') => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: status.id,
    data: { type: 'column', statusId: status.id },
  });

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl bg-gray-100/70">
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              CATEGORY_DOT[status.category] ?? 'bg-gray-400',
            )}
          />
          <span className="truncate text-xs font-semibold uppercase tracking-wide text-gray-600">
            {status.name}
          </span>
          <span className="rounded-full bg-gray-200 px-1.5 text-xs font-medium text-gray-500">
            {issues.length}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => onAdd(status.id)}
            aria-label={`Add issue to ${status.name}`}
            className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <ColumnMenu
            status={status}
            onEdit={onEdit}
            onDelete={onDelete}
            onMove={onMove}
            canMoveLeft={canMoveLeft}
            canMoveRight={canMoveRight}
          />
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          'nl-scroll flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2',
          isOver && 'rounded-lg bg-brand-50/60 ring-1 ring-inset ring-brand-200',
        )}
      >
        <SortableContext
          items={issues.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {issues.map((issue) => (
            <SortableIssueCard
              key={issue.id}
              issue={issue}
              onOpen={onOpenIssue}
            />
          ))}
        </SortableContext>

        {issues.length === 0 && (
          <button
            onClick={() => onAdd(status.id)}
            className="rounded-lg border border-dashed border-gray-300 py-6 text-xs text-gray-400 transition-colors hover:border-brand-300 hover:text-brand-600"
          >
            + Add issue
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Overflow menu in the column header: rename/edit the column, reorder it left or
 * right, or delete it. Closes on outside click or Escape.
 */
function ColumnMenu({
  status,
  onEdit,
  onDelete,
  onMove,
  canMoveLeft,
  canMoveRight,
}: {
  status: StatusDto;
  onEdit: (status: StatusDto) => void;
  onDelete: (status: StatusDto) => void;
  onMove: (status: StatusDto, direction: 'left' | 'right') => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function run(fn: () => void) {
    setOpen(false);
    fn();
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Column actions for ${status.name}`}
        className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={`Column actions for ${status.name}`}
          className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-gray-200 bg-white p-1 shadow-cardHover"
        >
          <MenuItem onClick={() => run(() => onEdit(status))}>
            Rename / edit
          </MenuItem>
          <MenuItem
            disabled={!canMoveLeft}
            onClick={() => run(() => onMove(status, 'left'))}
          >
            Move left
          </MenuItem>
          <MenuItem
            disabled={!canMoveRight}
            onClick={() => run(() => onMove(status, 'right'))}
          >
            Move right
          </MenuItem>
          <div className="my-1 border-t border-gray-100" />
          <MenuItem danger onClick={() => run(() => onDelete(status))}>
            Delete column
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'block w-full rounded px-2 py-1.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
        disabled
          ? 'cursor-not-allowed text-gray-300'
          : danger
            ? 'text-red-600 hover:bg-red-50'
            : 'text-gray-700 hover:bg-gray-50',
      )}
    >
      {children}
    </button>
  );
}

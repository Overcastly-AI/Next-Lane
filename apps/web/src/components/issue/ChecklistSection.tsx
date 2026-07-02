/**
 * ChecklistSection
 *
 * Rendered in the IssueDetailDrawer main column. Shows a list of checklist
 * items with progress indicator, toggle, delete, and an "add item" input.
 * MEMBER+ required to add/toggle/delete; VIEWER sees items + progress read-only.
 */
import { useRef, useState, useId } from 'react';
import type { ChecklistItemDto } from '@next-lane/shared';
import {
  useAddChecklistItem,
  useUpdateChecklistItem,
  useDeleteChecklistItem,
} from '@/api/checklist';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

interface Props {
  issueId: string;
  items: ChecklistItemDto[];
  progress: { done: number; total: number };
  /** When false (VIEWER), add / toggle / delete controls are hidden. */
  editable: boolean;
}

export function ChecklistSection({
  issueId,
  items,
  progress,
  editable,
}: Props) {
  const progressBarId = useId();

  return (
    <section data-testid="checklist-section" aria-label="Checklist">
      {/* Section header */}
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-500">
          Checklist
        </p>
        {progress.total > 0 && (
          <span
            data-testid="checklist-progress"
            className="text-xs font-semibold tabular-nums text-ink-500"
            aria-label={`${progress.done} of ${progress.total} done`}
          >
            {progress.done}/{progress.total}
          </span>
        )}
      </div>

      {/* Progress bar — hidden when total is 0 */}
      {progress.total > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <div
            id={progressBarId}
            role="progressbar"
            aria-valuenow={progress.done}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-label={`Checklist progress: ${progress.done} of ${progress.total} items done`}
            className="flex-1 h-1.5 overflow-hidden rounded-full bg-ink-100"
          >
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300 motion-reduce:transition-none',
                progress.done === progress.total ? 'bg-emerald-500' : 'bg-signal-500',
              )}
              style={{
                width:
                  progress.total === 0
                    ? '0%'
                    : `${Math.round((progress.done / progress.total) * 100)}%`,
              }}
            />
          </div>
          <span className="font-mono text-[9px] text-ink-400 tabular-nums">
            {Math.round((progress.done / progress.total) * 100)}%
          </span>
        </div>
      )}

      {/* Item list */}
      {items.length === 0 ? (
        <p className="mb-3 text-xs text-ink-400">No checklist items yet.</p>
      ) : (
        <ul className="mb-3 space-y-1">
          {items.map((item) => (
            <ChecklistItem
              key={item.id}
              item={item}
              issueId={issueId}
              editable={editable}
            />
          ))}
        </ul>
      )}

      {/* Add item input — member+ only */}
      {editable && <AddItemInput issueId={issueId} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Individual checklist item row
// ---------------------------------------------------------------------------

function ChecklistItem({
  item,
  issueId,
  editable,
}: {
  item: ChecklistItemDto;
  issueId: string;
  editable: boolean;
}) {
  const update = useUpdateChecklistItem(issueId);
  const remove = useDeleteChecklistItem(issueId);
  const toast = useToast();
  // Optimistic local state while the server call is in-flight.
  const [optimisticDone, setOptimisticDone] = useState<boolean | null>(null);
  const isDone = optimisticDone !== null ? optimisticDone : item.done;

  function handleToggle() {
    if (!editable) return;
    const nextDone = !isDone;
    setOptimisticDone(nextDone);
    update.mutate(
      { id: item.id, done: nextDone },
      {
        onError: (err) => {
          setOptimisticDone(null);
          toast.error(errorMessage(err, 'Could not update item.'));
        },
        onSuccess: () => {
          setOptimisticDone(null);
        },
      },
    );
  }

  function handleDelete() {
    remove.mutate(item.id, {
      onError: (err) =>
        toast.error(errorMessage(err, 'Could not delete item.')),
    });
  }

  const checkboxId = `checklist-item-cb-${item.id}`;

  return (
    <li
      data-testid="checklist-item"
      className="group flex items-center gap-2 rounded-md px-1 py-1 transition-colors duration-[120ms] hover:bg-ink-50"
    >
      {/* Checkbox */}
      <input
        id={checkboxId}
        type="checkbox"
        data-testid="checklist-item-checkbox"
        checked={isDone}
        disabled={!editable || update.isPending}
        onChange={handleToggle}
        aria-label={item.text}
        className={[
          'h-4 w-4 shrink-0 cursor-pointer rounded border-ink-300',
          'accent-emerald-600',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1',
          !editable ? 'cursor-default opacity-60' : '',
        ].join(' ')}
      />

      {/* Text */}
      <label
        htmlFor={checkboxId}
        className={[
          'flex-1 cursor-pointer select-none text-sm leading-snug transition-colors duration-[120ms]',
          isDone
            ? 'text-ink-400 line-through decoration-ink-300'
            : 'text-ink-800',
          !editable ? 'cursor-default' : '',
        ].join(' ')}
      >
        {item.text}
      </label>

      {/* Delete button — MEMBER+, visible on hover/focus */}
      {editable && (
        <button
          type="button"
          data-testid="checklist-item-delete"
          aria-label={`Delete checklist item: ${item.text}`}
          onClick={handleDelete}
          disabled={remove.isPending}
          className={[
            'shrink-0 rounded p-0.5 text-ink-300 transition-colors duration-[120ms]',
            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            'hover:bg-red-50 hover:text-red-500',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400',
            'disabled:opacity-30',
          ].join(' ')}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
          >
            <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
          </svg>
        </button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Add item form
// ---------------------------------------------------------------------------

function AddItemInput({ issueId }: { issueId: string }) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const add = useAddChecklistItem(issueId);
  const toast = useToast();

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    add.mutate(trimmed, {
      onSuccess: () => {
        setText('');
        // Keep focus in the input for rapid consecutive adds.
        inputRef.current?.focus();
      },
      onError: (err) => {
        toast.error(errorMessage(err, 'Could not add item.'));
      },
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        data-testid="checklist-add-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a checklist item…"
        autoComplete="off"
        disabled={add.isPending}
        aria-label="New checklist item text"
        className={[
          'flex-1 rounded border border-dashed border-ink-200 bg-transparent px-2 py-1.5 text-sm text-ink-800 placeholder:text-ink-400',
          'transition-colors duration-[120ms]',
          'hover:border-signal-300 hover:bg-signal-50/30',
          'focus:border-signal-400 focus:bg-surface focus:outline-none focus:ring-0',
          'disabled:cursor-not-allowed disabled:opacity-60',
        ].join(' ')}
      />
      <button
        type="submit"
        disabled={!text.trim() || add.isPending}
        aria-label="Add checklist item"
        className={[
          'shrink-0 rounded border border-ink-200 bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-600',
          'transition-colors duration-[120ms]',
          'hover:border-signal-400 hover:bg-signal-50 hover:text-signal-700',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400',
          'disabled:cursor-not-allowed disabled:opacity-40',
        ].join(' ')}
      >
        Add
      </button>
    </form>
  );
}

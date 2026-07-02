/**
 * CardStatusPicker — a compact status-transition popover rendered on board cards.
 *
 * Behaviour:
 * - Renders as a small coloured dot / pill that shows the current status category.
 * - On click (or Enter/Space), opens a tiny listbox of the project's statuses.
 * - Selecting a status calls `onSelect(statusId)` and closes the menu.
 * - Pressing Escape closes the menu.
 * - `stopPropagation` on the trigger prevents the card-body click (drawer open)
 *   and dnd-kit pointer events from firing.
 * - Hidden entirely when `editable` is false (VIEWER).
 */

import { useEffect, useRef, useState } from 'react';
import { StatusCategory, type StatusDto } from '@next-lane/shared';
import { cn } from '@/lib/cn';

/*
 * DISPATCH status signal dots — matches the column header signal progression:
 * graphite (queued) → cobalt (in motion) → eucalyptus (arrived)
 */
const CATEGORY_DOT: Record<string, string> = {
  TODO:        'bg-ink-400',
  IN_PROGRESS: 'bg-signal-600',
  DONE:        'bg-emerald-500',
};

const CATEGORY_RING: Record<string, string> = {
  TODO:        'hover:ring-ink-300',
  IN_PROGRESS: 'hover:ring-signal-300',
  DONE:        'hover:ring-emerald-300',
};

// Human-readable label for each category used in aria-labels.
const CATEGORY_LABEL: Record<string, string> = {
  [StatusCategory.TODO]: 'To do',
  [StatusCategory.IN_PROGRESS]: 'In progress',
  [StatusCategory.DONE]: 'Done',
};

interface CardStatusPickerProps {
  currentStatus: StatusDto | undefined;
  statuses: StatusDto[];
  /** Called with the newly selected status id. */
  onSelect: (statusId: string) => void;
  /** When false the control is not rendered (VIEWER). */
  editable: boolean;
}

export function CardStatusPicker({
  currentStatus,
  statuses,
  onSelect,
  editable,
}: CardStatusPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;

    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true /* capture so we fire first */);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Move focus into the listbox when it opens.
  useEffect(() => {
    if (!open) return;
    const selected = menuRef.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    const first = menuRef.current?.querySelector<HTMLElement>('[role="option"]');
    (selected ?? first)?.focus();
  }, [open]);

  if (!editable) return null;

  const dotClass  = CATEGORY_DOT[currentStatus?.category ?? '']  ?? 'bg-ink-400';
  const ringClass = CATEGORY_RING[currentStatus?.category ?? ''] ?? 'hover:ring-ink-300';

  function handleTriggerClick(e: React.MouseEvent) {
    e.stopPropagation();
    setOpen((v) => !v);
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      setOpen((v) => !v);
    }
  }

  function handleOptionClick(e: React.MouseEvent, statusId: string) {
    e.stopPropagation();
    onSelect(statusId);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleOptionKeyDown(e: React.KeyboardEvent, statusId: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      onSelect(statusId);
      setOpen(false);
      triggerRef.current?.focus();
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      (e.currentTarget as HTMLElement)
        .nextElementSibling
        ?.querySelector<HTMLElement>('[role="option"]')
        ?.focus() ??
        (menuRef.current?.querySelector<HTMLElement>('[role="option"]'))?.focus();
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      (e.currentTarget as HTMLElement)
        .previousElementSibling
        ?.querySelector<HTMLElement>('[role="option"]')
        ?.focus() ??
        (menuRef.current?.querySelectorAll<HTMLElement>('[role="option"]'))
          ?.[
            (menuRef.current?.querySelectorAll<HTMLElement>('[role="option"]')
              .length ?? 1) - 1
          ]
          ?.focus();
    }
  }

  const currentLabel = currentStatus
    ? currentStatus.name
    : 'Set status';
  const categoryLabel = currentStatus
    ? (CATEGORY_LABEL[currentStatus.category] ?? currentStatus.category)
    : '';

  return (
    <div
      ref={containerRef}
      className="relative"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Trigger — status signal dot */}
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Status: ${currentLabel}${categoryLabel ? ` (${categoryLabel})` : ''}. Click to change.`}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="card-status-trigger"
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ring-transparent transition-all duration-[120ms]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-offset-1',
          ringClass,
        )}
      >
        <span
          className={cn('h-2.5 w-2.5 rounded-full', dotClass)}
          aria-hidden="true"
        />
      </button>

      {/* Listbox */}
      {open && (
        <ul
          ref={menuRef}
          role="listbox"
          aria-label="Change status"
          data-testid="card-status-menu"
          className={cn(
            'absolute left-0 top-6 z-50 min-w-[10rem] rounded-lg border border-ink-200',
            'bg-surface py-1 shadow-dropdown',
          )}
        >
          {statuses.map((s) => {
            const isCurrent = s.id === currentStatus?.id;
            return (
              <li key={s.id}>
                <div
                  role="option"
                  aria-selected={isCurrent}
                  tabIndex={0}
                  data-testid={`card-status-option-${s.id}`}
                  onClick={(e) => handleOptionClick(e, s.id)}
                  onKeyDown={(e) => handleOptionKeyDown(e, s.id)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm',
                    'focus:outline-none focus-visible:bg-ink-50',
                    isCurrent
                      ? 'bg-ink-50 font-semibold text-ink-900'
                      : 'text-ink-700 hover:bg-ink-50',
                  )}
                >
                  <span
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      CATEGORY_DOT[s.category] ?? 'bg-ink-400',
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{s.name}</span>
                  {isCurrent && (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      aria-hidden="true"
                      className="ml-auto shrink-0 text-signal-600"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

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

// Colour mapping for category dots — matches the column header dots in BoardColumn.
const CATEGORY_DOT: Record<string, string> = {
  TODO: 'bg-gray-400',
  IN_PROGRESS: 'bg-blue-500',
  DONE: 'bg-green-500',
};

const CATEGORY_RING: Record<string, string> = {
  TODO: 'hover:ring-gray-300',
  IN_PROGRESS: 'hover:ring-blue-300',
  DONE: 'hover:ring-green-300',
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
    // Focus the currently-selected item (or the first item).
    const selected = menuRef.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    const first = menuRef.current?.querySelector<HTMLElement>('[role="option"]');
    (selected ?? first)?.focus();
  }, [open]);

  if (!editable) return null;

  const dotClass = CATEGORY_DOT[currentStatus?.category ?? ''] ?? 'bg-gray-400';
  const ringClass =
    CATEGORY_RING[currentStatus?.category ?? ''] ?? 'hover:ring-gray-300';

  function handleTriggerClick(e: React.MouseEvent) {
    // Prevent the card-body click handler from opening the drawer.
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
      // Prevent pointer events bubbling up to dnd-kit.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Trigger — a coloured dot that acts as a button */}
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
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ring-transparent transition-all',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-1',
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
            'absolute left-0 top-6 z-50 min-w-[10rem] rounded-lg border border-gray-200',
            'bg-white py-1 shadow-cardHover',
            // On mobile the menu can clip if the card is near the right edge;
            // use `right-0` instead via a sm breakpoint would help but the
            // popover is narrow enough (160px) that left-anchor is fine.
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
                    'focus:outline-none focus-visible:bg-gray-50',
                    isCurrent
                      ? 'bg-gray-50 font-medium text-gray-900'
                      : 'text-gray-700 hover:bg-gray-50',
                  )}
                >
                  <span
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      CATEGORY_DOT[s.category] ?? 'bg-gray-400',
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
                      className="ml-auto shrink-0 text-brand-600"
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

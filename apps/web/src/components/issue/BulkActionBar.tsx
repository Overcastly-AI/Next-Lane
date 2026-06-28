/**
 * BulkActionBar — sticky bottom action bar that appears when one or more issue
 * rows are selected. Renders inside a portal so it floats above all page
 * content regardless of scroll position.
 *
 * Design: Dispatch tokens (ink/signal). The bar uses the same ink-800 surface
 * that the AppHeader uses so the "selected" state reads as a dispatch command
 * strip — intentional, authoritative, not a generic modal.
 *
 * Mobile: At ≤639 px the controls collapse into a compact two-row layout
 * (selects stack, buttons stay inline). No horizontal overflow at 390 px.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  PRIORITIES,
  Priority,
  type BulkIssueChangesDto,
  type LabelDto,
  type SprintDto,
  type StatusDto,
  type UserDto,
} from '@next-lane/shared';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { titleCase } from '@/components/issue/issueMeta';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BulkActionBarProps {
  /** Number of currently selected issues. */
  selectedCount: number;
  /** Available statuses for the project. */
  statuses: StatusDto[];
  /** Workspace members (incl. unassigned option rendered by the bar). */
  users: UserDto[];
  /** Available project labels. */
  labels: LabelDto[];
  /** Planning sprints (PLANNED + ACTIVE) — pass empty array to hide sprint control. */
  sprints: SprintDto[];
  /** Whether the sprint control should be shown at all (BacklogPage: yes, TriagePage: no). */
  showSprint?: boolean;
  /** Whether a mutation is in progress. */
  isPending?: boolean;
  /** Called with the diff object (only touched fields). */
  onApply: (changes: BulkIssueChangesDto) => void;
  /** Called when the user wants to deselect everything. */
  onClear: () => void;
}

// Internal sentinel for "user has not touched this control yet"
const UNSET = '__unset__' as const;
const UNASSIGNED = '__unassigned__' as const;
const NO_SPRINT = '__no_sprint__' as const;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BulkActionBar({
  selectedCount,
  statuses,
  users,
  labels,
  sprints,
  showSprint = false,
  isPending = false,
  onApply,
  onClear,
}: BulkActionBarProps) {
  // Each control starts UNSET so we only send the user's explicit choices.
  const [statusId, setStatusId] = useState<string | typeof UNSET>(UNSET);
  const [assigneeId, setAssigneeId] = useState<
    string | typeof UNSET | typeof UNASSIGNED
  >(UNSET);
  const [priority, setPriority] = useState<Priority | typeof UNSET>(UNSET);
  const [sprintId, setSprintId] = useState<
    string | typeof UNSET | typeof NO_SPRINT
  >(UNSET);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const labelPickerRef = useRef<HTMLDivElement>(null);

  // Reset all controls when selection is cleared externally
  useEffect(() => {
    if (selectedCount === 0) resetControls();
  }, [selectedCount]);

  // Close label picker on outside click
  useEffect(() => {
    if (!labelPickerOpen) return;
    function handleDown(e: MouseEvent) {
      if (!labelPickerRef.current?.contains(e.target as Node)) {
        setLabelPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleDown);
    return () => document.removeEventListener('mousedown', handleDown);
  }, [labelPickerOpen]);

  function resetControls() {
    setStatusId(UNSET);
    setAssigneeId(UNSET);
    setPriority(UNSET);
    setSprintId(UNSET);
    setLabelIds([]);
    setLabelPickerOpen(false);
  }

  const hasAnyChange =
    statusId !== UNSET ||
    assigneeId !== UNSET ||
    priority !== UNSET ||
    sprintId !== UNSET ||
    labelIds.length > 0;

  function buildChanges(): BulkIssueChangesDto {
    const changes: BulkIssueChangesDto = {};
    if (statusId !== UNSET) changes.statusId = statusId;
    if (assigneeId !== UNSET) {
      changes.assigneeId = assigneeId === UNASSIGNED ? null : assigneeId;
    }
    if (priority !== UNSET) changes.priority = priority;
    if (sprintId !== UNSET) {
      changes.sprintId = sprintId === NO_SPRINT ? null : sprintId;
    }
    if (labelIds.length > 0) changes.addLabelIds = labelIds;
    return changes;
  }

  function handleApply() {
    if (!hasAnyChange || isPending) return;
    onApply(buildChanges());
  }

  function handleClear() {
    resetControls();
    onClear();
  }

  if (selectedCount === 0) return null;

  const bar = (
    <div
      role="region"
      aria-label="Bulk actions"
      data-testid="bulk-action-bar"
      className={cn(
        'fixed inset-x-0 bottom-0 z-50',
        'border-t border-ink-700/60',
        'bg-ink-900 text-white',
        'shadow-[0_-4px_24px_-4px_rgb(17_24_39/0.45)]',
        'animate-nl-fade-in',
      )}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        {/* Selection count badge */}
        <span className="shrink-0 text-sm font-semibold text-white">
          <span
            className="mr-1.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-signal-600 px-1.5 text-xs font-bold"
            aria-live="polite"
            aria-atomic="true"
          >
            {selectedCount}
          </span>
          {selectedCount === 1 ? 'issue' : 'issues'} selected
        </span>

        {/* Divider — desktop only */}
        <span className="hidden h-5 w-px shrink-0 bg-ink-700 sm:block" aria-hidden="true" />

        {/* Controls row — wraps on mobile */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status */}
          <BarSelect
            id="bulk-status"
            label="Set status"
            value={statusId}
            onChange={(v) => setStatusId(v)}
          >
            <option value={UNSET} disabled>
              Status…
            </option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </BarSelect>

          {/* Assignee */}
          <BarSelect
            id="bulk-assignee"
            label="Set assignee"
            value={assigneeId}
            onChange={(v) => setAssigneeId(v)}
          >
            <option value={UNSET} disabled>
              Assignee…
            </option>
            <option value={UNASSIGNED}>Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </BarSelect>

          {/* Priority */}
          <BarSelect
            id="bulk-priority"
            label="Set priority"
            value={priority}
            onChange={(v) => setPriority(v as Priority | typeof UNSET)}
          >
            <option value={UNSET} disabled>
              Priority…
            </option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {titleCase(p)}
              </option>
            ))}
          </BarSelect>

          {/* Sprint — only on BacklogPage */}
          {showSprint && (
            <BarSelect
              id="bulk-sprint"
              label="Set sprint"
              value={sprintId}
              onChange={(v) => setSprintId(v)}
            >
              <option value={UNSET} disabled>
                Sprint…
              </option>
              <option value={NO_SPRINT}>Backlog (no sprint)</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </BarSelect>
          )}

          {/* Label picker */}
          <div ref={labelPickerRef} className="relative">
            <button
              type="button"
              aria-label="Add labels"
              aria-haspopup="dialog"
              aria-expanded={labelPickerOpen}
              onClick={() => setLabelPickerOpen((v) => !v)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded border px-2.5 text-xs font-medium transition-all duration-[120ms]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-offset-1 focus-visible:ring-offset-ink-900',
                labelIds.length > 0
                  ? 'border-signal-500 bg-signal-900/60 text-signal-200'
                  : 'border-ink-600 bg-ink-800 text-ink-300 hover:border-ink-500 hover:text-white',
              )}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7 7h.01M3 7l9-4 9 4v13a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
                />
              </svg>
              Labels
              {labelIds.length > 0 && (
                <span className="rounded-full bg-signal-600 px-1 py-0.5 text-[10px] font-bold leading-none text-white">
                  {labelIds.length}
                </span>
              )}
            </button>

            {labelPickerOpen && labels.length > 0 && (
              <div
                role="dialog"
                aria-label="Pick labels to add"
                className="absolute bottom-full left-0 z-50 mb-2 min-w-[160px] rounded-lg border border-ink-700 bg-ink-800 p-1 shadow-dropdown"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setLabelPickerOpen(false);
                }}
              >
                <p className="mb-1 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                  Add labels
                </p>
                {labels.map((label) => {
                  const checked = labelIds.includes(label.id);
                  return (
                    <button
                      key={label.id}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      onClick={() => {
                        setLabelIds((prev) =>
                          checked
                            ? prev.filter((id) => id !== label.id)
                            : [...prev, label.id],
                        );
                      }}
                      className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-ink-200 hover:bg-ink-700 focus:bg-ink-700 focus:outline-none"
                    >
                      <span
                        className={cn(
                          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border',
                          checked
                            ? 'border-signal-500 bg-signal-600 text-white'
                            : 'border-ink-500',
                        )}
                        aria-hidden="true"
                      >
                        {checked && (
                          <svg
                            width="9"
                            height="9"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </span>
                      {label.color && (
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: label.color }}
                          aria-hidden="true"
                        />
                      )}
                      {label.name}
                    </button>
                  );
                })}
              </div>
            )}
            {labelPickerOpen && labels.length === 0 && (
              <div className="absolute bottom-full left-0 z-50 mb-2 rounded-lg border border-ink-700 bg-ink-800 p-3 text-xs text-ink-400 shadow-dropdown">
                No labels in this project yet.
              </div>
            )}
          </div>
        </div>

        {/* Spacer */}
        <div className="hidden flex-1 sm:block" />

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <Button
            data-testid="bulk-apply"
            size="sm"
            variant="primary"
            disabled={!hasAnyChange || isPending}
            loading={isPending}
            onClick={handleApply}
          >
            Apply
          </Button>
          <Button
            data-testid="bulk-clear"
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={handleClear}
            className="text-ink-300 hover:bg-ink-700 hover:text-white"
          >
            Clear
          </Button>
        </div>
      </div>
    </div>
  );

  return createPortal(bar, document.body);
}

// ---------------------------------------------------------------------------
// BarSelect — styled select for the dark action bar
// ---------------------------------------------------------------------------

function BarSelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-8 appearance-none rounded border px-2.5 pr-7 text-xs font-medium transition-all duration-[120ms]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-offset-1 focus-visible:ring-offset-ink-900',
          value === UNSET
            ? 'border-ink-600 bg-ink-800 text-ink-300 hover:border-ink-500 hover:text-white'
            : 'border-signal-500 bg-signal-900/60 text-signal-200',
          // Custom chevron
          "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 fill=%22none%22 viewBox=%220 0 24 24%22 stroke=%22%238b95a8%22 stroke-width=%222%22><path stroke-linecap=%22round%22 stroke-linejoin=%22round%22 d=%22M19 9l-7 7-7-7%22/></svg>')] bg-[length:12px] bg-[right_0.4rem_center] bg-no-repeat",
        )}
      >
        {children}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BulkSelectCheckbox — row-level checkbox, stops propagation so row click
// does NOT open the issue drawer.
// ---------------------------------------------------------------------------

export function BulkSelectCheckbox({
  issueId,
  checked,
  onChange,
}: {
  issueId: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      data-testid="bulk-select-row"
      data-issue-id={issueId}
      aria-label={checked ? 'Deselect issue' : 'Select issue'}
      onClick={(e) => e.stopPropagation()}
      className="relative flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center"
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        onClick={(e) => e.stopPropagation()}
      />
      <span
        className={cn(
          'flex h-4 w-4 items-center justify-center rounded border transition-all duration-[120ms]',
          checked
            ? 'border-signal-600 bg-signal-600 text-white'
            : 'border-ink-300 bg-white hover:border-signal-400',
        )}
        aria-hidden="true"
      >
        {checked && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// BulkSelectAll — header "select all" checkbox
// ---------------------------------------------------------------------------

export function BulkSelectAll({
  total,
  selectedCount,
  onChange,
}: {
  total: number;
  selectedCount: number;
  onChange: (selectAll: boolean) => void;
}) {
  const isAll = total > 0 && selectedCount === total;
  const isIndeterminate = selectedCount > 0 && selectedCount < total;

  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  return (
    <label
      data-testid="bulk-select-all"
      aria-label={isAll ? 'Deselect all issues' : 'Select all issues'}
      className="relative flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center"
    >
      <input
        ref={checkboxRef}
        type="checkbox"
        className="sr-only"
        checked={isAll}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        className={cn(
          'flex h-4 w-4 items-center justify-center rounded border transition-all duration-[120ms]',
          isAll || isIndeterminate
            ? 'border-signal-600 bg-signal-600 text-white'
            : 'border-ink-300 bg-white hover:border-signal-400',
        )}
        aria-hidden="true"
      >
        {isAll && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
        {isIndeterminate && !isAll && (
          <svg
            width="10"
            height="2"
            viewBox="0 0 10 2"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect x="0" y="0" width="10" height="2" />
          </svg>
        )}
      </span>
    </label>
  );
}


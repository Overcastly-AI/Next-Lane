/**
 * BoardFilterPanel — the board toolbar's single "Filter" control.
 *
 * Replaces four separate chip systems (Labels / Type / Priority dropdowns,
 * the quick-filter pill row and the assignee select) that each drew a
 * different height, radius and colour, and together pushed the first card
 * ~260px down the page. One trigger with an active-count badge opens one
 * popover that groups every way of narrowing the board.
 *
 * Accessibility contract (relied on by the e2e suite):
 *   - trigger:  button "Filter" (+ count) · aria-haspopup/aria-expanded
 *   - panel:    role="dialog" aria-label="Filters"
 *   - sections: role="group" aria-label="Filter by type|priority|label",
 *               "Quick filters"; options are role="checkbox"
 *   - Escape closes and returns focus to the trigger; Tab out of either end
 *     of the panel closes it (it is portalled, so there is no natural tab
 *     order back to the page).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { IssueType, Priority, type LabelDto, type UserDto } from '@next-lane/shared';
import { DropdownPanel } from '@/components/ui/DropdownPanel';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Option catalogues
// ---------------------------------------------------------------------------

export type QuickFilterKey = 'myIssues' | 'highPriority' | 'unresolved' | 'recent';

export const QUICK_FILTER_KEYS: QuickFilterKey[] = [
  'myIssues',
  'highPriority',
  'unresolved',
  'recent',
];

const QUICK_FILTER_PRESETS: { key: QuickFilterKey; label: string; testId: string }[] = [
  { key: 'myIssues', label: 'My issues', testId: 'quick-filter-my-issues' },
  { key: 'highPriority', label: 'High priority', testId: 'quick-filter-high-priority' },
  { key: 'unresolved', label: 'Unresolved', testId: 'quick-filter-unresolved' },
  { key: 'recent', label: 'Recently updated', testId: 'quick-filter-recent' },
];

const TYPE_OPTIONS: { value: IssueType; label: string }[] = [
  { value: IssueType.TASK, label: 'Task' },
  { value: IssueType.BUG, label: 'Bug' },
  { value: IssueType.STORY, label: 'Story' },
  { value: IssueType.EPIC, label: 'Epic' },
  { value: IssueType.SUBTASK, label: 'Subtask' },
];

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: Priority.HIGHEST, label: 'Highest' },
  { value: Priority.HIGH, label: 'High' },
  { value: Priority.MEDIUM, label: 'Medium' },
  { value: Priority.LOW, label: 'Low' },
  { value: Priority.LOWEST, label: 'Lowest' },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BoardFilterPanelProps {
  users: UserDto[];
  assignee: string;
  onAssigneeChange: (v: string) => void;
  labels: LabelDto[];
  labelFilter: string[];
  onLabelFilterChange: (next: string[]) => void;
  typeFilter: IssueType[];
  onTypeFilterChange: (next: IssueType[]) => void;
  priorityFilter: Priority[];
  onPriorityFilterChange: (next: Priority[]) => void;
  presets: Set<QuickFilterKey>;
  onTogglePreset: (key: QuickFilterKey) => void;
  onClearAll: () => void;
  /** Footer affordance for scoping the board with a default filter. */
  onSetDefaultFilter?: () => void;
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/** One toggle pill. 32px visual height, 40px on touch viewports. */
function TogglePill({
  checked,
  onClick,
  children,
  role = 'checkbox',
  testId,
  ariaPressed,
}: {
  checked: boolean;
  onClick: () => void;
  children: React.ReactNode;
  role?: 'checkbox' | undefined;
  testId?: string;
  /** Quick filters are toggle buttons (aria-pressed), not checkboxes. */
  ariaPressed?: boolean;
}) {
  return (
    <button
      type="button"
      role={ariaPressed === undefined ? role : undefined}
      aria-checked={ariaPressed === undefined ? checked : undefined}
      aria-pressed={ariaPressed}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors duration-[120ms] max-sm:h-10 max-sm:px-3 max-sm:text-sm',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
        checked
          ? 'border-signal-600 bg-signal-600 text-white hover:bg-signal-700'
          : 'border-ink-200 bg-surface text-ink-700 hover:border-ink-300 hover:bg-ink-50',
      )}
    >
      {children}
    </button>
  );
}

function Section({
  title,
  count,
  clearLabel,
  onClear,
  groupLabel,
  children,
}: {
  title: string;
  count?: number;
  clearLabel?: string;
  onClear?: () => void;
  groupLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={groupLabel ? 'group' : undefined}
      aria-label={groupLabel}
      className="px-3 py-2.5"
    >
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="font-display text-[10px] font-bold uppercase tracking-[0.1em] text-ink-500">
          {title}
          {count ? (
            <span className="nl-data-chip ml-1.5 rounded-sm bg-signal-100 px-1.5 py-0.5 normal-case tracking-normal text-signal-700">
              {count}
            </span>
          ) : null}
        </h3>
        {count && onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="-my-1 rounded px-1.5 py-1 text-xs font-medium text-ink-500 hover:bg-ink-100 hover:text-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 max-sm:py-2.5"
          >
            {clearLabel}
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function BoardFilterPanel({
  users,
  assignee,
  onAssigneeChange,
  labels,
  labelFilter,
  onLabelFilterChange,
  typeFilter,
  onTypeFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  presets,
  onTogglePreset,
  onClearAll,
  onSetDefaultFilter,
}: BoardFilterPanelProps) {
  const [open, setOpen] = useState(false);
  const triggerWrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const total =
    labelFilter.length +
    typeFilter.length +
    priorityFilter.length +
    presets.size +
    (assignee ? 1 : 0);

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  // Outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!triggerWrapRef.current?.contains(t) && !panelRef.current?.contains(t)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Move focus into the panel when it opens (keyboard users otherwise land
  // nowhere: the panel is portalled to <body>).
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>('button, select, [tabindex]')
        ?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Drop label ids that no longer exist (label deleted in another tab).
  useEffect(() => {
    if (labelFilter.length === 0) return;
    const ids = new Set(labels.map((l) => l.id));
    const pruned = labelFilter.filter((id) => ids.has(id));
    if (pruned.length !== labelFilter.length) onLabelFilterChange(pruned);
  }, [labels, labelFilter, onLabelFilterChange]);

  function onPanelKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const focusables = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled])') ?? [],
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      close();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      close();
    }
  }

  const labelSet = useMemo(() => new Set(labelFilter), [labelFilter]);
  const typeSet = useMemo(() => new Set(typeFilter), [typeFilter]);
  const prioritySet = useMemo(() => new Set(priorityFilter), [priorityFilter]);

  function toggleIn<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  return (
    <div ref={triggerWrapRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        data-testid="board-filter-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={total > 0 ? `Filter — ${total} active` : 'Filter cards'}
        className={cn(
          'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-sm font-medium transition-colors duration-[120ms] max-sm:h-10',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
          total > 0
            ? 'border-signal-300 bg-signal-50 text-signal-700 hover:bg-signal-100'
            : 'border-ink-200 bg-surface text-ink-700 shadow-xs hover:border-ink-300 hover:bg-ink-50',
        )}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h18l-7 8v6l-4 2v-8z" />
        </svg>
        Filter
        {total > 0 && (
          <span
            data-testid="board-filter-count"
            className="nl-data-chip min-w-[18px] rounded-sm bg-signal-600 px-1.5 py-0.5 text-center leading-none text-white"
          >
            {total}
          </span>
        )}
      </button>

      <DropdownPanel
        open={open}
        anchorRef={triggerWrapRef}
        panelRef={panelRef}
        role="dialog"
        aria-label="Filters"
        className="z-50 w-[22rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-dropdown"
      >
        <div onKeyDown={onPanelKeyDown} className="flex max-h-[min(34rem,calc(100vh-7rem))] flex-col">
          <div className="flex items-center justify-between border-b border-ink-100 px-3 py-2">
            <span className="text-sm font-semibold text-ink-800">Filters</span>
            {total > 0 && (
              <button
                type="button"
                data-testid="board-filter-clear-all"
                onClick={onClearAll}
                className="-my-1 rounded px-2 py-1.5 text-xs font-medium text-signal-700 hover:bg-signal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 max-sm:py-2.5"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="nl-scroll min-h-0 flex-1 divide-y divide-ink-100 overflow-y-auto">
            <Section title="Quick filters" groupLabel="Quick filters">
              <div className="flex flex-wrap gap-1.5">
                {QUICK_FILTER_PRESETS.map((p) => (
                  <TogglePill
                    key={p.key}
                    testId={p.testId}
                    checked={presets.has(p.key)}
                    ariaPressed={presets.has(p.key)}
                    onClick={() => onTogglePreset(p.key)}
                  >
                    {p.label}
                  </TogglePill>
                ))}
              </div>
            </Section>

            <Section title="Assignee">
              <Select
                aria-label="Assignee"
                data-testid="board-filter-assignee"
                value={assignee}
                onChange={(e) => onAssigneeChange(e.target.value)}
                className="max-sm:h-10"
              >
                <option value="">All assignees</option>
                <option value="unassigned">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Section>

            <Section
              title="Type"
              groupLabel="Filter by type"
              count={typeFilter.length}
              clearLabel="Clear type filter"
              onClear={() => onTypeFilterChange([])}
            >
              <div className="flex flex-wrap gap-1.5">
                {TYPE_OPTIONS.map((o) => (
                  <TogglePill
                    key={o.value}
                    checked={typeSet.has(o.value)}
                    onClick={() => onTypeFilterChange(toggleIn(typeFilter, o.value))}
                  >
                    {o.label}
                  </TogglePill>
                ))}
              </div>
            </Section>

            <Section
              title="Priority"
              groupLabel="Filter by priority"
              count={priorityFilter.length}
              clearLabel="Clear priority filter"
              onClear={() => onPriorityFilterChange([])}
            >
              <div className="flex flex-wrap gap-1.5">
                {PRIORITY_OPTIONS.map((o) => (
                  <TogglePill
                    key={o.value}
                    checked={prioritySet.has(o.value)}
                    onClick={() => onPriorityFilterChange(toggleIn(priorityFilter, o.value))}
                  >
                    {o.label}
                  </TogglePill>
                ))}
              </div>
            </Section>

            <Section
              title="Labels"
              groupLabel="Filter by label"
              count={labelFilter.length}
              clearLabel="Clear label filter"
              onClear={() => onLabelFilterChange([])}
            >
              {labels.length === 0 ? (
                <p className="text-xs text-ink-500">No labels yet.</p>
              ) : (
                <ul className="nl-scroll flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                  {labels.map((label) => {
                    const checked = labelSet.has(label.id);
                    return (
                      <li key={label.id}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          onClick={() => onLabelFilterChange(toggleIn(labelFilter, label.id))}
                          className={cn(
                            'inline-flex h-8 items-center gap-1.5 rounded-md border px-1.5 transition-colors duration-[120ms] max-sm:h-10 max-sm:px-2',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                            checked
                              ? 'border-signal-600 bg-signal-50'
                              : 'border-transparent hover:bg-ink-50',
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              'flex h-3.5 w-3.5 items-center justify-center rounded-sm border',
                              checked
                                ? 'border-signal-600 bg-signal-600 text-white'
                                : 'border-ink-300',
                            )}
                          >
                            {checked && (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </span>
                          <Badge color={label.color}>{label.name}</Badge>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </div>

          {onSetDefaultFilter && (
            <div className="border-t border-ink-100 px-3 py-1.5">
              <button
                type="button"
                data-testid="board-filter-chip"
                aria-label="Set a default filter for this board"
                title="Set a default filter for this board"
                onClick={() => {
                  setOpen(false);
                  onSetDefaultFilter();
                }}
                className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-1.5 rounded-md px-1.5 py-2 text-left text-xs text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 max-sm:py-3"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                </svg>
                <span>Default filter</span>
                <span className="ml-auto text-ink-400">Scope this board for everyone</span>
              </button>
            </div>
          )}
        </div>
      </DropdownPanel>
    </div>
  );
}

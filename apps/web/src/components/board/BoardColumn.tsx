import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { BoardColorRule, EvalContext, IssueDto, StatusDto } from '@next-lane/shared';
import { SortableIssueCard } from './SortableIssueCard';
import { resolveCardColor } from '@/lib/cardColors';
import { cn } from '@/lib/cn';

/*
 * DISPATCH lane status signals — the status arc:
 *   TODO        → graphite (queued, resting)
 *   IN_PROGRESS → cobalt signal (dispatched, in motion)
 *   DONE        → eucalyptus (resolved, arrived)
 *
 * Applied as a top accent bar (2px border-top on the column).
 */
const CATEGORY_ACCENT: Record<string, string> = {
  TODO:        'border-t-2 border-t-ink-400',
  IN_PROGRESS: 'border-t-2 border-t-signal-600',
  DONE:        'border-t-2 border-t-emerald-500',
};

/* Status dot color — used in column header */
const CATEGORY_DOT: Record<string, string> = {
  TODO:        'bg-ink-400',
  IN_PROGRESS: 'bg-signal-600',
  DONE:        'bg-emerald-500',
};

/* Issue count pill color */
const CATEGORY_COUNT: Record<string, string> = {
  TODO:        'bg-ink-200 text-ink-600',
  IN_PROGRESS: 'bg-signal-100 text-signal-700',
  DONE:        'bg-emerald-50 text-emerald-700',
};

export function BoardColumn({
  status,
  issues,
  statuses,
  editable = true,
  onAdd,
  onOpenIssue,
  onStatusChange,
  colorRules = [],
  colorCtx,
}: {
  status: StatusDto;
  issues: IssueDto[];
  /** All project statuses — forwarded to each card's inline status picker. */
  statuses: StatusDto[];
  /** When false (VIEWER), hides the add-issue affordance. */
  editable?: boolean;
  onAdd: (statusId: string) => void;
  onOpenIssue: (id: string) => void;
  /** Called when the user selects a new status from a card's inline picker. */
  onStatusChange: (issueId: string, statusId: string) => void;
  /** Board color rules for conditional card coloring. */
  colorRules?: BoardColorRule[];
  /** NLQL evaluation context (users, currentUserId, customFieldDefs). */
  colorCtx?: EvalContext;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: status.id,
    data: { type: 'column', statusId: status.id },
  });

  const accentClass = CATEGORY_ACCENT[status.category] ?? 'border-t-2 border-t-ink-300';
  const dotClass    = CATEGORY_DOT[status.category]    ?? 'bg-ink-400';
  const countClass  = CATEGORY_COUNT[status.category]  ?? 'bg-ink-100 text-ink-600';

  // WIP limit indicator state
  const wipLimit = status.wipLimit ?? null;
  const count = issues.length;
  const isOverLimit = wipLimit !== null && count > wipLimit;

  return (
    <div
      className={cn(
        /*
         * DISPATCH lane column:
         * - tight radius-xl
         * - ink-50 fill (not flat white, not harsh slate)
         * - status accent bar on top
         */
        'flex w-72 shrink-0 flex-col rounded-xl shadow-xs',
        'bg-ink-50 border border-ink-200',
        accentClass,
      )}
    >
      {/* Column header — lane label + signal dot + count pill */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {/* Signal dot — status category color */}
          <span
            className={cn('h-2 w-2 rounded-full shrink-0', dotClass)}
            aria-hidden="true"
          />
          {/*
           * Column name: Space Grotesk for the display weight.
           * DISPATCH lane labels read as "lane names" — spaced, uppercase, precise.
           */}
          <span className="font-display truncate text-[10px] font-bold uppercase tracking-[0.1em] text-ink-500">
            {status.name}
          </span>
          {wipLimit !== null ? (
            /*
             * WIP limit active — render "count / limit".
             * When over limit: red danger tokens (bg-red-50 text-red-700) so the
             * operator sees it immediately. Colour-blind safe: aria-label spells
             * out the state in words.
             */
            <span
              data-testid="column-wip-indicator"
              className={cn(
                'nl-data-chip rounded-sm px-1.5 py-0.5 leading-none',
                isOverLimit
                  ? 'bg-red-50 text-red-700 ring-1 ring-red-200'
                  : countClass,
              )}
              aria-label={
                isOverLimit
                  ? `${count} of ${wipLimit}, over limit`
                  : `${count} of ${wipLimit}`
              }
              title={
                isOverLimit
                  ? `${count} issues — over the WIP limit of ${wipLimit}`
                  : `${count} of ${wipLimit} WIP slots used`
              }
            >
              {count} / {wipLimit}
            </span>
          ) : (
            /* No WIP limit — render exactly as before (no regression). */
            <span
              className={cn(
                'nl-data-chip rounded-sm px-1.5 py-0.5 leading-none',
                countClass,
              )}
            >
              {count}
            </span>
          )}
        </div>
        {editable && (
          <button
            onClick={() => onAdd(status.id)}
            aria-label={`Add issue to ${status.name}`}
            className="rounded p-1 text-ink-400 transition-colors duration-[120ms] hover:bg-ink-200 hover:text-ink-700"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path strokeLinecap="round" d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cn(
          'nl-scroll flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2',
          isOver && 'rounded-lg bg-signal-50/70 ring-1 ring-inset ring-signal-300',
        )}
      >
        <SortableContext
          items={issues.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {issues.map((issue, index) => {
            const matchedRule =
              colorRules.length > 0 && colorCtx
                ? resolveCardColor(colorRules, issue, colorCtx)
                : null;
            return (
              <SortableIssueCard
                key={issue.id}
                issue={issue}
                statuses={statuses}
                onOpen={onOpenIssue}
                onStatusChange={onStatusChange}
                editable={editable}
                accentColor={matchedRule?.color}
                accentRuleId={matchedRule?.id}
                cardIndex={index}
              />
            );
          })}
        </SortableContext>

        {issues.length === 0 && editable && (
          <button
            onClick={() => onAdd(status.id)}
            aria-label={`Add issue to ${status.name}`}
            className="rounded-lg border border-dashed border-ink-300 py-6 text-xs font-medium text-ink-400 transition-all duration-[120ms] hover:border-signal-300 hover:bg-signal-50/40 hover:text-signal-600"
          >
            + Add issue
          </button>
        )}
        {issues.length === 0 && !editable && (
          <p className="py-6 text-center text-xs text-ink-300">
            No issues
          </p>
        )}
      </div>
    </div>
  );
}

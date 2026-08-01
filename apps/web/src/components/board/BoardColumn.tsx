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
/*
 * Lane rail fill — the status colour, used by the capacity rail at the top of
 * each column. Replaces a `border-t-2` accent, which drew the same 2px line
 * whether a lane held one card or was over its limit: decoration, not
 * information.
 */
const CATEGORY_RAIL: Record<string, string> = {
  TODO:        'bg-ink-400',
  IN_PROGRESS: 'bg-signal-600',
  DONE:        'bg-emerald-500',
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

  const railClass   = CATEGORY_RAIL[status.category]   ?? 'bg-ink-400';
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
        'relative flex w-72 shrink-0 flex-col overflow-hidden rounded-xl shadow-xs',
        'bg-ink-50 border border-ink-200',
      )}
    >
      {/*
       * THE LANE CAPACITY RAIL — this board's signature element.
       *
       * A dispatch lane has a capacity, so the strip at the top of the lane
       * shows how full it is rather than just naming its colour. It fills
       * left-to-right in proportion to count/limit, and turns red the moment
       * the lane is over. Across four columns you read the board's load in one
       * glance, before reading a single word.
       *
       * Lanes with NO WIP limit have no capacity to report, so they get a flat
       * low-opacity track — present for colour identity, deliberately not
       * pretending to be a measurement. Showing a full bar there would be a
       * lie about a limit that does not exist.
       */}
      <div className="absolute inset-x-0 top-0 h-[3px] bg-ink-200/70" aria-hidden="true">
        <div
          className={cn(
            'h-full transition-[width] duration-240 ease-out',
            isOverLimit ? 'bg-red-500' : railClass,
            wipLimit === null && 'opacity-40',
          )}
          style={{
            width:
              wipLimit === null
                ? '100%'
                : `${Math.min(100, (count / Math.max(1, wipLimit)) * 100)}%`,
          }}
        />
      </div>

      {/* Column header — lane label + signal dot + count pill */}
      <div className="flex items-center justify-between px-3 pb-2.5 pt-3">
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
                'nl-data-chip inline-flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 leading-none',
                isOverLimit
                  ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200'
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
              {isOverLimit && (
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
              )}
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

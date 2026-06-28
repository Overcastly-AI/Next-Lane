import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { BoardColorRule, EvalContext, IssueDto, StatusDto } from '@next-lane/shared';
import { SortableIssueCard } from './SortableIssueCard';
import { resolveCardColor } from '@/lib/cardColors';
import { cn } from '@/lib/cn';

/**
 * Status-progression accent: the design signature.
 * TODO → stone  |  IN_PROGRESS → amber  |  DONE → emerald
 * Applied as a top border on each column.
 */
const CATEGORY_ACCENT: Record<string, string> = {
  TODO:        'border-t-2 border-t-stone-400',
  IN_PROGRESS: 'border-t-2 border-t-amber-500',
  DONE:        'border-t-2 border-t-emerald-500',
};

const CATEGORY_DOT: Record<string, string> = {
  TODO:        'bg-stone-400',
  IN_PROGRESS: 'bg-amber-500',
  DONE:        'bg-emerald-500',
};

const CATEGORY_COUNT: Record<string, string> = {
  TODO:        'bg-stone-100 text-stone-600',
  IN_PROGRESS: 'bg-amber-50 text-amber-700',
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
  /** When false (VIEWER), hides the add-issue affordance. Column CRUD now lives
   * in project Settings, so the board only adds issues, never edits columns. */
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

  const accentClass = CATEGORY_ACCENT[status.category] ?? 'border-t-2 border-t-slate-300';
  const dotClass    = CATEGORY_DOT[status.category]    ?? 'bg-slate-400';
  const countClass  = CATEGORY_COUNT[status.category]  ?? 'bg-slate-100 text-slate-600';

  return (
    <div
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-xl bg-slate-100/80 shadow-xs',
        accentClass,
      )}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn('h-2 w-2 rounded-full shrink-0', dotClass)}
            aria-hidden="true"
          />
          <span className="truncate text-[11px] font-bold uppercase tracking-widest text-slate-500">
            {status.name}
          </span>
          <span
            className={cn(
              'nl-data-chip rounded-full px-1.5 py-0.5 leading-none',
              countClass,
            )}
          >
            {issues.length}
          </span>
        </div>
        {editable && (
          <button
            onClick={() => onAdd(status.id)}
            aria-label={`Add issue to ${status.name}`}
            className="rounded-md p-1 text-slate-400 transition-colors duration-150 hover:bg-slate-200 hover:text-slate-600"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
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
          isOver && 'rounded-lg bg-brand-50/70 ring-1 ring-inset ring-brand-300',
        )}
      >
        <SortableContext
          items={issues.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {issues.map((issue) => {
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
              />
            );
          })}
        </SortableContext>

        {issues.length === 0 && editable && (
          <button
            onClick={() => onAdd(status.id)}
            aria-label={`Add issue to ${status.name}`}
            className="rounded-lg border border-dashed border-slate-300 py-6 text-xs font-medium text-slate-400 transition-all duration-150 hover:border-brand-300 hover:bg-brand-50/40 hover:text-brand-600"
          >
            + Add issue
          </button>
        )}
        {issues.length === 0 && !editable && (
          <p className="py-6 text-center text-xs text-slate-300">
            No issues
          </p>
        )}
      </div>
    </div>
  );
}

import { forwardRef, type HTMLAttributes } from 'react';
import { StatusCategory, type IssueDto, type StatusDto } from '@next-lane/shared';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { IssueTypeIcon, PriorityIcon } from '@/components/issue/issueMeta';
import { CardStatusPicker } from './CardStatusPicker';
import { cn } from '@/lib/cn';

/**
 * Returns true when the issue's due date is in the past and it is NOT in a
 * Done-category status. Used to apply overdue warning styling.
 */
function isOverdue(issue: IssueDto): boolean {
  if (!issue.dueDate) return false;
  const isDone = issue.status?.category === StatusCategory.DONE;
  if (isDone) return false;
  return new Date(issue.dueDate) < new Date();
}

/** Format an ISO due date string as a compact readable label for the chip. */
function formatDueDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export interface IssueCardProps extends HTMLAttributes<HTMLDivElement> {
  issue: IssueDto;
  dragging?: boolean;
  overlay?: boolean;
  /** Project statuses — required for the inline status picker. */
  statuses?: StatusDto[];
  /** Called when the user selects a new status from the inline picker. */
  onStatusChange?: (statusId: string) => void;
  /**
   * Whether the current user may edit issues. When false the status picker is
   * hidden (VIEWER). Defaults to true so the DragOverlay (no props) still
   * renders the card without the picker rather than crashing.
   */
  editable?: boolean;
}

/** Presentational card. Drag wiring lives in SortableIssueCard. */
export const IssueCard = forwardRef<HTMLDivElement, IssueCardProps>(
  (
    {
      issue,
      dragging,
      overlay,
      statuses,
      onStatusChange,
      editable = true,
      className,
      ...rest
    },
    ref,
  ) => {
    const currentStatus = statuses?.find((s) => s.id === issue.statusId);

    return (
      <div
        ref={ref}
        data-testid="issue-card"
        className={cn(
          'group rounded-md border border-slate-200 bg-white p-3 shadow-card',
          'transition-all duration-150',
          'hover:border-slate-300 hover:shadow-cardHover hover:-translate-y-px',
          dragging && 'opacity-40',
          overlay && 'rotate-1 cursor-grabbing shadow-cardHover scale-105',
          className,
        )}
        {...rest}
      >
        {/* Title */}
        <p className="mb-2 line-clamp-3 text-sm font-medium leading-snug text-slate-800">
          {issue.title}
        </p>

        {/* Labels */}
        {issue.labels && issue.labels.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {issue.labels.map((l) => (
              <Badge key={l.id} color={l.color}>
                {l.name}
              </Badge>
            ))}
          </div>
        )}

        {/* Due date chip */}
        {issue.dueDate && (
          <div className="mb-2">
            <span
              aria-label={`Due ${formatDueDate(issue.dueDate)}${isOverdue(issue) ? ' (overdue)' : ''}`}
              className={cn(
                'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold',
                isOverdue(issue)
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-100 text-slate-500',
              )}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              {formatDueDate(issue.dueDate)}
              {isOverdue(issue) && (
                <span className="sr-only"> (overdue)</span>
              )}
            </span>
          </div>
        )}

        {/* Footer row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {/* Inline status picker */}
            {statuses && statuses.length > 0 && onStatusChange && (
              <CardStatusPicker
                currentStatus={currentStatus}
                statuses={statuses}
                onSelect={onStatusChange}
                editable={editable}
              />
            )}
            <IssueTypeIcon type={issue.type} className="h-3.5 w-3.5 text-slate-400" />
            {/* Issue key — signature mono chip */}
            <span className="nl-issue-key">
              {issue.key}
            </span>
            <PriorityIcon priority={issue.priority} className="h-3.5 w-3.5" />
          </div>
          <div className="flex items-center gap-1.5">
            {issue.storyPoints != null && (
              <span
                title={`${issue.storyPoints} story points`}
                className="nl-data-chip inline-flex min-w-[18px] items-center justify-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-slate-600"
              >
                {issue.storyPoints}
              </span>
            )}
            {typeof issue.commentCount === 'number' &&
              issue.commentCount > 0 && (
                <span className="flex items-center gap-0.5 text-[11px] text-slate-400">
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  {issue.commentCount}
                </span>
              )}
            <Avatar user={issue.assignee} size="sm" />
          </div>
        </div>
      </div>
    );
  },
);
IssueCard.displayName = 'IssueCard';

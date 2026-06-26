import { forwardRef, type HTMLAttributes } from 'react';
import type { IssueDto } from '@next-lane/shared';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { IssueTypeIcon, PriorityIcon } from '@/components/issue/issueMeta';
import { cn } from '@/lib/cn';

export interface IssueCardProps extends HTMLAttributes<HTMLDivElement> {
  issue: IssueDto;
  dragging?: boolean;
  overlay?: boolean;
}

/** Presentational card. Drag wiring lives in SortableIssueCard. */
export const IssueCard = forwardRef<HTMLDivElement, IssueCardProps>(
  ({ issue, dragging, overlay, className, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'group rounded-lg border border-gray-200 bg-white p-3 shadow-card transition-shadow',
          'hover:border-brand-200 hover:shadow-cardHover',
          dragging && 'opacity-40',
          overlay && 'rotate-2 cursor-grabbing shadow-cardHover',
          className,
        )}
        {...rest}
      >
        <p className="mb-2 line-clamp-3 text-sm font-medium text-gray-800">
          {issue.title}
        </p>

        {issue.labels && issue.labels.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {issue.labels.map((l) => (
              <Badge key={l.id} color={l.color}>
                {l.name}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <IssueTypeIcon type={issue.type} className="h-4 w-4" />
            <span className="text-xs font-medium text-gray-400">
              {issue.key}
            </span>
            <PriorityIcon priority={issue.priority} className="h-3.5 w-4" />
          </div>
          <div className="flex items-center gap-2">
            {typeof issue.commentCount === 'number' &&
              issue.commentCount > 0 && (
                <span className="flex items-center gap-0.5 text-xs text-gray-400">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
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

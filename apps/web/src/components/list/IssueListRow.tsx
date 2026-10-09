import type { HTMLAttributes, ReactNode } from 'react';
import type { IssueDto, StatusDto, UserDto } from '@next-lane/shared';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { IssueTypeIcon, PriorityIcon } from '@/components/issue/issueMeta';
import { BulkSelectCheckbox } from '@/components/issue/BulkActionBar';
import { cn } from '@/lib/cn';

/**
 * Fixed-width metadata tracks (status | labels | points | priority). Using a
 * grid with pixel tracks keeps every column at the same x on every row no
 * matter which optional chips a given issue has, and keeps the metadata hugging
 * the title instead of drifting to the far edge (same approach as MyWorkPage).
 */
const META_COLUMNS = '96px 112px 28px 20px';

export interface IssueListRowProps {
  issue: IssueDto;
  assignee: UserDto | null;
  status?: StatusDto;
  /** Bulk-selected (checkbox). */
  checked: boolean;
  /** Keyboard cursor row (Triage). */
  active?: boolean;
  onToggleCheck: (checked: boolean) => void;
  /** When set, the title is a real button (Backlog). Otherwise the row owns clicks (Triage). */
  onOpenTitle?: () => void;
  /** Extra trailing control (move menu, mobile open chevron). */
  trailing?: ReactNode;
  /** Extra props for the <li> (role, id, data-*, click handlers). */
  liProps?: HTMLAttributes<HTMLLIElement> & Record<`data-${string}`, string | number | undefined>;
}

/**
 * The single issue row shared by Backlog and Triage: 44px minimum, key chip on
 * the left, flexible title, fixed-width metadata grid, avatar, trailing action.
 * On mobile the key stacks above the title (so titles aren't squeezed to a few
 * characters) and the metadata collapses to the avatar.
 */
export function IssueListRow({
  issue,
  assignee,
  status,
  checked,
  active = false,
  onToggleCheck,
  onOpenTitle,
  trailing,
  liProps,
}: IssueListRowProps) {
  const { className, ...restLi } = liProps ?? {};
  const labels = issue.labels ?? [];
  const titleBody = (
    <>
      <span className="shrink-0 font-mono text-[11px] leading-tight text-ink-500 sm:w-[4.5rem] sm:text-xs">
        {issue.key}
      </span>
      <span className="min-w-0 truncate text-sm text-ink-900">{issue.title}</span>
    </>
  );
  const titleCls =
    'flex min-w-0 flex-1 flex-col items-stretch sm:flex-row sm:items-center sm:gap-2';

  return (
    <li
      {...restLi}
      className={cn(
        'flex min-h-[44px] items-center gap-2 px-2 py-1.5 transition-colors duration-[120ms] sm:gap-3 sm:px-3',
        checked || active ? 'bg-signal-50' : 'hover:bg-ink-50',
        active && 'ring-1 ring-inset ring-signal-300',
        className,
      )}
    >
      {/* Larger tap target around the 16px checkbox without changing its look. */}
      <span
        className="flex h-10 w-8 shrink-0 cursor-pointer items-center justify-center sm:h-8 sm:w-6"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            e.currentTarget.querySelector('input')?.click();
          }
        }}
      >
        <BulkSelectCheckbox
          issueId={issue.id}
          checked={checked}
          onChange={onToggleCheck}
        />
      </span>
      <IssueTypeIcon type={issue.type} className="hidden h-4 w-4 shrink-0 sm:block" />
      {onOpenTitle ? (
        <button
          type="button"
          onClick={onOpenTitle}
          data-nav-item=""
          className={cn(
            titleCls,
            'rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2',
          )}
        >
          {titleBody}
        </button>
      ) : (
        <div className={titleCls}>{titleBody}</div>
      )}
      <div
        className="hidden shrink-0 items-center gap-2 sm:grid"
        style={{ gridTemplateColumns: META_COLUMNS }}
      >
        <span className="flex min-w-0 items-center">
          {status && <Badge className="max-w-full truncate">{status.name}</Badge>}
        </span>
        <span className="flex min-w-0 items-center gap-1 overflow-hidden">
          {labels.slice(0, 2).map((l) => (
            <Badge key={l.id} color={l.color} className="max-w-[70px] truncate">
              {l.name}
            </Badge>
          ))}
          {labels.length > 2 && (
            <span className="text-[10px] text-ink-400">+{labels.length - 2}</span>
          )}
        </span>
        <span className="flex items-center justify-center">
          {issue.storyPoints != null && (
            <span
              title="Story points"
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-signal-100 px-1.5 text-xs font-semibold text-signal-700"
            >
              {issue.storyPoints}
            </span>
          )}
        </span>
        <span className="flex items-center">
          <PriorityIcon priority={issue.priority} className="h-4 w-4" />
        </span>
      </div>
      <Avatar user={assignee} size="sm" />
      {trailing}
    </li>
  );
}

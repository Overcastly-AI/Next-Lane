import { forwardRef, type HTMLAttributes } from 'react';
import {
  StatusCategory,
  type IssueDto,
  type StatusDto,
  type CustomFieldDefinitionDto,
  type CustomFieldValue,
} from '@next-lane/shared';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { IssueTypeIcon, PriorityIcon } from '@/components/issue/issueMeta';
import { CardStatusPicker } from './CardStatusPicker';
import { useCardFieldDefs } from './CardFieldDefsContext';
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
  /**
   * When set, renders a left accent stripe in this hex color and sets
   * data-color-rule-id for e2e assertions.
   */
  accentColor?: string;
  /** The color rule id that produced accentColor (for data-color-rule-id). */
  accentRuleId?: string;
  /**
   * Custom-field definitions flagged `showOnCard` for this project. Their values
   * (from `issue.customFields`) render as pinned chips on the card.
   */
  cardFieldDefs?: CustomFieldDefinitionDto[];
}

/** Format a custom-field value for a compact card chip. Returns null when empty. */
function formatFieldValue(value: CustomFieldValue | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return value.length ? value.join(', ') : null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
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
      accentColor,
      accentRuleId,
      cardFieldDefs,
      className,
      ...rest
    },
    ref,
  ) => {
    const currentStatus = statuses?.find((s) => s.id === issue.statusId);

    // Pinned custom-field chips: defs flagged showOnCard that have a value on
    // this issue and apply to its type. Defs come from context (board root) or
    // an explicit prop override.
    const contextFieldDefs = useCardFieldDefs();
    const pinnedFields = (cardFieldDefs ?? contextFieldDefs)
      .filter(
        (d) =>
          d.appliesToTypes.length === 0 ||
          d.appliesToTypes.includes(issue.type),
      )
      .map((d) => ({
        def: d,
        text: formatFieldValue(issue.customFields?.[d.id]),
      }))
      .filter((f): f is { def: CustomFieldDefinitionDto; text: string } =>
        f.text !== null,
      );

    return (
      <div
        ref={ref}
        data-testid="issue-card"
        data-color-rule-id={accentRuleId ?? undefined}
        className={cn(
          /*
           * DISPATCH card:
           * - White surface on graphite-ink column fill
           * - Tight md radius (7px) — engineered, not bubbly
           * - Ink-tinted shadow
           * - Subtle border that steps up on hover
           */
          'group relative rounded-md border border-ink-200 bg-white shadow-card',
          'transition-all duration-[120ms]',
          'hover:border-ink-300 hover:shadow-cardHover hover:-translate-y-px',
          dragging && 'opacity-40',
          overlay && 'rotate-1 cursor-grabbing shadow-cardHover scale-105',
          accentColor ? 'flex overflow-hidden p-0' : 'p-3',
          className,
        )}
        {...rest}
      >
        {/* Left accent stripe — rendered when a color rule matches */}
        {accentColor && (
          <div
            aria-hidden="true"
            className="w-1 shrink-0 motion-safe:transition-colors motion-safe:duration-[120ms]"
            style={{ backgroundColor: accentColor }}
          />
        )}

        {/* Card body */}
        <div className={cn('min-w-0 flex-1', accentColor ? 'p-3' : undefined)}>
          {/* Title */}
          <p className="mb-2 line-clamp-3 text-sm font-medium leading-snug text-ink-800">
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

          {/* Pinned custom-field chips */}
          {pinnedFields.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1" data-testid="card-custom-fields">
              {pinnedFields.map(({ def, text }) => (
                <span
                  key={def.id}
                  data-testid="card-custom-field"
                  title={`${def.name}: ${text}`}
                  className="inline-flex max-w-full items-center gap-1 rounded-sm bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-600 ring-1 ring-inset ring-ink-200"
                >
                  <span className="text-ink-400">{def.name}:</span>
                  <span className="truncate text-ink-700">{text}</span>
                </span>
              ))}
            </div>
          )}

          {/* Blocked badge — this issue has unresolved blockers */}
          {issue.blockedByCount != null && issue.blockedByCount > 0 && (
            <div className="mb-2">
              <span
                data-testid="issue-blocked-badge"
                aria-label={`Blocked by ${issue.blockedByCount} ${issue.blockedByCount === 1 ? 'issue' : 'issues'}`}
                title={`Blocked by ${issue.blockedByCount} ${issue.blockedByCount === 1 ? 'issue' : 'issues'}`}
                className="inline-flex items-center gap-1 rounded-sm bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-inset ring-red-200"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path strokeLinecap="round" d="M5.6 5.6l12.8 12.8" />
                </svg>
                Blocked{issue.blockedByCount > 1 ? ` · ${issue.blockedByCount}` : ''}
              </span>
            </div>
          )}

          {/* Due date chip */}
          {issue.dueDate && (
            <div className="mb-2">
              <span
                aria-label={`Due ${formatDueDate(issue.dueDate)}${isOverdue(issue) ? ' (overdue)' : ''}`}
                className={cn(
                  'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
                  isOverdue(issue)
                    ? 'bg-amber-50 text-amber-700 ring-amber-200'
                    : 'bg-ink-100 text-ink-500 ring-ink-200',
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
              <IssueTypeIcon type={issue.type} className="h-3.5 w-3.5 text-ink-400" />
              {/* Issue key — DISPATCH data signature: cobalt mono chip */}
              <span className="nl-issue-key">
                {issue.key}
              </span>
              <PriorityIcon priority={issue.priority} className="h-3.5 w-3.5" />
            </div>
            <div className="flex items-center gap-1.5">
              {issue.storyPoints != null && (
                <span
                  title={`${issue.storyPoints} story points`}
                  className="nl-data-chip inline-flex min-w-[18px] items-center justify-center rounded-sm bg-ink-100 px-1.5 py-0.5 text-ink-600 ring-1 ring-inset ring-ink-200"
                >
                  {issue.storyPoints}
                </span>
              )}
              {typeof issue.commentCount === 'number' &&
                issue.commentCount > 0 && (
                  <span className="flex items-center gap-0.5 text-[11px] text-ink-400">
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
      </div>
    );
  },
);
IssueCard.displayName = 'IssueCard';

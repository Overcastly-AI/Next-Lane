import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { IssueDto, StatusDto } from '@next-lane/shared';
import { IssueCard } from './IssueCard';
import { useBoardSelection } from './BoardSelection';
import { cn } from '@/lib/cn';

export function SortableIssueCard({
  issue,
  statuses,
  onOpen,
  onStatusChange,
  editable = true,
  accentColor,
  accentRuleId,
  cardIndex = 0,
}: {
  issue: IssueDto;
  /** Project statuses forwarded to the inline status picker. */
  statuses: StatusDto[];
  onOpen: (id: string) => void;
  /** Called when the user selects a new status from the inline picker. */
  onStatusChange: (issueId: string, statusId: string) => void;
  /** Whether the current user may edit issues (hides the picker for VIEWERs). */
  editable?: boolean;
  /** Hex color from the first matching color rule (undefined = no match). */
  accentColor?: string;
  /** Rule id that produced accentColor — set as data-color-rule-id on the card. */
  accentRuleId?: string;
  /**
   * Position index within the column — used for the DISPATCH merge-in stagger.
   * Capped at 12 so the max delay stays ~480ms.
   */
  cardIndex?: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: issue.id,
    data: { type: 'issue', statusId: issue.statusId, issue },
  });

  const selection = useBoardSelection();
  const canSelect = selection !== null && editable;
  const selected = canSelect && selection.selectedIds.has(issue.id);
  const selecting = canSelect && (selection.selectMode || selection.selectedIds.size > 0);

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    /* CSS custom property drives the stagger delay in nl-card-merge-in */
    '--nl-card-index': Math.min(cardIndex, 12),
  } as React.CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      /*
       * nl-card-merge-in applies the DISPATCH stagger animation (motion-safe only).
       * The CSS animation fires once on mount/insert — no JS needed.
       */
      className={cn(
        'group/sel relative cursor-grab touch-none rounded-md active:cursor-grabbing motion-safe:nl-card-merge-in',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        selected && 'ring-2 ring-signal-500 ring-offset-1 ring-offset-surface',
        selecting && 'select-none',
      )}
      data-nav-item=""
      data-issue-id={issue.id}
      data-selected={selected ? 'true' : undefined}
      /* Shift-click would otherwise start a native text-range selection. */
      onMouseDown={(e) => {
        if (canSelect && (e.shiftKey || e.metaKey || e.ctrlKey)) e.preventDefault();
      }}
      onClick={(e) => {
        if (isDragging) return;
        if (
          canSelect &&
          (e.shiftKey || e.metaKey || e.ctrlKey || selecting)
        ) {
          e.preventDefault();
          selection.toggle(issue.id);
          return;
        }
        onOpen(issue.id);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.key === 'Enter') {
            e.preventDefault();
            onOpen(issue.id);
          }
        }
      }}
    >
      {canSelect && (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={`${selected ? 'Deselect' : 'Select'} ${issue.key}`}
          data-testid="board-select-checkbox"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            selection.toggle(issue.id);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className={cn(
            'absolute right-1.5 top-1.5 z-10 flex h-[18px] w-[18px] items-center justify-center rounded border shadow-card transition-opacity duration-[120ms]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500',
            selected
              ? 'border-signal-600 bg-signal-600 text-white opacity-100'
              : 'border-ink-300 bg-surface text-transparent hover:border-signal-400',
            selecting
              ? 'opacity-100'
              : 'opacity-0 group-hover/sel:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:hidden',
          )}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 6.5l2.5 2.5 4.5-5.5" />
          </svg>
        </button>
      )}
      <IssueCard
        issue={issue}
        dragging={isDragging}
        statuses={statuses}
        onStatusChange={(statusId) => onStatusChange(issue.id, statusId)}
        editable={editable}
        accentColor={accentColor}
        accentRuleId={accentRuleId}
      />
    </div>
  );
}

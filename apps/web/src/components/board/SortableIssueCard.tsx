import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { IssueDto, StatusDto } from '@next-lane/shared';
import { IssueCard } from './IssueCard';

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
      className="cursor-grab touch-none active:cursor-grabbing motion-safe:nl-card-merge-in"
      onClick={() => {
        if (!isDragging) onOpen(issue.id);
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

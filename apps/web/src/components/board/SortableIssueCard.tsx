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
}: {
  issue: IssueDto;
  /** Project statuses forwarded to the inline status picker. */
  statuses: StatusDto[];
  onOpen: (id: string) => void;
  /** Called when the user selects a new status from the inline picker. */
  onStatusChange: (issueId: string, statusId: string) => void;
  /** Whether the current user may edit issues (hides the picker for VIEWERs). */
  editable?: boolean;
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
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-grab touch-none active:cursor-grabbing"
      onClick={() => {
        if (!isDragging) onOpen(issue.id);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          // Space is also used by dnd-kit keyboard sensor; only Enter opens.
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
      />
    </div>
  );
}

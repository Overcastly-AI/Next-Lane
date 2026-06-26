import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { IssueDto, StatusDto } from '@next-lane/shared';
import { SortableIssueCard } from './SortableIssueCard';
import { cn } from '@/lib/cn';

const CATEGORY_DOT: Record<string, string> = {
  TODO: 'bg-gray-400',
  IN_PROGRESS: 'bg-blue-500',
  DONE: 'bg-green-500',
};

export function BoardColumn({
  status,
  issues,
  onAdd,
  onOpenIssue,
}: {
  status: StatusDto;
  issues: IssueDto[];
  onAdd: (statusId: string) => void;
  onOpenIssue: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: status.id,
    data: { type: 'column', statusId: status.id },
  });

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl bg-gray-100/70">
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              CATEGORY_DOT[status.category] ?? 'bg-gray-400',
            )}
          />
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
            {status.name}
          </span>
          <span className="rounded-full bg-gray-200 px-1.5 text-xs font-medium text-gray-500">
            {issues.length}
          </span>
        </div>
        <button
          onClick={() => onAdd(status.id)}
          aria-label={`Add issue to ${status.name}`}
          className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          'nl-scroll flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2',
          isOver && 'rounded-lg bg-brand-50/60 ring-1 ring-inset ring-brand-200',
        )}
      >
        <SortableContext
          items={issues.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {issues.map((issue) => (
            <SortableIssueCard
              key={issue.id}
              issue={issue}
              onOpen={onOpenIssue}
            />
          ))}
        </SortableContext>

        {issues.length === 0 && (
          <button
            onClick={() => onAdd(status.id)}
            className="rounded-lg border border-dashed border-gray-300 py-6 text-xs text-gray-400 transition-colors hover:border-brand-300 hover:text-brand-600"
          >
            + Add issue
          </button>
        )}
      </div>
    </div>
  );
}

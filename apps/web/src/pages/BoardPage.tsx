import { useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { IssueDto, StatusDto } from '@next-lane/shared';
import { useBoard, useMoveIssue } from '@/api/issues';
import { useUsers } from '@/api/meta';
import { useBoardRealtime } from '@/api/socket';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Avatar } from '@/components/ui/Avatar';
import { ErrorState, LoadingState, EmptyState } from '@/components/ui/States';
import { BoardColumn } from '@/components/board/BoardColumn';
import { IssueCard } from '@/components/board/IssueCard';
import { CreateIssueModal } from '@/components/board/CreateIssueModal';
import { IssueDetailDrawer } from '@/components/issue/IssueDetailDrawer';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';

export function BoardPage() {
  const { projectId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const boardQuery = useBoard(projectId);
  const usersQuery = useUsers();
  const moveIssue = useMoveIssue(projectId);
  const toast = useToast();

  useBoardRealtime(projectId);

  const [search, setSearch] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [createForStatus, setCreateForStatus] = useState<string | null>(null);
  const [activeIssue, setActiveIssue] = useState<IssueDto | null>(null);

  const openIssueId = searchParams.get('issue');

  const board = boardQuery.data;
  const statuses = useMemo<StatusDto[]>(
    () => (board ? [...board.statuses].sort((a, b) => a.order - b.order) : []),
    [board],
  );

  // Group + filter + rank-sort issues per column.
  const issuesByStatus = useMemo(() => {
    const map = new Map<string, IssueDto[]>();
    if (!board) return map;
    for (const s of statuses) map.set(s.id, []);
    const term = search.trim().toLowerCase();
    for (const issue of board.issues) {
      if (term && !issue.title.toLowerCase().includes(term)) continue;
      if (assigneeFilter) {
        if (assigneeFilter === 'unassigned' && issue.assigneeId) continue;
        if (assigneeFilter !== 'unassigned' && issue.assigneeId !== assigneeFilter)
          continue;
      }
      const arr = map.get(issue.statusId);
      if (arr) arr.push(issue);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    }
    return map;
  }, [board, statuses, search, assigneeFilter]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function onDragStart(event: DragStartEvent) {
    const issue = board?.issues.find((i) => i.id === event.active.id);
    setActiveIssue(issue ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveIssue(null);
    const { active, over } = event;
    if (!over || !board) return;

    const activeId = String(active.id);
    const dragged = board.issues.find((i) => i.id === activeId);
    if (!dragged) return;

    // Resolve the destination column. `over` may be a card or a column droppable.
    const overData = over.data.current as
      | { type?: string; statusId?: string }
      | undefined;
    const overIsColumn = overData?.type === 'column';
    const targetStatusId = overIsColumn
      ? String(over.id)
      : (overData?.statusId ?? dragged.statusId);

    // Current ordered list in the target column (post-filter view used for UI,
    // but neighbor resolution uses the same visible ordering the user sees).
    const column = (issuesByStatus.get(targetStatusId) ?? []).filter(
      (i) => i.id !== activeId,
    );

    let insertIndex: number;
    if (overIsColumn) {
      insertIndex = column.length; // dropped on empty space => append
    } else {
      const overIndex = column.findIndex((i) => i.id === String(over.id));
      insertIndex = overIndex === -1 ? column.length : overIndex;
    }

    const beforeIssue = column[insertIndex - 1] ?? null; // sits above
    const afterIssue = column[insertIndex] ?? null; // sits below

    // No-op: dropped back into its original neighbors within the same column.
    if (
      targetStatusId === dragged.statusId &&
      neighborsUnchanged(
        issuesByStatus.get(targetStatusId) ?? [],
        activeId,
        beforeIssue?.id ?? null,
        afterIssue?.id ?? null,
      )
    ) {
      return;
    }

    moveIssue.mutate(
      {
        id: activeId,
        statusId: targetStatusId,
        beforeId: beforeIssue?.id ?? null,
        afterId: afterIssue?.id ?? null,
      },
      {
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not move that card.')),
      },
    );
  }

  function openIssue(id: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('issue', id);
        return next;
      },
      { replace: false },
    );
  }

  function closeIssue() {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('issue');
        return next;
      },
      { replace: false },
    );
  }

  if (boardQuery.isLoading) {
    return (
      <Shell>
        <LoadingState label="Loading board…" />
      </Shell>
    );
  }
  if (boardQuery.isError || !board) {
    return (
      <Shell>
        <ErrorState
          error={boardQuery.error ?? new Error('Board not found')}
          onRetry={() => boardQuery.refetch()}
        />
      </Shell>
    );
  }

  const users = usersQuery.data ?? [];

  return (
    <Shell
      header={
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="text-sm text-gray-400 hover:text-gray-600"
            aria-label="Back to projects"
          >
            Projects
          </Link>
          <span className="text-gray-300">/</span>
          <span className="truncate text-sm font-semibold text-gray-900">
            {board.project.name}
          </span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500">
            {board.project.key}
          </span>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="M21 21l-4-4" />
          </svg>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cards…"
            className="w-56 pl-8"
          />
        </div>
        <Select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="w-44"
        >
          <option value="">All assignees</option>
          <option value="unassigned">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        {assigneeFilter && assigneeFilter !== 'unassigned' && (
          <Avatar
            user={users.find((u) => u.id === assigneeFilter)}
            size="sm"
          />
        )}
        <div className="ml-auto">
          <Button onClick={() => setCreateForStatus(statuses[0]?.id ?? null)}>
            + Create issue
          </Button>
        </div>
      </div>

      {statuses.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title="No columns yet"
            description="This project has no statuses configured."
          />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveIssue(null)}
        >
          <div className="nl-scroll flex flex-1 gap-4 overflow-x-auto px-4 pb-4">
            {statuses.map((status) => (
              <BoardColumn
                key={status.id}
                status={status}
                issues={issuesByStatus.get(status.id) ?? []}
                onAdd={(id) => setCreateForStatus(id)}
                onOpenIssue={openIssue}
              />
            ))}
          </div>

          <DragOverlay>
            {activeIssue ? <IssueCard issue={activeIssue} overlay /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {createForStatus !== null && (
        <CreateIssueModal
          open
          onClose={() => setCreateForStatus(null)}
          projectId={projectId}
          statuses={statuses}
          users={users}
          defaultStatusId={createForStatus || undefined}
        />
      )}

      {openIssueId && (
        <IssueDetailDrawer
          issueId={openIssueId}
          projectId={projectId}
          statuses={statuses}
          users={users}
          onClose={closeIssue}
        />
      )}
    </Shell>
  );
}

/**
 * True when dropping `activeId` between `beforeId`/`afterId` leaves it in the
 * same slot it already occupies — so we can skip a pointless move request.
 */
function neighborsUnchanged(
  ordered: IssueDto[],
  activeId: string,
  beforeId: string | null,
  afterId: string | null,
): boolean {
  const idx = ordered.findIndex((i) => i.id === activeId);
  if (idx === -1) return false;
  const currentBefore = ordered[idx - 1]?.id ?? null;
  const currentAfter = ordered[idx + 1]?.id ?? null;
  return currentBefore === beforeId && currentAfter === afterId;
}

function Shell({
  children,
  header,
}: {
  children: React.ReactNode;
  header?: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col">
      <AppHeader>{header}</AppHeader>
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  SprintState,
  type IssueDto,
  type LabelDto,
  type SprintDto,
  type StatusDto,
} from '@next-lane/shared';
import { useBoard, useMoveIssue } from '@/api/issues';
import { useLabels, useSprints, useUsers } from '@/api/meta';
import { useMyRole } from '@/api/workspaces';
import { canEdit } from '@/lib/permissions';
import { endDateStatus } from '@/lib/sprintDates';
import { useBoardRealtime } from '@/api/socket';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { ErrorState, LoadingState, EmptyState } from '@/components/ui/States';
import { ProjectNav } from '@/components/project/ProjectNav';
import { BoardColumn } from '@/components/board/BoardColumn';
import { IssueCard } from '@/components/board/IssueCard';
import { CreateIssueModal } from '@/components/board/CreateIssueModal';
import { IssueDetailDrawer } from '@/components/issue/IssueDetailDrawer';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

export function BoardPage() {
  const { projectId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const boardQuery = useBoard(projectId);
  const usersQuery = useUsers();
  const labelsQuery = useLabels(projectId);
  const sprintsQuery = useSprints(projectId);
  const moveIssue = useMoveIssue(projectId);
  const toast = useToast();

  useBoardRealtime(projectId);

  const [search, setSearch] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  // Selected label IDs the board is filtered to (a card must carry ALL of them).
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [createForStatus, setCreateForStatus] = useState<string | null>(null);
  const [activeIssue, setActiveIssue] = useState<IssueDto | null>(null);

  const openIssueId = searchParams.get('issue');
  const wantsNewIssue = searchParams.get('new') === '1';

  const board = boardQuery.data;
  const myRole = useMyRole(board?.project.workspaceId);
  const editable = canEdit(myRole);
  const activeSprint = useMemo<SprintDto | null>(
    () =>
      (sprintsQuery.data ?? []).find(
        (s) => s.state === SprintState.ACTIVE,
      ) ?? null,
    [sprintsQuery.data],
  );
  const statuses = useMemo<StatusDto[]>(
    () => (board ? [...board.statuses].sort((a, b) => a.order - b.order) : []),
    [board],
  );

  // Consume a `?new=1` deep-link (e.g. from the command palette "Create issue"
  // action): open the create modal on the first column, then drop the param.
  useEffect(() => {
    if (!wantsNewIssue || statuses.length === 0) return;
    if (editable) setCreateForStatus(statuses[0].id);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
  }, [wantsNewIssue, statuses, editable, setSearchParams]);

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
      if (labelFilter.length > 0) {
        const ids = new Set((issue.labels ?? []).map((l) => l.id));
        if (!labelFilter.every((id) => ids.has(id))) continue;
      }
      const arr = map.get(issue.statusId);
      if (arr) arr.push(issue);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    }
    return map;
  }, [board, statuses, search, assigneeFilter, labelFilter]);

  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  // VIEWERs can't reorder/move cards: registering no sensors makes the board
  // read-only for drag-and-drop while keeping cards clickable to open.
  const noSensors = useSensors();
  const sensors = editable ? dragSensors : noSensors;

  function onDragStart(event: DragStartEvent) {
    const issue = board?.issues.find((i) => i.id === event.active.id);
    setActiveIssue(issue ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveIssue(null);
    const { active, over } = event;
    if (!editable || !over || !board) return;

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
      <Shell projectId={projectId}>
        <LoadingState label="Loading board…" />
      </Shell>
    );
  }
  if (boardQuery.isError || !board) {
    return (
      <Shell projectId={projectId}>
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
      projectId={projectId}
      header={
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <Link
            to="/"
            className="shrink-0 text-sm text-gray-400 hover:text-gray-600"
            aria-label="Back to projects"
          >
            Projects
          </Link>
          <span className="shrink-0 text-gray-300">/</span>
          <span className="min-w-0 truncate text-sm font-semibold text-gray-900">
            {board.project.name}
          </span>
          <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500">
            {board.project.key}
          </span>
          <ActiveSprintBadge sprint={activeSprint} />
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
        <LabelFilter
          labels={labelsQuery.data ?? []}
          selected={labelFilter}
          onChange={setLabelFilter}
        />
        <div className="ml-auto flex items-center gap-2">
          {!editable && (
            <span
              data-testid="readonly-hint"
              className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-500"
              title="You have view-only access to this workspace."
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              View only
            </span>
          )}
          {editable && (
            <Button onClick={() => setCreateForStatus(statuses[0]?.id ?? null)}>
              + Create issue
            </Button>
          )}
        </div>
      </div>

      {statuses.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title="No columns yet"
            description={
              editable
                ? 'Add columns in project settings to start organizing work on the board.'
                : 'This board has no columns yet.'
            }
            action={
              editable ? (
                <Link to={`/projects/${projectId}/settings`}>
                  <Button>Manage columns</Button>
                </Link>
              ) : undefined
            }
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
                editable={editable}
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
          editable={editable}
          onClose={closeIssue}
          onOpenIssue={openIssue}
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

/**
 * Top-bar control to filter the board by one or more labels. A card is shown
 * only when it carries every selected label. Lives next to the search and
 * assignee filters; filtering itself is client-side over the loaded board.
 */
function LabelFilter({
  labels,
  selected,
  onChange,
}: {
  labels: LabelDto[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Drop any selected IDs that no longer exist (e.g. a label was deleted).
  useEffect(() => {
    if (selected.length === 0) return;
    const ids = new Set(labels.map((l) => l.id));
    const pruned = selected.filter((id) => ids.has(id));
    if (pruned.length !== selected.length) onChange(pruned);
  }, [labels, selected, onChange]);

  const selectedSet = new Set(selected);
  const count = selected.length;

  function toggle(id: string) {
    onChange(
      selectedSet.has(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200',
          count > 0
            ? 'border-brand-300 bg-brand-50 text-brand-700'
            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
        )}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <circle cx="7" cy="7" r="1.2" fill="currentColor" />
        </svg>
        {count > 0 ? `Labels (${count})` : 'Labels'}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Filter by label"
          className="absolute left-0 z-20 mt-2 w-60 rounded-lg border border-gray-200 bg-white p-2 shadow-cardHover"
        >
          {labels.length === 0 ? (
            <p className="px-1 py-2 text-xs text-gray-400">No labels yet.</p>
          ) : (
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {labels.map((label) => {
                const checked = selectedSet.has(label.id);
                return (
                  <li key={label.id}>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={checked}
                      onClick={() => toggle(label.id)}
                      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border',
                          checked
                            ? 'border-brand-600 bg-brand-600 text-white'
                            : 'border-gray-300',
                        )}
                      >
                        {checked && (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      <Badge color={label.color}>{label.name}</Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {count > 0 && (
            <div className="mt-1 border-t border-gray-100 pt-1">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full rounded px-1.5 py-1.5 text-left text-xs font-medium text-gray-500 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                Clear label filter
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact badge in the board header surfacing the active sprint's name and,
 * when it has an end date, a relative countdown that turns amber as the
 * deadline nears and red once overdue. Renders nothing when no sprint is
 * active. Tells viewers why some backlog issues aren't on the board.
 */
function ActiveSprintBadge({ sprint }: { sprint: SprintDto | null }) {
  if (!sprint) return null;
  const end = endDateStatus(sprint.endDate);
  const toneClass =
    end?.tone === 'overdue'
      ? 'border-red-200 bg-red-50 text-red-700'
      : end?.tone === 'soon'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-green-200 bg-green-50 text-green-700';
  return (
    <span
      data-testid="active-sprint-badge"
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        toneClass,
      )}
      title={
        end
          ? `${sprint.name} · active · ${end.label}`
          : `${sprint.name} · active`
      }
    >
      <span
        className="h-1.5 w-1.5 rounded-full bg-current"
        aria-hidden="true"
      />
      <span className="max-w-[10rem] truncate">{sprint.name}</span>
      <span className="opacity-70">· active</span>
      {end && <span className="opacity-90">· {end.label}</span>}
    </span>
  );
}

function Shell({
  children,
  header,
  projectId,
}: {
  children: React.ReactNode;
  header?: React.ReactNode;
  projectId?: string;
}) {
  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader>{header}</AppHeader>
      {projectId && <ProjectNav projectId={projectId} />}
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}

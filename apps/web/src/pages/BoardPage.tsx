import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import {
  SprintState,
  IssueType,
  Priority,
  StatusCategory,
  filterIssues,
  validateQuery,
  type CustomFieldDefinitionDto,
  type EvalContext,
  type IssueDto,
  type LabelDto,
  type SprintDto,
  type StatusDto,
  type SavedFilterDto,
} from '@next-lane/shared';
import { useBoards, useBoardDefault, useBoardView } from '@/api/boards';
import { useMoveIssue } from '@/api/issues';
import { useExportCsv } from '@/api/export';
import { useLabels, useSprints, useUsers } from '@/api/meta';
import { useMyRole } from '@/api/workspaces';
import { useCustomFields } from '@/api/custom-fields';
import {
  useSavedFilters,
  useCreateSavedFilter,
  useUpdateSavedFilter,
  useDeleteSavedFilter,
} from '@/api/saved-filters';
import { canEdit } from '@/lib/permissions';
import { EditableSafeKeyboardSensor } from '@/lib/dndSensors';
import { endDateStatus } from '@/lib/sprintDates';
import { useBoardRealtime, usePresence } from '@/api/socket';
import { useAuth } from '@/auth/AuthContext';
import { AppHeader } from '@/components/AppHeader';
import { ProjectBreadcrumb } from '@/components/project/ProjectBreadcrumb';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { DropdownPanel } from '@/components/ui/DropdownPanel';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState, LoadingState, EmptyState } from '@/components/ui/States';
import { ProjectNav } from '@/components/project/ProjectNav';
import { BoardColumn } from '@/components/board/BoardColumn';
import { IssueCard } from '@/components/board/IssueCard';
import { CardFieldDefsProvider } from '@/components/board/CardFieldDefsContext';
import { NlqlInput } from '@/components/board/NlqlInput';
import {
  BoardSwimlanesView,
  computeLanes,
  type GroupByDimension,
} from '@/components/board/BoardSwimlanesView';
import {
  CORE_GROUP_BY_OPTIONS,
  customFieldGroupByOptions,
  isValidGroupByDimension,
  type GroupByOption,
} from '@/lib/groupByDimensions';
import { CreateIssueModal } from '@/components/board/CreateIssueModal';
import { FromTemplateMenu } from '@/components/board/FromTemplateMenu';
import { IssueDetailDrawer } from '@/components/issue/IssueDetailDrawer';
import { PresenceAvatars } from '@/components/board/PresenceAvatars';
import { BoardSwitcher } from '@/components/board/BoardSwitcher';
import { BoardWorkflowSelector } from '@/components/board/BoardWorkflowSelector';
import { CardColorLegend } from '@/components/board/CardColorLegend';
import { ImportCsvModal } from '@/components/ImportCsvModal';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// localStorage key for persisting the selected board per project
// ---------------------------------------------------------------------------

function localBoardKey(projectId: string) {
  return `nl_board_${projectId}`;
}

function loadPersistedBoardId(projectId: string): string | null {
  try {
    return localStorage.getItem(localBoardKey(projectId));
  } catch {
    return null;
  }
}

function persistBoardId(projectId: string, boardId: string) {
  try {
    localStorage.setItem(localBoardKey(projectId), boardId);
  } catch {
    // Ignore storage errors (private browsing quota, etc.)
  }
}

// ---------------------------------------------------------------------------
// BoardPage
// ---------------------------------------------------------------------------

export function BoardPage() {
  const { projectId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const { user: currentUser } = useAuth();

  // ── Board selection ──────────────────────────────────────────────────────

  // Load the board list for the switcher.
  const boardsQuery = useBoards(projectId);
  const boards = boardsQuery.data ?? [];

  // Resolve the selected board id:
  // 1. Persisted value from localStorage (user's last explicit choice).
  // 2. The board with `isDefault: true` from the list.
  // 3. First board in the list (fallback).
  const [selectedBoardId, setSelectedBoardIdState] = useState<string | null>(
    () => loadPersistedBoardId(projectId),
  );

  // Once we have a settled boards list, validate/resolve the selection.
  // BUG 1 FIX: skip the reset while the query is fetching (including background
  // refetches after a create). Without this guard, the stale list (pre-refetch)
  // would see the newly-chosen id as invalid and override it back to the default,
  // racing against the refetch that will add the new board to the list.
  useEffect(() => {
    if (!boards.length) return;
    if (boardsQuery.isFetching) return; // list is mid-refetch; wait for stable data
    const persisted = selectedBoardId;
    const isValid = persisted && boards.some((b) => b.id === persisted);
    if (!isValid) {
      const defaultBoard = boards.find((b) => b.isDefault) ?? boards[0];
      setSelectedBoardIdState(defaultBoard.id);
      persistBoardId(projectId, defaultBoard.id);
    }
  }, [boards, boardsQuery.isFetching, projectId, selectedBoardId]);

  const handleSelectBoard = useCallback(
    (boardId: string) => {
      setSelectedBoardIdState(boardId);
      persistBoardId(projectId, boardId);
    },
    [projectId],
  );

  // When a board is deleted, fall back to the default board.
  const handleBoardDeleted = useCallback(() => {
    const defaultBoard = boards.find((b) => b.isDefault) ?? boards[0];
    if (defaultBoard) {
      setSelectedBoardIdState(defaultBoard.id);
      persistBoardId(projectId, defaultBoard.id);
    }
  }, [boards, projectId]);

  // ── Board view data ──────────────────────────────────────────────────────

  // Fetch the full board view for the selected board.
  const boardViewQuery = useBoardView(selectedBoardId ?? undefined);

  // Also fetch the default board as the initial load (and so the legacy
  // `qk.board(projectId)` entry exists for code that still reads it).
  useBoardDefault(projectId);

  // ── Supporting data ──────────────────────────────────────────────────────

  const usersQuery = useUsers();
  const labelsQuery = useLabels(projectId);
  const sprintsQuery = useSprints(projectId);
  const customFieldsQuery = useCustomFields(projectId);
  const savedFiltersQuery = useSavedFilters(projectId);

  // Realtime — pass boardId so socket events invalidate the right cache entry.
  useBoardRealtime(projectId, undefined, selectedBoardId ?? undefined);
  const presenceViewers = usePresence(projectId, currentUser?.id);

  // ── Derived data ─────────────────────────────────────────────────────────

  const board = boardViewQuery.data;
  const myRole = useMyRole(board?.project.workspaceId);
  const editable = canEdit(myRole);

  // Move-issue mutation keyed to the selected board's cache entry.
  const moveIssue = useMoveIssue(projectId, selectedBoardId ?? undefined);

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

  // ── Filters — URL as single source of truth ──────────────────────────────
  //
  // All filter state is read directly from `searchParams` and written back via
  // `setSearchParams`. There is no separate React state mirror, so there is no
  // bidirectional-sync loop to guard against.  Helpers below compute derived
  // values from the URL and return setters that call `setSearchParams`.
  //
  // URL param names (compact to keep shared links readable):
  //   s         — title search string
  //   assignee  — assignee id or "unassigned"
  //   labels    — comma-separated label ids
  //   types     — comma-separated IssueType values
  //   priorities — comma-separated Priority values
  //   presets   — comma-separated QuickFilterKey values
  //   q         — NLQL query string
  //   issue     — existing deep-link param (preserved)
  //   new       — existing deep-link param (preserved)

  // Read current filter values from URL.
  const search = searchParams.get('s') ?? '';
  const assigneeFilter = searchParams.get('assignee') ?? '';
  const labelFilter = useMemo((): string[] => {
    const raw = searchParams.get('labels');
    return raw ? raw.split(',').filter(Boolean) : [];
  }, [searchParams]);
  const typeFilter = useMemo((): IssueType[] => {
    const raw = searchParams.get('types');
    if (!raw) return [];
    return raw.split(',').filter((v): v is IssueType =>
      Object.values(IssueType).includes(v as IssueType),
    );
  }, [searchParams]);
  const priorityFilter = useMemo((): Priority[] => {
    const raw = searchParams.get('priorities');
    if (!raw) return [];
    return raw.split(',').filter((v): v is Priority =>
      Object.values(Priority).includes(v as Priority),
    );
  }, [searchParams]);
  const nlqlQuery = searchParams.get('q') ?? '';
  const activePresets = useMemo((): Set<QuickFilterKey> => {
    const raw = searchParams.get('presets');
    if (!raw) return new Set<QuickFilterKey>();
    const valid = new Set<QuickFilterKey>(['myIssues', 'highPriority', 'unresolved', 'recent']);
    return new Set(
      raw.split(',').filter((v): v is QuickFilterKey => valid.has(v as QuickFilterKey)),
    );
  }, [searchParams]);

  // Generic URL-param setter. Merges into the existing params (never clobbers
  // `?issue=` or other unrelated params). Uses `replace:true` so incremental
  // typing doesn't spam browser history; use `replace:false` for discrete
  // toggle actions where back-button UX matters.
  function setFilterParam(
    key: string,
    value: string | null,
    opts: { replace: boolean } = { replace: true },
  ) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null || value === '') {
          next.delete(key);
        } else {
          next.set(key, value);
        }
        return next;
      },
      { replace: opts.replace },
    );
  }

  const setSearch = (v: string) => setFilterParam('s', v || null, { replace: true });
  const setAssigneeFilter = (v: string) => setFilterParam('assignee', v || null, { replace: false });
  const setNlqlQuery = (v: string) => setFilterParam('q', v || null, { replace: true });

  const setLabelFilter = (next: string[]) =>
    setFilterParam('labels', next.length ? next.join(',') : null, { replace: false });

  const setTypeFilter = (next: IssueType[]) =>
    setFilterParam('types', next.length ? next.join(',') : null, { replace: false });

  const setPriorityFilter = (next: Priority[]) =>
    setFilterParam('priorities', next.length ? next.join(',') : null, { replace: false });

  function togglePreset(key: QuickFilterKey) {
    const next = new Set(activePresets);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setFilterParam(
      'presets',
      next.size ? [...next].join(',') : null,
      { replace: false },
    );
  }

  // ── Group-by (swimlanes) — URL as single source of truth ─────────────────
  //
  // URL param: ?group=assignee|priority|type|epic|component|sprint|label|
  // cf:<customFieldId> (omitted → the board's per-board `defaultGroupBy`, or
  // None if unset). The sentinel `?group=none` means "explicitly flat",
  // distinct from "no param" — needed so a board WITH a default can still be
  // turned off for the session (clearing the param would just re-apply the
  // default). See `setGroupBy` below.

  const customFieldDefsForGrouping = customFieldsQuery.data ?? [];

  const groupBy = useMemo((): GroupByDimension | null => {
    const raw = searchParams.get('group');
    if (raw === 'none') return null;
    if (raw) {
      return isValidGroupByDimension(raw, customFieldDefsForGrouping)
        ? (raw as GroupByDimension)
        : null;
    }
    const def = board?.board?.defaultGroupBy;
    if (def && isValidGroupByDimension(def, customFieldDefsForGrouping)) {
      return def as GroupByDimension;
    }
    return null;
  }, [searchParams, customFieldDefsForGrouping, board]);

  const setGroupBy = (next: GroupByDimension | null) => {
    if (next === null && board?.board?.defaultGroupBy) {
      setFilterParam('group', 'none', { replace: false });
    } else {
      setFilterParam('group', next, { replace: false });
    }
  };

  // ── Controls opening the Card Colors tab inside the BoardSettingsModal via the toolbar button.
  const [openColorsTab, setOpenColorsTab] = useState(false);
  // ── Controls opening the Default filter field inside the BoardSettingsModal
  // via the toolbar's filter chip / empty-state affordance (Phase 2 nav discoverability).
  const [openFilterField, setOpenFilterField] = useState(false);

  const { exportCsv, isExporting } = useExportCsv({
    projectId,
    nlqlQuery,
    projectKey: board?.project.key,
    onError: () => toast.error("Couldn't export issues."),
  });

  // ── Modals ────────────────────────────────────────────────────────────────

  const [createForStatus, setCreateForStatus] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [activeIssue, setActiveIssue] = useState<IssueDto | null>(null);

  const openIssueId = searchParams.get('issue');
  const wantsNewIssue = searchParams.get('new') === '1';

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

  // ── NLQL validation ───────────────────────────────────────────────────────

  const customFieldDefs = useMemo(
    () =>
      (customFieldsQuery.data ?? []).map((d) => ({
        id: d.id,
        key: d.key,
        name: d.name,
        type: d.type,
      })),
    [customFieldsQuery.data],
  );

  // Full definitions flagged showOnCard — rendered as pinned chips on cards.
  const cardFieldDefs = useMemo(
    () => (customFieldsQuery.data ?? []).filter((d) => d.showOnCard),
    [customFieldsQuery.data],
  );

  const nlqlValidation = useMemo(() => {
    const q = nlqlQuery.trim();
    if (!q) return null; // empty = no filter, no error
    return validateQuery(q, { customFieldDefs });
  }, [nlqlQuery, customFieldDefs]);

  // ── Card colors ───────────────────────────────────────────────────────────

  const colorRules = useMemo(
    () => board?.board?.colorRules ?? [],
    [board],
  );

  // EvalContext for color rule evaluation — rebuilt when users/customFields change.
  const colorCtx = useMemo<EvalContext>(
    () => ({
      currentUserId: currentUser?.id,
      users: (usersQuery.data ?? []).map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
      })),
      customFieldDefs,
      now: new Date(),
    }),
    [currentUser?.id, usersQuery.data, customFieldDefs],
  );

  // ── Grouped issues ────────────────────────────────────────────────────────

  const issuesByStatus = useMemo(() => {
    const map = new Map<string, IssueDto[]>();
    if (!board) return map;
    for (const s of statuses) map.set(s.id, []);
    const term = search.trim().toLowerCase();

    const users = (usersQuery.data ?? []).map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
    }));

    // Board-level default scope: the board's own NLQL filter, ALWAYS applied
    // first so e.g. an "Epics" board only ever shows epics. The user's pill /
    // NLQL / preset filters then compose on top. A broken stored filter shows
    // everything rather than crashing the board.
    const boardFilter = board.board?.filterQuery?.trim() ?? '';
    let baseIssues = board.issues;
    if (boardFilter) {
      try {
        baseIssues = filterIssues(board.issues, boardFilter, {
          currentUserId: currentUser?.id,
          users,
          customFieldDefs,
          now: new Date(),
        });
      } catch {
        baseIssues = board.issues;
      }
    }

    // Pill-filtered issues first.
    const pillFiltered = baseIssues.filter((issue) => {
      if (term && !issue.title.toLowerCase().includes(term)) return false;
      if (assigneeFilter) {
        if (assigneeFilter === 'unassigned' && issue.assigneeId) return false;
        if (assigneeFilter !== 'unassigned' && issue.assigneeId !== assigneeFilter)
          return false;
      }
      if (labelFilter.length > 0) {
        const ids = new Set((issue.labels ?? []).map((l) => l.id));
        if (!labelFilter.every((id) => ids.has(id))) return false;
      }
      if (typeFilter.length > 0 && !typeFilter.includes(issue.type)) return false;
      if (priorityFilter.length > 0 && !priorityFilter.includes(issue.priority))
        return false;
      return true;
    });

    // Apply NLQL on top of pill-filtered set when query is valid and non-empty.
    const trimmedQuery = nlqlQuery.trim();
    let finalIssues: IssueDto[];
    if (trimmedQuery && nlqlValidation?.ok) {
      try {
        finalIssues = filterIssues(pillFiltered, trimmedQuery, {
          currentUserId: currentUser?.id,
          users,
          customFieldDefs,
          now: new Date(),
        });
      } catch {
        // Evaluation error — fall back to pill-filtered set (do not crash).
        finalIssues = pillFiltered;
      }
    } else {
      finalIssues = pillFiltered;
    }

    // Apply quick-filter presets on top of the NLQL-filtered set.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let presetIssues = finalIssues;
    if (activePresets.size > 0) {
      presetIssues = finalIssues.filter((issue) => {
        // "My issues": must be assigned to the current user.
        if (
          activePresets.has('myIssues') &&
          issue.assigneeId !== currentUser?.id
        )
          return false;
        // "High priority": must be HIGH or HIGHEST.
        if (
          activePresets.has('highPriority') &&
          issue.priority !== Priority.HIGH &&
          issue.priority !== Priority.HIGHEST
        )
          return false;
        // "Unresolved": status category must NOT be DONE.
        if (
          activePresets.has('unresolved') &&
          issue.status?.category === StatusCategory.DONE
        )
          return false;
        // "Recently updated": updatedAt within the last 7 days.
        if (
          activePresets.has('recent') &&
          new Date(issue.updatedAt) < sevenDaysAgo
        )
          return false;
        return true;
      });
    }

    for (const issue of presetIssues) {
      const arr = map.get(issue.statusId);
      if (arr) arr.push(issue);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    }
    return map;
  }, [
    board,
    statuses,
    search,
    assigneeFilter,
    labelFilter,
    typeFilter,
    priorityFilter,
    nlqlQuery,
    nlqlValidation,
    customFieldDefs,
    usersQuery.data,
    currentUser?.id,
    activePresets,
  ]);

  // ── Swimlanes — computed from the already-filtered issuesByStatus ────────

  const swimLanes = useMemo(() => {
    if (!groupBy) return null;
    return computeLanes(groupBy, issuesByStatus, usersQuery.data ?? [], {
      sprints: sprintsQuery.data ?? [],
      customFieldDefs: customFieldsQuery.data ?? [],
    });
  }, [groupBy, issuesByStatus, usersQuery.data, sprintsQuery.data, customFieldsQuery.data]);

  // ── Drag and drop ─────────────────────────────────────────────────────────

  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(EditableSafeKeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
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

    const overData = over.data.current as
      | { type?: string; statusId?: string }
      | undefined;
    const overIsColumn = overData?.type === 'column';
    const targetStatusId = overIsColumn
      ? String(over.id)
      : (overData?.statusId ?? dragged.statusId);

    const column = (issuesByStatus.get(targetStatusId) ?? []).filter(
      (i) => i.id !== activeId,
    );

    let insertIndex: number;
    if (overIsColumn) {
      insertIndex = column.length;
    } else {
      const overIndex = column.findIndex((i) => i.id === String(over.id));
      insertIndex = overIndex === -1 ? column.length : overIndex;
    }

    const beforeIssue = column[insertIndex - 1] ?? null;
    const afterIssue = column[insertIndex] ?? null;

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
        boardId: selectedBoardId ?? undefined,
      },
      {
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not move that card.')),
      },
    );
  }

  function handleCardStatusChange(issueId: string, statusId: string) {
    if (!editable || !board) return;
    const issue = board.issues.find((i) => i.id === issueId);
    if (!issue || issue.statusId === statusId) return;

    const targetColumn = (issuesByStatus.get(statusId) ?? []).filter(
      (i) => i.id !== issueId,
    );
    const lastInColumn = targetColumn[targetColumn.length - 1] ?? null;

    moveIssue.mutate(
      {
        id: issueId,
        statusId,
        beforeId: lastInColumn?.id ?? null,
        afterId: null,
        // Pass the board id so the server can check the named workflow for this board.
        boardId: selectedBoardId ?? undefined,
      },
      {
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not change status.')),
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

  // ── Loading / error ───────────────────────────────────────────────────────

  // While the boards list and the selected board view are loading we show a
  // single spinner. Once we have the boards list but are still fetching the
  // selected view we also show the spinner.
  const isLoading =
    boardsQuery.isLoading ||
    (!!selectedBoardId && boardViewQuery.isLoading);

  if (isLoading) {
    return (
      <Shell projectId={projectId}>
        <LoadingState label="Loading board…" />
      </Shell>
    );
  }
  if (boardViewQuery.isError || (selectedBoardId && !board)) {
    return (
      <Shell projectId={projectId}>
        <ErrorState
          error={boardViewQuery.error ?? new Error('Board not found')}
          onRetry={() => boardViewQuery.refetch()}
        />
      </Shell>
    );
  }
  // No boards at all — surface the boards list error or a generic empty state.
  if (!boards.length) {
    if (boardsQuery.isError) {
      return (
        <Shell projectId={projectId}>
          <ErrorState
            error={boardsQuery.error ?? new Error('Could not load boards')}
            onRetry={() => boardsQuery.refetch()}
          />
        </Shell>
      );
    }
    return (
      <Shell projectId={projectId}>
        <EmptyState
          title="No boards yet"
          description="This project has no boards. Contact an admin to create one."
        />
      </Shell>
    );
  }

  // At this point we have `board` from the boardViewQuery. If boardViewQuery has
  // not started yet (selectedBoardId still null), fall back gracefully.
  if (!board) {
    return (
      <Shell projectId={projectId}>
        <LoadingState label="Loading board…" />
      </Shell>
    );
  }

  const users = usersQuery.data ?? [];

  return (
    <CardFieldDefsProvider value={cardFieldDefs}>
    <Shell
      projectId={projectId}
      header={
        <ProjectBreadcrumb
          primary={board.project.name}
          extra={
            <>
              <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs font-medium text-ink-500">
                {board.project.key}
              </span>
              <ActiveSprintBadge sprint={activeSprint} />
            </>
          }
        />
      }
    >
      {/* Toolbar */}
      <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        {/* Row 1: board switcher + search + assignee */}
        <div className="flex items-center gap-3">
          {/* Board switcher */}
          <BoardSwitcher
            projectId={projectId}
            selectedBoardId={selectedBoardId}
            onSelectBoard={handleSelectBoard}
            onBoardDeleted={handleBoardDeleted}
            openColorsTab={openColorsTab}
            onColorsTabOpened={() => setOpenColorsTab(false)}
            openFilterField={openFilterField}
            onFilterFieldOpened={() => setOpenFilterField(false)}
          />

          {/* Board workflow assignment */}
          {selectedBoardId && (
            <BoardWorkflowSelector
              projectId={projectId}
              boardId={selectedBoardId}
              currentWorkflowId={board?.board.workflowId}
              isAdmin={myRole === 'ADMIN'}
            />
          )}

          {/* Search */}
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400"
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
              className="w-44 pl-8 sm:w-56"
            />
          </div>
          <Select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="w-36 sm:w-44"
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
        </div>

        {/* Row 2: filter pills + group-by */}
        <div className="nl-scroll flex items-center gap-3 overflow-x-auto pb-0.5 sm:overflow-x-visible sm:pb-0">
          <LabelFilter
            labels={labelsQuery.data ?? []}
            selected={labelFilter}
            onChange={setLabelFilter}
          />
          <TypeFilter selected={typeFilter} onChange={setTypeFilter} />
          <PriorityFilter selected={priorityFilter} onChange={setPriorityFilter} />
          {/* Group by selector — swimlanes */}
          <GroupBySelector
            value={groupBy}
            onChange={setGroupBy}
            customFieldDefs={customFieldDefsForGrouping}
          />
        </div>

        {/* Quick-filter preset chips */}
        <QuickFilterBar
          activePresets={activePresets}
          onToggle={togglePreset}
        />

        {/* Row 3: NLQL query bar + saved filters */}
        <div className="flex w-full flex-col gap-1 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
          <NlqlQueryBar
            value={nlqlQuery}
            onChange={setNlqlQuery}
            validation={nlqlValidation}
            projectId={projectId}
            savedFilters={savedFiltersQuery.data ?? []}
            currentUserId={currentUser?.id ?? ''}
            statuses={statuses.map((s) => s.name)}
            customFieldDefs={customFieldDefs}
          />
        </div>

        {/* Active board default-filter affordance — explains why the board is
            scoped AND (Phase 2 nav discoverability) is a clickable entry
            point straight into the settings field that controls it, since
            the mechanism itself is otherwise invisible unless you already
            know Board settings → General has a "Default filter" field. */}
        {board?.board?.filterQuery?.trim() ? (
          <button
            type="button"
            data-testid="board-filter-indicator"
            onClick={() => setOpenFilterField(true)}
            aria-label={`Board default filter: ${board.board.filterQuery}. Edit.`}
            title="Edit this board's default filter"
            className={cn(
              'flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] text-ink-500 transition-colors',
              'hover:bg-ink-50 hover:text-ink-700',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1',
            )}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18l-7 8v6l-4 2v-8z" />
            </svg>
            <span>Board filter:</span>
            <code className="rounded bg-ink-50 px-1.5 py-0.5 font-mono text-[11px] text-ink-700 ring-1 ring-inset ring-ink-200">
              {board.board.filterQuery}
            </code>
          </button>
        ) : (
          editable && (
            <button
              type="button"
              data-testid="board-filter-chip"
              onClick={() => setOpenFilterField(true)}
              aria-label="Set a default filter for this board"
              title="Set a default filter for this board"
              className={cn(
                'flex items-center gap-1 rounded-md border border-dashed border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-400 transition-colors',
                'hover:border-ink-300 hover:bg-ink-50 hover:text-ink-600',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1',
              )}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" d="M12 5v14M5 12h14" />
              </svg>
              <span>Default filter</span>
            </button>
          )
        )}

        {/* Card color legend — only when there are labeled rules */}
        {colorRules.length > 0 && (
          <div className="flex items-center gap-2">
            <CardColorLegend rules={colorRules} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:flex-nowrap sm:gap-3">
          <PresenceAvatars viewers={presenceViewers} />

          {/* Card colors button */}
          {editable && (
            <button
              type="button"
              data-testid="card-colors-open"
              aria-label="Manage card colors"
              title="Card colors"
              onClick={() => setOpenColorsTab(true)}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200',
                colorRules.length > 0
                  ? 'border-signal-300 bg-signal-50 text-signal-700 hover:bg-signal-100'
                  : 'border-ink-200 bg-surface text-ink-600 hover:bg-ink-50',
              )}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path strokeLinecap="round" d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
              {colorRules.length > 0 ? `Colors (${colorRules.length})` : 'Colors'}
            </button>
          )}

          {board?.issuesTruncated && (
            <span
              data-testid="board-truncated-hint"
              className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-1 text-xs font-medium text-amber-700"
              title="This board has more than 500 issues. Showing the first 500."
            >
              Showing first 500 issues
            </span>
          )}
          {!editable && (
            <span
              data-testid="readonly-hint"
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500"
              title="You have view-only access to this workspace."
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              View only
            </span>
          )}
          <Button
            variant="secondary"
            size="md"
            data-testid="export-csv"
            aria-label="Export issues as CSV"
            loading={isExporting}
            disabled={isExporting}
            onClick={exportCsv}
          >
            {!isExporting && (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline strokeLinecap="round" strokeLinejoin="round" points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" />
              </svg>
            )}
            Export CSV
          </Button>
          {editable && (
            <Button
              variant="secondary"
              size="md"
              data-testid="import-csv"
              aria-label="Import issues from CSV"
              onClick={() => setImportOpen(true)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline strokeLinecap="round" strokeLinejoin="round" points="7 14 12 9 17 14" />
                <line x1="12" y1="9" x2="12" y2="21" strokeLinecap="round" />
              </svg>
              Import CSV
            </Button>
          )}
          {editable && (
            <>
              <FromTemplateMenu
                projectId={projectId}
                onCreated={(id) => openIssue(id)}
              />
              <Button onClick={() => setCreateForStatus(statuses[0]?.id ?? null)}>
                + Create issue
              </Button>
            </>
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
      ) : groupBy && swimLanes ? (
        /* ── Swimlanes mode — each lane is its own DndContext ── */
        <BoardSwimlanesView
          lanes={swimLanes}
          dimension={groupBy}
          statuses={statuses}
          issuesByStatus={issuesByStatus}
          users={usersQuery.data ?? []}
          editable={editable}
          onAdd={(id) => setCreateForStatus(id)}
          onOpenIssue={openIssue}
          onStatusChange={handleCardStatusChange}
          colorRules={colorRules}
          colorCtx={colorCtx}
          onMove={(params) =>
            moveIssue.mutate(params, {
              onError: (err) =>
                toast.error(errorMessage(err, 'Could not move that card.')),
            })
          }
          neighborsUnchanged={neighborsUnchanged}
        />
      ) : (
        /* ── Flat board mode (default, no group-by) ── */
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveIssue(null)}
        >
          {/*
           * DISPATCH lane board layout — dashed lane-dividers between columns
           * render the left→right flow cue that defines the DISPATCH signature.
           * Each divider is a repeating-gradient vertical hairline (see index.css
           * .nl-lane-divider). Columns themselves carry no left/right padding gap
           * so the divider sits precisely in the gutter between lanes.
           */}
          <div
            data-testid="board-scroll-container"
            className="nl-scroll flex flex-1 overflow-x-auto px-4 pb-4 pt-3 gap-0"
          >
            {statuses.map((status, idx) => (
              <div key={status.id} className="flex items-stretch gap-0">
                {/* Dashed lane divider — between columns, not before the first */}
                {idx > 0 && <div className="nl-lane-divider mx-2" aria-hidden="true" />}
                <BoardColumn
                  status={status}
                  issues={issuesByStatus.get(status.id) ?? []}
                  statuses={statuses}
                  editable={editable}
                  onAdd={(id) => setCreateForStatus(id)}
                  onOpenIssue={openIssue}
                  onStatusChange={handleCardStatusChange}
                  colorRules={colorRules}
                  colorCtx={colorCtx}
                />
              </div>
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
          boardId={selectedBoardId ?? undefined}
        />
      )}

      {openIssueId && (
        <IssueDetailDrawer
          issueId={openIssueId}
          projectId={projectId}
          boardId={selectedBoardId ?? undefined}
          statuses={statuses}
          users={users}
          editable={editable}
          viewerRole={myRole ?? undefined}
          onClose={closeIssue}
          onOpenIssue={openIssue}
        />
      )}

      {importOpen && (
        <ImportCsvModal
          projectId={projectId}
          onClose={() => setImportOpen(false)}
        />
      )}
    </Shell>
    </CardFieldDefsProvider>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// LabelFilter
// ---------------------------------------------------------------------------

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
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
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
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-sm transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200',
          count > 0
            ? 'border-brand-300 bg-brand-50 text-brand-700'
            : 'border-slate-300 bg-surface text-slate-700 hover:bg-slate-50',
        )}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <circle cx="7" cy="7" r="1.2" fill="currentColor" />
        </svg>
        {count > 0 ? `Labels (${count})` : 'Labels'}
      </button>

      <DropdownPanel
        open={open}
        anchorRef={ref}
        panelRef={panelRef}
        role="dialog"
        aria-label="Filter by label"
        className="w-60 rounded-lg border border-slate-200 bg-surface p-2 shadow-cardHover"
      >
        <>
          {labels.length === 0 ? (
            <p className="px-1 py-2 text-xs text-slate-400">No labels yet.</p>
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
                      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border',
                          checked
                            ? 'border-brand-600 bg-brand-600 text-white'
                            : 'border-slate-300',
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
            <div className="mt-1 border-t border-slate-100 pt-1">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full rounded px-1.5 py-1.5 text-left text-xs font-medium text-slate-500 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                Clear label filter
              </button>
            </div>
          )}
        </>
      </DropdownPanel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic multi-select filter
// ---------------------------------------------------------------------------

interface MultiSelectOption {
  value: string;
  label: string;
}

function MultiSelectFilter<T extends string>({
  label,
  icon,
  options,
  selected,
  onChange,
  ariaLabel,
  clearLabel,
}: {
  label: string;
  icon: React.ReactNode;
  options: MultiSelectOption[];
  selected: T[];
  onChange: (next: T[]) => void;
  ariaLabel: string;
  clearLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
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

  const selectedSet = new Set(selected);
  const count = selected.length;

  function toggle(value: T) {
    onChange(
      selectedSet.has(value)
        ? selected.filter((x) => x !== value)
        : [...selected, value],
    );
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-sm transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200',
          count > 0
            ? 'border-brand-300 bg-brand-50 text-brand-700'
            : 'border-slate-300 bg-surface text-slate-700 hover:bg-slate-50',
        )}
      >
        {icon}
        {count > 0 ? `${label} (${count})` : label}
      </button>

      <DropdownPanel
        open={open}
        anchorRef={ref}
        panelRef={panelRef}
        role="dialog"
        aria-label={ariaLabel}
        className="w-52 rounded-lg border border-slate-200 bg-surface p-2 shadow-cardHover"
      >
          <ul className="max-h-64 space-y-0.5 overflow-y-auto">
            {options.map((opt) => {
              const checked = selectedSet.has(opt.value as T);
              return (
                <li key={opt.value}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    onClick={() => toggle(opt.value as T)}
                    className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border',
                        checked
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : 'border-slate-300',
                      )}
                    >
                      {checked && (
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </span>
                    <span className="text-sm text-slate-700">{opt.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {count > 0 && (
            <div className="mt-1 border-t border-slate-100 pt-1">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full rounded px-1.5 py-1.5 text-left text-xs font-medium text-slate-500 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                {clearLabel}
              </button>
            </div>
          )}
      </DropdownPanel>
    </div>
  );
}

const TYPE_OPTIONS: MultiSelectOption[] = [
  { value: IssueType.TASK, label: 'Task' },
  { value: IssueType.BUG, label: 'Bug' },
  { value: IssueType.STORY, label: 'Story' },
  { value: IssueType.EPIC, label: 'Epic' },
  { value: IssueType.SUBTASK, label: 'Subtask' },
];

const PRIORITY_OPTIONS: MultiSelectOption[] = [
  { value: Priority.HIGHEST, label: 'Highest' },
  { value: Priority.HIGH, label: 'High' },
  { value: Priority.MEDIUM, label: 'Medium' },
  { value: Priority.LOW, label: 'Low' },
  { value: Priority.LOWEST, label: 'Lowest' },
];

function TypeFilter({
  selected,
  onChange,
}: {
  selected: IssueType[];
  onChange: (next: IssueType[]) => void;
}) {
  return (
    <MultiSelectFilter<IssueType>
      label="Type"
      icon={
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      }
      options={TYPE_OPTIONS}
      selected={selected}
      onChange={onChange}
      ariaLabel="Filter by type"
      clearLabel="Clear type filter"
    />
  );
}

function PriorityFilter({
  selected,
  onChange,
}: {
  selected: Priority[];
  onChange: (next: Priority[]) => void;
}) {
  return (
    <MultiSelectFilter<Priority>
      label="Priority"
      icon={
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M6 12h12M10 18h4" />
        </svg>
      }
      options={PRIORITY_OPTIONS}
      selected={selected}
      onChange={onChange}
      ariaLabel="Filter by priority"
      clearLabel="Clear priority filter"
    />
  );
}

// ---------------------------------------------------------------------------
// QuickFilterBar
// ---------------------------------------------------------------------------

type QuickFilterKey = 'myIssues' | 'highPriority' | 'unresolved' | 'recent';

interface QuickFilterPreset {
  key: QuickFilterKey;
  label: string;
  testId: string;
  icon: React.ReactNode;
}

const QUICK_FILTER_PRESETS: QuickFilterPreset[] = [
  {
    key: 'myIssues',
    label: 'My issues',
    testId: 'quick-filter-my-issues',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path strokeLinecap="round" d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    ),
  },
  {
    key: 'highPriority',
    label: 'High priority',
    testId: 'quick-filter-high-priority',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
      </svg>
    ),
  },
  {
    key: 'unresolved',
    label: 'Unresolved',
    testId: 'quick-filter-unresolved',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" d="M12 8v4M12 16h.01" />
      </svg>
    ),
  },
  {
    key: 'recent',
    label: 'Recently updated',
    testId: 'quick-filter-recent',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" d="M12 7v5l3 3" />
      </svg>
    ),
  },
];

function QuickFilterBar({
  activePresets,
  onToggle,
}: {
  activePresets: Set<QuickFilterKey>;
  onToggle: (key: QuickFilterKey) => void;
}) {
  return (
    <div
      className="nl-scroll flex items-center gap-1.5 overflow-x-auto pb-0.5 sm:overflow-x-visible sm:pb-0"
      role="group"
      aria-label="Quick filters"
    >
      {QUICK_FILTER_PRESETS.map((preset) => {
        const active = activePresets.has(preset.key);
        return (
          <button
            key={preset.key}
            type="button"
            data-testid={preset.testId}
            aria-pressed={active}
            onClick={() => onToggle(preset.key)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-[120ms]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200',
              active
                ? 'border-brand-600 bg-brand-600 text-white hover:bg-brand-700'
                : 'border-ink-200 bg-surface text-ink-600 hover:border-ink-300 hover:bg-ink-50',
            )}
          >
            {preset.icon}
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActiveSprintBadge
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// NlqlQueryBar + SavedFilters UI
// ---------------------------------------------------------------------------

type NlqlValidation = { ok: boolean; error?: { message: string; position: number } } | null;

interface NlqlQueryBarProps {
  value: string;
  onChange: (v: string) => void;
  validation: NlqlValidation;
  projectId: string;
  savedFilters: SavedFilterDto[];
  currentUserId: string;
  statuses?: string[];
  customFieldDefs?: Array<{ id: string; key: string; name: string; type: string }>;
}

function NlqlQueryBar({
  value,
  onChange,
  validation,
  projectId,
  savedFilters,
  currentUserId,
  statuses,
  customFieldDefs,
}: NlqlQueryBarProps) {
  const toast = useToast();
  const [helpOpen, setHelpOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveShared, setSaveShared] = useState(false);
  const [editFilter, setEditFilter] = useState<SavedFilterDto | null>(null);
  const [editName, setEditName] = useState('');
  const [editShared, setEditShared] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SavedFilterDto | null>(null);

  const filterMenuRef = useRef<HTMLDivElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const helpPanelRef = useRef<HTMLDivElement>(null);

  const createMutation = useCreateSavedFilter(projectId);
  const updateMutation = useUpdateSavedFilter(projectId);
  const deleteMutation = useDeleteSavedFilter(projectId);

  // Close filter menu on outside click / Escape
  useEffect(() => {
    if (!filterMenuOpen) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (
        !filterMenuRef.current?.contains(target) &&
        !filterPanelRef.current?.contains(target)
      ) {
        setFilterMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setFilterMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [filterMenuOpen]);

  // Close help on outside click / Escape
  useEffect(() => {
    if (!helpOpen) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!helpRef.current?.contains(target) && !helpPanelRef.current?.contains(target)) {
        setHelpOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setHelpOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [helpOpen]);

  const hasQuery = value.trim().length > 0;
  const isInvalid = hasQuery && validation !== null && !validation.ok;
  const canSave = hasQuery && (validation === null || validation.ok);

  function handleSelectFilter(sf: SavedFilterDto) {
    onChange(sf.query);
    setFilterMenuOpen(false);
  }

  function openSaveModal() {
    setSaveName('');
    setSaveShared(false);
    setSaveModalOpen(true);
  }

  async function handleSave() {
    if (!saveName.trim()) return;
    try {
      await createMutation.mutateAsync({
        name: saveName.trim(),
        query: value.trim(),
        shared: saveShared,
      });
      setSaveModalOpen(false);
      toast.success('Filter saved.');
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save filter.'));
    }
  }

  function openEditModal(sf: SavedFilterDto) {
    setEditFilter(sf);
    setEditName(sf.name);
    setEditShared(sf.shared);
  }

  async function handleUpdate() {
    if (!editFilter || !editName.trim()) return;
    try {
      await updateMutation.mutateAsync({
        id: editFilter.id,
        input: { name: editName.trim(), shared: editShared },
      });
      setEditFilter(null);
      toast.success('Filter updated.');
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to update filter.'));
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      toast.success('Filter deleted.');
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to delete filter.'));
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        {/* Bar row */}
        <div className="flex items-center gap-1.5">
          {/* Saved-filter selector */}
          <div ref={filterMenuRef} className="relative">
            <button
              type="button"
              data-testid="saved-filter-select"
              aria-label="Saved filters"
              aria-expanded={filterMenuOpen}
              aria-haspopup="menu"
              onClick={() => setFilterMenuOpen((v) => !v)}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200',
                savedFilters.length > 0
                  ? 'border-slate-300 bg-surface text-slate-700 hover:bg-slate-50'
                  : 'border-slate-200 bg-slate-50 text-slate-400',
              )}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </button>

            <DropdownPanel
              open={filterMenuOpen}
              anchorRef={filterMenuRef}
              panelRef={filterPanelRef}
              role="menu"
              aria-label="Saved filters menu"
              className="w-64 rounded-lg border border-slate-200 bg-surface shadow-cardHover"
            >
              <>
                <div className="border-b border-slate-100 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Saved filters
                  </p>
                </div>
                {savedFilters.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-slate-400">
                    No saved filters yet. Type a query and click Save.
                  </p>
                ) : (
                  <ul className="max-h-56 overflow-y-auto py-1">
                    {savedFilters.map((sf) => (
                      <li key={sf.id} className="flex items-center gap-1 px-1">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => handleSelectFilter(sf)}
                          className="flex flex-1 min-w-0 items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                        >
                          <span className="truncate">{sf.name}</span>
                          {sf.shared && (
                            <span className="shrink-0 rounded bg-brand-50 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-600">
                              shared
                            </span>
                          )}
                        </button>
                        {sf.ownerId === currentUserId && (
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              aria-label={`Edit filter ${sf.name}`}
                              onClick={() => { openEditModal(sf); setFilterMenuOpen(false); }}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete filter ${sf.name}`}
                              onClick={() => { setDeleteTarget(sf); setFilterMenuOpen(false); }}
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-6 0V5a1 1 0 011-1h4a1 1 0 011 1v2M9 7H4m16 0h-5" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            </DropdownPanel>
          </div>

          {/* Query input — smart autocomplete */}
          <div className="relative flex-1 sm:min-w-[18rem]">
            <NlqlInput
              value={value}
              onChange={onChange}
              projectId={projectId}
              statuses={statuses}
              customFieldDefs={customFieldDefs}
              aria-describedby={isInvalid ? 'nlql-error-msg' : undefined}
              aria-invalid={isInvalid}
              className={cn('pr-7', isInvalid && 'border-red-400 focus:border-red-500 focus:ring-red-200')}
            />
            {hasQuery && (
              <button
                type="button"
                aria-label="Clear query"
                onClick={() => onChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            )}
          </div>

          {/* Help button */}
          <div ref={helpRef} className="relative">
            <button
              type="button"
              aria-label="NLQL query help"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen((v) => !v)}
              className="inline-flex h-9 w-9 items-center justify-center rounded border border-ink-200 bg-surface text-ink-500 transition-colors duration-[120ms] hover:bg-ink-50 hover:text-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-200"
            >
              <span className="text-xs font-bold leading-none">?</span>
            </button>

            <DropdownPanel
              open={helpOpen}
              anchorRef={helpRef}
              panelRef={helpPanelRef}
              align="end"
              role="dialog"
              aria-label="NLQL help"
              className="w-72 rounded-lg border border-slate-200 bg-surface p-3 shadow-cardHover"
            >
              <>
                <p className="mb-2 text-xs font-semibold text-slate-700">Query language reference</p>
                <div className="space-y-1.5 text-xs text-slate-600">
                  <p className="font-medium text-slate-500">Fields</p>
                  <code className="block text-[11px] text-slate-700">priority, type, status, assignee, labels, dueDate, storyPoints, title, text, key</code>
                  <p className="mt-1.5 font-medium text-slate-500">Operators</p>
                  <code className="block text-[11px] text-slate-700">= != &gt; &lt; &gt;= &lt;= ~ !~ IN NOT IN IS EMPTY</code>
                  <p className="mt-1.5 font-medium text-slate-500">Examples</p>
                  <ul className="space-y-1 font-mono text-[11px] text-slate-700">
                    <li><code>priority = HIGH</code></li>
                    <li><code>type IN (BUG, TASK)</code></li>
                    <li><code>assignee = me()</code></li>
                    <li><code>dueDate &lt; today()</code></li>
                    <li><code>title ~ "login"</code></li>
                    <li><code>labels = "critical"</code></li>
                    <li><code>priority &gt; MEDIUM AND assignee IS EMPTY</code></li>
                  </ul>
                </div>
              </>
            </DropdownPanel>
          </div>

          {/* Save button */}
          <button
            type="button"
            data-testid="saved-filter-save"
            aria-label="Save current filter"
            disabled={!canSave}
            onClick={openSaveModal}
            className={cn(
              'inline-flex h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200',
              canSave
                ? 'border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100'
                : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300',
            )}
          >
            Save
          </button>
        </div>

        {/* Inline error */}
        {isInvalid && validation?.error && (
          <p
            id="nlql-error-msg"
            data-testid="nlql-error"
            role="alert"
            className="text-xs text-red-600"
          >
            {validation.error.message}
          </p>
        )}
      </div>

      {/* Save filter modal */}
      <Modal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        title="Save filter"
        size="max-w-sm"
        footer={
          <>
            <Button variant="secondary" type="button" onClick={() => setSaveModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              loading={createMutation.isPending}
              disabled={!saveName.trim()}
              onClick={() => void handleSave()}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="sf-name">
              Filter name
            </label>
            <Input
              id="sf-name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="e.g. My HIGH priority bugs"
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
              autoFocus
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={saveShared}
              onChange={(e) => setSaveShared(e.target.checked)}
              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm text-slate-700">Share with project members</span>
          </label>
          <p className="text-xs text-slate-500 font-mono truncate" title={value.trim()}>
            Query: {value.trim()}
          </p>
        </div>
      </Modal>

      {/* Edit filter modal */}
      <Modal
        open={editFilter !== null}
        onClose={() => setEditFilter(null)}
        title="Edit filter"
        size="max-w-sm"
        footer={
          <>
            <Button variant="secondary" type="button" onClick={() => setEditFilter(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              loading={updateMutation.isPending}
              disabled={!editName.trim()}
              onClick={() => void handleUpdate()}
            >
              Save changes
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="sf-edit-name">
              Filter name
            </label>
            <Input
              id="sf-edit-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleUpdate(); }}
              autoFocus
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={editShared}
              onChange={(e) => setEditShared(e.target.checked)}
              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm text-slate-700">Share with project members</span>
          </label>
        </div>
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete saved filter"
        message={
          <>
            Are you sure you want to delete{' '}
            <strong>{deleteTarget?.name}</strong>? This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// GroupBySelector — swimlane group-by dimension picker
// ---------------------------------------------------------------------------

function GroupBySelector({
  value,
  onChange,
  customFieldDefs,
}: {
  value: GroupByDimension | null;
  onChange: (next: GroupByDimension | null) => void;
  customFieldDefs: CustomFieldDefinitionDto[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
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

  const customOptions = useMemo(
    () => customFieldGroupByOptions(customFieldDefs),
    [customFieldDefs],
  );
  const allOptions: GroupByOption[] = [...CORE_GROUP_BY_OPTIONS, ...customOptions];
  const activeLabel = allOptions.find((o) => o.value === value)?.label;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        data-testid="swimlane-groupby"
        aria-label="Group by"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-sm transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200',
          value
            ? 'border-brand-300 bg-brand-50 text-brand-700'
            : 'border-slate-300 bg-surface text-slate-700 hover:bg-slate-50',
        )}
      >
        {/* Rows/swimlane icon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="3" width="18" height="5" rx="1" />
          <rect x="3" y="10" width="18" height="5" rx="1" />
          <rect x="3" y="17" width="18" height="5" rx="1" />
        </svg>
        {value ? `Group: ${activeLabel}` : 'Group by'}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <DropdownPanel
        open={open}
        anchorRef={ref}
        panelRef={panelRef}
        role="menu"
        aria-label="Group by menu"
        className="w-52 max-h-[26rem] overflow-y-auto rounded-lg border border-slate-200 bg-surface p-1.5 shadow-cardHover"
      >
        <>
          {/* None option */}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={value === null}
            data-testid="groupby-option-none"
            onClick={() => { onChange(null); setOpen(false); }}
            className={cn(
              'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
              value === null
                ? 'bg-brand-50 font-medium text-brand-700'
                : 'text-slate-700 hover:bg-slate-50',
            )}
          >
            None
          </button>

          <div className="my-1 border-t border-slate-100" />

          {CORE_GROUP_BY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="menuitemradio"
              aria-checked={value === opt.value}
              data-testid={`groupby-option-${opt.value}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
                value === opt.value
                  ? 'bg-brand-50 font-medium text-brand-700'
                  : 'text-slate-700 hover:bg-slate-50',
              )}
            >
              {opt.label}
            </button>
          ))}

          {customOptions.length > 0 && (
            <>
              <div className="my-1 border-t border-slate-100" />
              <p
                className="px-2.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
                aria-hidden="true"
              >
                Custom fields
              </p>
              {customOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === opt.value}
                  data-testid={`groupby-option-${opt.value}`}
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
                    value === opt.value
                      ? 'bg-brand-50 font-medium text-brand-700'
                      : 'text-slate-700 hover:bg-slate-50',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </>
          )}
        </>
      </DropdownPanel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

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

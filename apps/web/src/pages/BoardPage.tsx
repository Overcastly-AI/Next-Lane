import { useCallback, useEffect, useMemo, useState } from 'react';
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
  resolveQueryNames,
  type EvalContext,
  type IssueDto,
  type SprintDto,
  type StatusDto,
} from '@next-lane/shared';
import { useBoards, useBoardDefault, useBoardView } from '@/api/boards';
import { useMoveIssue, useBulkUpdateIssues } from '@/api/issues';
import { useExportCsv } from '@/api/export';
import { useLabels, useSprints, useUsers } from '@/api/meta';
import { useMyRole } from '@/api/workspaces';
import { useCustomFields } from '@/api/custom-fields';
import { useComponents } from '@/api/components';
import {
  useSavedFilters,
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
import { ErrorState, LoadingState, EmptyState } from '@/components/ui/States';
import { ProjectNav } from '@/components/project/ProjectNav';
import { BoardColumn } from '@/components/board/BoardColumn';
import { IssueCard } from '@/components/board/IssueCard';
import { CardFieldDefsProvider } from '@/components/board/CardFieldDefsContext';
import {
  BoardSelectionContext,
  type BoardSelectionValue,
} from '@/components/board/BoardSelection';
import { BulkActionBar } from '@/components/issue/BulkActionBar';
import { isDialogOpen, isTypingTarget } from '@/lib/useGlobalShortcuts';
import { NlqlQueryBar } from '@/components/board/NlqlQueryBar';
import { GroupBySelector } from '@/components/board/GroupBySelector';
import {
  BoardFilterPanel,
  QUICK_FILTER_KEYS,
  type QuickFilterKey,
} from '@/components/board/BoardFilterPanel';
import {
  BoardSwimlanesView,
  computeLanes,
  type GroupByDimension,
} from '@/components/board/BoardSwimlanesView';
import {
  isValidGroupByDimension,
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
  const componentsQuery = useComponents(projectId);
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

  // ── Bulk select ──────────────────────────────────────────────────────────
  const bulkUpdate = useBulkUpdateIssues();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectMode, setSelectMode] = useState(false);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Realtime / refetch: keep only the ids that still exist on the board.
  // Skipped while there is no board payload so a transient loading state never
  // wipes a live selection.
  const boardIssueIds = board?.issues;
  useEffect(() => {
    if (!boardIssueIds) return;
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(boardIssueIds.map((i) => i.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [boardIssueIds]);

  // Leaving the board / switching boards starts with a clean slate.
  useEffect(() => {
    setSelectedIds(new Set());
    setSelectMode(false);
  }, [projectId, selectedBoardId]);

  // Escape clears the selection — but never steals Escape from a dialog, the
  // issue drawer, or a field the user is typing in.
  const hasSelectionState = selectMode || selectedIds.size > 0;
  useEffect(() => {
    if (!hasSelectionState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (isTypingTarget(e.target) || isDialogOpen()) return;
      setSelectedIds(new Set());
      setSelectMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasSelectionState]);

  const selectionValue = useMemo<BoardSelectionValue>(
    () => ({ selectMode, selectedIds, toggle: toggleSelected }),
    [selectMode, selectedIds, toggleSelected],
  );

  const planningSprints = useMemo(
    () =>
      (sprintsQuery.data ?? []).filter((s) => s.state !== SprintState.COMPLETED),
    [sprintsQuery.data],
  );

  function handleBulkApply(
    changes: Parameters<typeof bulkUpdate.mutate>[0]['changes'],
  ) {
    bulkUpdate.mutate(
      { projectId, ids: Array.from(selectedIds), changes },
      {
        onSuccess: (result) => {
          toast.success(
            `Updated ${result.updated} ${result.updated === 1 ? 'issue' : 'issues'}.`,
          );
          if (result.failed.length > 0) {
            toast.error(
              `${result.failed.length} ${result.failed.length === 1 ? 'issue' : 'issues'} could not be updated.`,
            );
          }
          setSelectedIds(new Set());
        },
        onError: (err) => toast.error(errorMessage(err, 'Bulk update failed.')),
      },
    );
  }

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
    const valid = new Set<QuickFilterKey>(QUICK_FILTER_KEYS);
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

  // Clears every narrowing control owned by the Filter popover in ONE history
  // entry (title search and the NLQL query have their own clear affordances).
  function clearAllFilters() {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const k of ['assignee', 'labels', 'types', 'priorities', 'presets']) next.delete(k);
        return next;
      },
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
  const [queryOpen, setQueryOpen] = useState(false);
  const showQuery = queryOpen || nlqlQuery.trim() !== '';
  const [openColorsTab, setOpenColorsTab] = useState(false);
  // ── Controls opening the Default filter field inside the BoardSettingsModal
  // via the toolbar's filter chip / empty-state affordance (Phase 2 nav discoverability).
  const [openFilterField, setOpenFilterField] = useState(false);

  const { exportCsv, isExporting } = useExportCsv({
    projectId,
    nlqlQuery,
    projectKey: board?.project.key,
    onError: (err) => toast.error(err.message || "Couldn't export issues."),
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

  // Users/sprints shaped for NLQL name resolution — reused by both the query
  // bar's validation below and the actual filtering further down.
  const nlqlUsers = useMemo(
    () => (usersQuery.data ?? []).map((u) => ({ id: u.id, name: u.name, email: u.email })),
    [usersQuery.data],
  );
  const nlqlSprints = useMemo(
    () => (sprintsQuery.data ?? []).map((s) => ({ id: s.id, name: s.name })),
    [sprintsQuery.data],
  );

  const nlqlComponents = useMemo(
    () => (componentsQuery.data ?? []).map((c) => ({ id: c.id, name: c.name })),
    [componentsQuery.data],
  );
  const nlqlStatuses = useMemo(
    () => (board?.statuses ?? []).map((s) => ({ id: s.id, name: s.name })),
    [board?.statuses],
  );
  const nlqlLabels = useMemo(
    () => (labelsQuery.data ?? []).map((l) => ({ id: l.id, name: l.name })),
    [labelsQuery.data],
  );

  const nlqlValidation = useMemo(() => {
    const q = nlqlQuery.trim();
    if (!q) return null; // empty = no filter, no error
    const syntax = validateQuery(q, { customFieldDefs });
    if (!syntax.ok) return syntax;
    // Fail loud on an unresolved assignee/reporter/sprint NAME (MCP-QA pass
    // 1, finding 1 residual) — board filtering runs entirely client-side, so
    // there is no server round trip to 400 here; instead this reuses the
    // query bar's existing error affordance to give the same "there is no
    // such user" signal immediately, instead of a confident empty board.
    return resolveQueryNames(q, {
      users: nlqlUsers,
      sprints: nlqlSprints,
      statuses: nlqlStatuses,
      labels: nlqlLabels,
      components: nlqlComponents,
    });
  }, [
    nlqlQuery,
    customFieldDefs,
    nlqlUsers,
    nlqlSprints,
    nlqlStatuses,
    nlqlLabels,
    nlqlComponents,
  ]);

  // ── Card colors ───────────────────────────────────────────────────────────

  const colorRules = useMemo(
    () => board?.board?.colorRules ?? [],
    [board],
  );

  // EvalContext for color rule evaluation — rebuilt when users/customFields change.
  const colorCtx = useMemo<EvalContext>(
    () => ({
      currentUserId: currentUser?.id,
      users: nlqlUsers,
      sprints: nlqlSprints,
      components: nlqlComponents,
      customFieldDefs,
      now: new Date(),
    }),
    [currentUser?.id, nlqlUsers, nlqlSprints, nlqlComponents, customFieldDefs],
  );

  // ── Grouped issues ────────────────────────────────────────────────────────

  const issuesByStatus = useMemo(() => {
    const map = new Map<string, IssueDto[]>();
    if (!board) return map;
    for (const s of statuses) map.set(s.id, []);
    const term = search.trim().toLowerCase();

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
          users: nlqlUsers,
          sprints: nlqlSprints,
          components: nlqlComponents,
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
          users: nlqlUsers,
          sprints: nlqlSprints,
          components: nlqlComponents,
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
    nlqlUsers,
    nlqlSprints,
    nlqlComponents,
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

  // EVERY branch below — loading, error, empty, and the loaded board — must
  // return the SAME root element type (`CardFieldDefsProvider` > `Shell`).
  //
  // It used to return a bare `<Shell>` while loading and
  // `<CardFieldDefsProvider><Shell>` once loaded. React compares element type
  // by position, so that flip unmounted the whole shell and remounted a fresh
  // one the moment the board data landed — taking `ProjectNav` with it and
  // resetting its state. Open the "More" menu on a board that is still
  // fetching and it silently closed itself a beat later; the analytics,
  // automation, roadmap and standups e2e specs hung on exactly that.
  if (isLoading) {
    return (
      <CardFieldDefsProvider value={cardFieldDefs}>
        <Shell projectId={projectId}>
          <LoadingState label="Loading board…" />
        </Shell>
      </CardFieldDefsProvider>
    );
  }
  if (boardViewQuery.isError || (selectedBoardId && !board)) {
    return (
      <CardFieldDefsProvider value={cardFieldDefs}>
        <Shell projectId={projectId}>
          <ErrorState
            error={boardViewQuery.error ?? new Error('Board not found')}
            onRetry={() => boardViewQuery.refetch()}
          />
        </Shell>
      </CardFieldDefsProvider>
    );
  }
  // No boards at all — surface the boards list error or a generic empty state.
  if (!boards.length) {
    if (boardsQuery.isError) {
      return (
        <CardFieldDefsProvider value={cardFieldDefs}>
          <Shell projectId={projectId}>
            <ErrorState
              error={boardsQuery.error ?? new Error('Could not load boards')}
              onRetry={() => boardsQuery.refetch()}
            />
          </Shell>
        </CardFieldDefsProvider>
      );
    }
    return (
      <CardFieldDefsProvider value={cardFieldDefs}>
        <Shell projectId={projectId}>
          <EmptyState
            title="No boards yet"
            description="This project has no boards. Contact an admin to create one."
          />
        </Shell>
      </CardFieldDefsProvider>
    );
  }

  // At this point we have `board` from the boardViewQuery. If boardViewQuery has
  // not started yet (selectedBoardId still null), fall back gracefully.
  if (!board) {
    return (
      <CardFieldDefsProvider value={cardFieldDefs}>
        <Shell projectId={projectId}>
          <LoadingState label="Loading board…" />
        </Shell>
      </CardFieldDefsProvider>
    );
  }

  const users = usersQuery.data ?? [];

  return (
    <CardFieldDefsProvider value={cardFieldDefs}>
    <BoardSelectionContext.Provider value={selectionValue}>
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
      {/*
       * Toolbar — ONE row on desktop, three short rows on a phone.
       *
       * It used to stack three rows of four different chip systems (board
       * picker + search + assignee, Labels/Type/Priority/Group by + four
       * quick-filter pills, then the NLQL bar) which put the first card
       * ~260px down the page. Now:
       *
       *   [board][workflow] [search] [Filter n] [Group by] [Query]  …  [view tools] [+ Create issue]
       *
       * - Everything that narrows the board lives in ONE "Filter" popover
       *   (quick filters, assignee, type, priority, labels) with an
       *   active-count badge — see BoardFilterPanel.
       * - The NLQL bar is a power tool: it opens under the row via the
       *   "Query" toggle, and stays open while a `?q=` is applied so an
       *   active query is never hidden.
       * - The row wraps rather than clips if the viewport is tight; below sm
       *   the flat children are re-flowed with `basis-full` breaks:
       *     1  board picker + Create issue
       *     2  search + Filter
       *     3  a horizontally scrollable strip (Group by, Query, view tools)
       *   so nothing is ever cut off at the right edge.
       */}
      <div className="px-4 py-2.5 max-sm:px-3" data-testid="board-toolbar">
        <div className="flex flex-wrap items-center gap-2">
          {/* Board picker (+ workflow, desktop) */}
          <div className="flex min-w-0 items-center gap-2 max-sm:flex-1">
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
          </div>

          {/* Primary action — last on desktop, beside the picker on a phone */}
          <div className="flex shrink-0 items-center gap-2 sm:order-last">
            <PresenceAvatars viewers={presenceViewers} />
            {editable && (
              <Button
                className="max-sm:h-10"
                onClick={() => setCreateForStatus(statuses[0]?.id ?? null)}
              >
                + Create issue
              </Button>
            )}
          </div>

          <div className="h-0 basis-full sm:hidden" aria-hidden="true" />

          {/* Search */}
          <div className="relative min-w-0 max-sm:flex-1 sm:w-52">
            <svg
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path strokeLinecap="round" d="M21 21l-4-4" />
            </svg>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cards…"
              aria-label="Search cards"
              data-shortcut-search=""
              className="rounded-md pl-8 max-sm:h-10"
            />
          </div>

          <BoardFilterPanel
            users={users}
            assignee={assigneeFilter}
            onAssigneeChange={setAssigneeFilter}
            labels={labelsQuery.data ?? []}
            labelFilter={labelFilter}
            onLabelFilterChange={setLabelFilter}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            priorityFilter={priorityFilter}
            onPriorityFilterChange={setPriorityFilter}
            presets={activePresets}
            onTogglePreset={togglePreset}
            onClearAll={clearAllFilters}
            onSetDefaultFilter={
              editable && !board?.board?.filterQuery?.trim()
                ? () => setOpenFilterField(true)
                : undefined
            }
          />

          <div className="h-0 basis-full sm:hidden" aria-hidden="true" />

          {/* Secondary controls: a scroll strip on phones, inline on desktop */}
          <div className="nl-scroll -mx-3 flex min-w-0 basis-full items-center gap-2 overflow-x-auto px-3 pb-0.5 sm:contents">
            <GroupBySelector
              value={groupBy}
              onChange={setGroupBy}
              customFieldDefs={customFieldDefsForGrouping}
            />

            <button
              type="button"
              data-testid="board-query-toggle"
              aria-pressed={showQuery}
              aria-expanded={showQuery}
              aria-controls="board-query-bar"
              title={
                nlqlQuery.trim()
                  ? 'A query is applied — clear it to hide the query bar'
                  : 'Filter with a query (NLQL)'
              }
              onClick={() => setQueryOpen((v) => !v)}
              disabled={!!nlqlQuery.trim()}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-sm font-medium transition-colors duration-[120ms] max-sm:h-10',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                showQuery
                  ? 'border-signal-300 bg-signal-50 text-signal-700'
                  : 'border-ink-200 bg-surface text-ink-700 shadow-xs hover:border-ink-300 hover:bg-ink-50',
                nlqlQuery.trim() && 'cursor-default',
              )}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l-4 3 4 3M16 9l4 3-4 3M14 5l-4 14" />
              </svg>
              Query
            </button>

            {/* Workflow assignment (admins) / badge */}
            {selectedBoardId && (
              <div className="shrink-0 max-sm:order-last">
                <BoardWorkflowSelector
                  projectId={projectId}
                  boardId={selectedBoardId}
                  currentWorkflowId={board?.board.workflowId}
                  isAdmin={myRole === 'ADMIN'}
                />
              </div>
            )}

            {/* Active board default filter — explains why the board is scoped
                and is the entry point into the setting that controls it. */}
            {board?.board?.filterQuery?.trim() ? (
              <button
                type="button"
                data-testid="board-filter-indicator"
                onClick={() => setOpenFilterField(true)}
                aria-label={`Board default filter: ${board.board.filterQuery}. Edit.`}
                title="Edit this board's default filter"
                className={cn(
                  'inline-flex h-9 min-w-0 max-w-[16rem] shrink-0 items-center gap-1.5 rounded-md border border-dashed border-ink-300 px-2.5 text-xs text-ink-600 transition-colors max-sm:h-10',
                  'hover:border-ink-400 hover:bg-ink-50 hover:text-ink-800',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                )}
              >
                <svg className="shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18l-7 8v6l-4 2v-8z" />
                </svg>
                <span className="shrink-0">Board filter:</span>
                <code className="truncate font-mono text-[11px] text-ink-800">
                  {board.board.filterQuery}
                </code>
              </button>
            ) : null}

            {/* View tools + status hints — pushed right on desktop */}
            <div className="flex shrink-0 items-center gap-1.5 sm:ml-auto">
              {board?.issuesTruncated && (
                <span
                  data-testid="board-truncated-hint"
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"
                  title="This board has more than 500 issues. Showing the first 500."
                >
                  Showing first 500 issues
                </span>
              )}
              {!editable && (
                <span
                  data-testid="readonly-hint"
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-ink-100 px-2 py-1 text-xs font-medium text-ink-600"
                  title="You have view-only access to this workspace."
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  View only
                </span>
              )}

              <div role="group" aria-label="Board tools" className="flex items-center gap-0.5">
                {editable && (
                  <ToolbarIconButton
                    data-testid="card-colors-open"
                    label="Manage card colors"
                    title={
                      colorRules.length > 0
                        ? `Card colors — ${colorRules.length} ${colorRules.length === 1 ? 'rule' : 'rules'} active`
                        : 'Card colors'
                    }
                    onClick={() => setOpenColorsTab(true)}
                    active={colorRules.length > 0}
                    wide={colorRules.length > 0}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <circle cx="12" cy="12" r="4" />
                      <path strokeLinecap="round" d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                    </svg>
                    {colorRules.length > 0 && (
                      <span className="text-xs font-semibold">Colors ({colorRules.length})</span>
                    )}
                  </ToolbarIconButton>
                )}
                {editable && (
                  <ToolbarIconButton
                    data-testid="board-select-toggle"
                    label={selectMode ? 'Done selecting' : 'Select cards'}
                    title="Select cards for bulk edit (Shift-click also works)"
                    aria-pressed={selectMode}
                    onClick={() => setSelectMode((v) => !v)}
                    active={selectMode}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12.5l3 3 5-6" />
                    </svg>
                  </ToolbarIconButton>
                )}
                <ToolbarIconButton
                  data-testid="export-csv"
                  label="Export issues as CSV"
                  title="Export issues as CSV"
                  disabled={isExporting}
                  onClick={exportCsv}
                >
                  {isExporting ? (
                    <span
                      aria-hidden="true"
                      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                    />
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                      <polyline strokeLinecap="round" strokeLinejoin="round" points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" />
                    </svg>
                  )}
                </ToolbarIconButton>
                {editable && (
                  <ToolbarIconButton
                    data-testid="import-csv"
                    label="Import issues from CSV"
                    title="Import issues from CSV"
                    onClick={() => setImportOpen(true)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                      <polyline strokeLinecap="round" strokeLinejoin="round" points="7 14 12 9 17 14" />
                      <line x1="12" y1="9" x2="12" y2="21" strokeLinecap="round" />
                    </svg>
                  </ToolbarIconButton>
                )}
              </div>

              {editable && (
                <FromTemplateMenu
                  projectId={projectId}
                  onCreated={(id) => openIssue(id)}
                />
              )}
            </div>
          </div>
        </div>

        {/* Query strip — opens under the row; see the toolbar comment. */}
        {showQuery && (
          <div id="board-query-bar" className="mt-2">
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
        )}

        {/* Card color legend — only when there are labeled rules */}
        {colorRules.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <CardColorLegend rules={colorRules} />
          </div>
        )}
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
            className={cn(
              'nl-scroll flex flex-1 overflow-x-auto px-4 pb-4 pt-3 gap-0',
              /* Keep the last cards reachable above the fixed bulk bar. */
              selectedIds.size > 0 && 'pb-52 sm:pb-24',
            )}
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
      {editable && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          statuses={statuses}
          users={users}
          labels={labelsQuery.data ?? []}
          sprints={planningSprints}
          showSprint
          isPending={bulkUpdate.isPending}
          onApply={handleBulkApply}
          onClear={clearSelection}
        />
      )}
    </Shell>
    </BoardSelectionContext.Provider>
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
// ActiveSprintBadge
// ---------------------------------------------------------------------------

function ToolbarIconButton({
  label,
  active,
  wide,
  className,
  children,
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  /** Accessible name (also surfaced as the tooltip unless `title` is set). */
  label: string;
  active?: boolean;
  /** Icon + text variant (e.g. "Colors (2)"). */
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={rest.title ?? label}
      {...rest}
      className={cn(
        'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md text-sm transition-colors duration-[120ms] max-sm:h-10',
        wide ? 'px-2.5' : 'w-9 max-sm:w-10',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
        'disabled:cursor-not-allowed disabled:opacity-55',
        active
          ? 'bg-signal-50 text-signal-700 hover:bg-signal-100'
          : 'text-ink-500 hover:bg-ink-100 hover:text-ink-900',
        className,
      )}
    >
      {children}
    </button>
  );
}

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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  rankBetween,
  type BoardDto,
  type IssueDto,
  type IssueType,
  type PaginatedIssuesDto,
  type Priority,
} from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

/**
 * @deprecated Use `useBoardDefault` from `@/api/boards` for new code.
 * Kept here for backward compatibility with the legacy project-board endpoint.
 */
export function useBoard(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.board(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () => request<BoardDto>(`/projects/${projectId}/board`),
  });
}

/**
 * All issues in a project (regardless of sprint), used by the backlog/sprint
 * planning view. The board endpoint only returns backlog + active-sprint issues,
 * so the planning view needs this unfiltered list.
 */
export function useProjectIssues(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.projectIssues(projectId ?? ''),
    enabled: !!projectId,
    queryFn: async () => {
      // The list endpoint is cursor-paginated ({ items, nextCursor }); the
      // planning view wants every issue, so walk all pages and flatten.
      const all: IssueDto[] = [];
      let cursor: string | null = null;
      do {
        // Use the API's maximum page size (200) to minimize round-trips.
        const params = new URLSearchParams({
          projectId: projectId ?? '',
          limit: '200',
        });
        if (cursor) params.set('cursor', cursor);
        const page: PaginatedIssuesDto = await request<PaginatedIssuesDto>(
          `/issues?${params.toString()}`,
        );
        all.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      return all;
    },
  });
}

export function useIssue(issueId: string | undefined) {
  return useQuery({
    queryKey: qk.issue(issueId ?? ''),
    enabled: !!issueId,
    queryFn: () => request<IssueDto>(`/issues/${issueId}`),
  });
}

/**
 * Search a project's issues by title (server-side `contains`). Used by the
 * parent picker in the issue drawer. Disabled until a query is non-empty to
 * avoid loading the whole project on open.
 */
export function useIssueSearch(projectId: string, q: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: qk.issueSearch(projectId, trimmed),
    enabled: !!projectId && trimmed.length > 0,
    queryFn: async () => {
      const params = new URLSearchParams({ projectId, q: trimmed });
      const page = await request<PaginatedIssuesDto>(
        `/issues?${params.toString()}`,
      );
      return page.items;
    },
  });
}

export interface CreateIssueInput {
  projectId: string;
  title: string;
  type: IssueType;
  priority: Priority;
  statusId?: string;
  assigneeId?: string | null;
  description?: string;
  /** Assign the new issue to a sprint on creation (e.g. inline backlog/sprint create). */
  sprintId?: string | null;
}

export function useCreateIssue(projectId: string, boardId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIssueInput) =>
      request<IssueDto>('/issues', { method: 'POST', body: input }),
    onSuccess: (created) => {
      // Push the new issue into the planning view's project-issues list so the
      // backlog/sprint sections reflect it immediately, then invalidate to
      // reconcile with the server.
      qc.setQueryData<IssueDto[]>(qk.projectIssues(projectId), (list) =>
        list && !list.some((i) => i.id === created.id)
          ? [...list, created]
          : list,
      );
      void qc.invalidateQueries({ queryKey: qk.projectIssues(projectId) });
      void qc.invalidateQueries({ queryKey: qk.board(projectId) });
      if (boardId) {
        void qc.invalidateQueries({ queryKey: qk.boardView(boardId) });
      }
    },
  });
}

export interface UpdateIssueInput {
  id: string;
  projectId: string;
  patch: Partial<{
    title: string;
    description: string | null;
    statusId: string;
    assigneeId: string | null;
    priority: Priority;
    type: IssueType;
    storyPoints: number | null;
    parentId: string | null;
    sprintId: string | null;
    labelIds: string[];
    /** ISO 8601 date string or null to clear the due date. */
    dueDate: string | null;
  }>;
}

export function useUpdateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateIssueInput) =>
      request<IssueDto>(`/issues/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: (updated, vars) => {
      // Merge the PATCH response into the cached issue for an instant update, but
      // keep relations the response omits (parent/children/comments/activities)
      // by refetching — the update endpoint returns the list-shaped issue only.
      qc.setQueryData<IssueDto>(qk.issue(updated.id), (prev) =>
        prev ? { ...prev, ...updated } : updated,
      );
      // Also patch the project-issues list used by the triage/backlog views so
      // status/priority/assignee changes are immediately visible there.
      qc.setQueryData<IssueDto[]>(qk.projectIssues(vars.projectId), (list) =>
        list
          ? list.map((i) => (i.id === updated.id ? { ...i, ...updated } : i))
          : list,
      );
      void qc.invalidateQueries({ queryKey: qk.issue(updated.id) });
      void qc.invalidateQueries({ queryKey: qk.board(vars.projectId) });
      void qc.invalidateQueries({ queryKey: qk.projectIssues(vars.projectId) });
    },
  });
}

export function useDeleteIssue(projectId: string, boardId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/issues/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.board(projectId) });
      if (boardId) {
        void qc.invalidateQueries({ queryKey: qk.boardView(boardId) });
      }
    },
  });
}

interface AssignSprintVars {
  id: string;
  /** Target sprint id, or null to send the issue back to the backlog. */
  sprintId: string | null;
}

interface AssignSprintContext {
  previous?: IssueDto[];
}

/**
 * Move an issue between the backlog and a sprint (or between sprints) by setting
 * its sprintId. Optimistically patches the cached project-issues list so the
 * planning view re-groups instantly, rolling back on error. The board is
 * invalidated on settle since the active sprint's membership may have changed.
 */
export function useAssignIssueToSprint(projectId: string) {
  const qc = useQueryClient();
  const listKey = qk.projectIssues(projectId);

  return useMutation<IssueDto, Error, AssignSprintVars, AssignSprintContext>({
    mutationFn: ({ id, sprintId }) =>
      request<IssueDto>(`/issues/${id}`, {
        method: 'PATCH',
        body: { sprintId },
      }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: listKey });
      const previous = qc.getQueryData<IssueDto[]>(listKey);
      if (previous) {
        qc.setQueryData<IssueDto[]>(
          listKey,
          previous.map((i) =>
            i.id === vars.id ? { ...i, sprintId: vars.sprintId } : i,
          ),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(listKey, ctx.previous);
    },
    onSuccess: (updated) => {
      qc.setQueryData<IssueDto[]>(listKey, (list) =>
        list
          ? list.map((i) => (i.id === updated.id ? { ...i, ...updated } : i))
          : list,
      );
      qc.setQueryData(qk.issue(updated.id), (prev: IssueDto | undefined) =>
        prev ? { ...prev, ...updated } : updated,
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: listKey });
      void qc.invalidateQueries({ queryKey: qk.board(projectId) });
    },
  });
}

export interface MoveIssueInput {
  id: string;
  statusId: string;
  beforeId?: string | null;
  afterId?: string | null;
}

interface MoveContext {
  previous?: BoardDto;
}

/**
 * Optimistic move. We immediately relocate the card in the cached board and
 * give it a provisional fractional rank computed from its new neighbors, then
 * fire the API call. On error we roll back to the snapshot; on success we keep
 * the optimistic state and let realtime / a later invalidation reconcile.
 *
 * `beforeId` = the issue that should sit directly ABOVE the dropped card.
 * `afterId`  = the issue that should sit directly BELOW the dropped card.
 *
 * Pass `boardId` (the specific board the user is looking at) to key optimistic
 * updates against `qk.boardView(boardId)`. When `boardId` is omitted the hook
 * falls back to the legacy `qk.board(projectId)` key for backward compat.
 */
export function useMoveIssue(projectId: string, boardId?: string) {
  const qc = useQueryClient();
  // Use the boardView key when a specific boardId is provided; fall back to the
  // legacy project-board key so callers that have not yet migrated continue to work.
  const boardKey = boardId ? qk.boardView(boardId) : qk.board(projectId);

  return useMutation<IssueDto, Error, MoveIssueInput, MoveContext>({
    mutationFn: ({ id, statusId, beforeId, afterId }) =>
      request<IssueDto>(`/issues/${id}/move`, {
        method: 'POST',
        body: { statusId, beforeId, afterId },
      }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: boardKey });
      const previous = qc.getQueryData<BoardDto>(boardKey);
      if (previous) {
        qc.setQueryData<BoardDto>(boardKey, applyOptimisticMove(previous, vars));
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(boardKey, ctx.previous);
    },
    onSuccess: (serverIssue) => {
      // Reconcile the moved card with the server's authoritative rank/status.
      qc.setQueryData<BoardDto>(boardKey, (board) => {
        if (!board) return board;
        return {
          ...board,
          issues: board.issues.map((i) =>
            i.id === serverIssue.id ? { ...i, ...serverIssue } : i,
          ),
        };
      });
      qc.setQueryData(qk.issue(serverIssue.id), serverIssue);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: boardKey });
    },
  });
}

function applyOptimisticMove(board: BoardDto, vars: MoveIssueInput): BoardDto {
  const before = vars.beforeId
    ? board.issues.find((i) => i.id === vars.beforeId)
    : null;
  const after = vars.afterId
    ? board.issues.find((i) => i.id === vars.afterId)
    : null;

  let rank: string;
  try {
    rank = rankBetween(before?.rank ?? null, after?.rank ?? null);
  } catch {
    // Fractional indexing throws if neighbors are equal/out of order; fall back
    // to the dragged card's existing rank so the UI doesn't blow up.
    rank = board.issues.find((i) => i.id === vars.id)?.rank ?? 'a0';
  }

  return {
    ...board,
    issues: board.issues.map((i) =>
      i.id === vars.id ? { ...i, statusId: vars.statusId, rank } : i,
    ),
  };
}

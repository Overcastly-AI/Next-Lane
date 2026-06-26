import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  rankBetween,
  type BoardDto,
  type IssueDto,
  type IssueType,
  type Priority,
} from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

export function useBoard(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.board(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () => request<BoardDto>(`/projects/${projectId}/board`),
  });
}

export function useIssue(issueId: string | undefined) {
  return useQuery({
    queryKey: qk.issue(issueId ?? ''),
    enabled: !!issueId,
    queryFn: () => request<IssueDto>(`/issues/${issueId}`),
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
}

export function useCreateIssue(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIssueInput) =>
      request<IssueDto>('/issues', { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.board(projectId) });
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
    sprintId: string | null;
    labelIds: string[];
  }>;
}

export function useUpdateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateIssueInput) =>
      request<IssueDto>(`/issues/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: (updated, vars) => {
      qc.setQueryData(qk.issue(updated.id), updated);
      void qc.invalidateQueries({ queryKey: qk.board(vars.projectId) });
    },
  });
}

export function useDeleteIssue(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/issues/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
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
 */
export function useMoveIssue(projectId: string) {
  const qc = useQueryClient();
  const boardKey = qk.board(projectId);

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

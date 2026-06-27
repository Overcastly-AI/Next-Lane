import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BoardDto, StatusCategory, StatusDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

export interface CreateStatusInput {
  name: string;
  category: StatusCategory;
  /** Optional explicit order; the server appends to the end when omitted. */
  order?: number;
}

export interface UpdateStatusInput {
  id: string;
  name?: string;
  category?: StatusCategory;
  order?: number;
}

/** Refresh both the standalone status list and the board (which renders columns). */
function invalidateStatusViews(
  qc: ReturnType<typeof useQueryClient>,
  projectId: string,
  boardId?: string,
): void {
  void qc.invalidateQueries({ queryKey: qk.statuses(projectId) });
  void qc.invalidateQueries({ queryKey: qk.board(projectId) });
  if (boardId) {
    void qc.invalidateQueries({ queryKey: qk.boardView(boardId) });
  }
}

/**
 * Create a board column (status). New columns get the next `order` from the
 * server. We optimistically insert the column into the board cache so it appears
 * immediately, then reconcile with the server response.
 *
 * Pass `boardId` to also optimistically patch the `boardView` cache (the
 * board-id-keyed view used by the multi-board page).
 */
export function useCreateStatus(projectId: string, boardId?: string) {
  const qc = useQueryClient();
  return useMutation<
    StatusDto,
    Error,
    CreateStatusInput,
    { previousBoard?: BoardDto; previousBoardView?: BoardDto }
  >({
    mutationFn: (input) =>
      request<StatusDto>(`/projects/${projectId}/statuses`, {
        method: 'POST',
        body: input,
      }),
    onMutate: async (input) => {
      const boardKey = qk.board(projectId);
      const boardViewKey = boardId ? qk.boardView(boardId) : null;

      await qc.cancelQueries({ queryKey: boardKey });
      if (boardViewKey) await qc.cancelQueries({ queryKey: boardViewKey });

      const previousBoard = qc.getQueryData<BoardDto>(boardKey);
      const previousBoardView = boardViewKey
        ? qc.getQueryData<BoardDto>(boardViewKey)
        : undefined;

      // Helper to build the optimistic status entry from the existing cache.
      const buildOptimistic = (existing: BoardDto): BoardDto => {
        const nextOrder =
          existing.statuses.reduce((max, s) => Math.max(max, s.order), -1) + 1;
        const optimistic: StatusDto = {
          id: `optimistic-${Date.now()}`,
          name: input.name,
          category: input.category,
          order: input.order ?? nextOrder,
          projectId,
        };
        return { ...existing, statuses: [...existing.statuses, optimistic] };
      };

      if (previousBoard) {
        qc.setQueryData<BoardDto>(boardKey, buildOptimistic(previousBoard));
      }
      if (boardViewKey && previousBoardView) {
        qc.setQueryData<BoardDto>(boardViewKey, buildOptimistic(previousBoardView));
      }
      return { previousBoard, previousBoardView };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previousBoard)
        qc.setQueryData(qk.board(projectId), ctx.previousBoard);
      if (boardId && ctx?.previousBoardView)
        qc.setQueryData(qk.boardView(boardId), ctx.previousBoardView);
    },
    onSettled: () => invalidateStatusViews(qc, projectId, boardId),
  });
}

/** Rename a column, change its category, or reorder it. */
export function useUpdateStatus(projectId: string, boardId?: string) {
  const qc = useQueryClient();
  return useMutation<StatusDto, Error, UpdateStatusInput>({
    mutationFn: ({ id, ...patch }) =>
      request<StatusDto>(`/statuses/${id}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: () => invalidateStatusViews(qc, projectId, boardId),
  });
}

/**
 * Delete a column. The server returns 400 when the column still has issues;
 * callers surface that as a toast. We refresh the board afterwards either way.
 */
export function useDeleteStatus(projectId: string, boardId?: string) {
  const qc = useQueryClient();
  return useMutation<{ id: string }, Error, string>({
    mutationFn: (statusId) =>
      request<{ id: string }>(`/statuses/${statusId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateStatusViews(qc, projectId, boardId),
  });
}

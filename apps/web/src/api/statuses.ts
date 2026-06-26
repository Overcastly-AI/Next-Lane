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
): void {
  void qc.invalidateQueries({ queryKey: qk.statuses(projectId) });
  void qc.invalidateQueries({ queryKey: qk.board(projectId) });
}

/**
 * Create a board column (status). New columns get the next `order` from the
 * server. We optimistically insert the column into the board cache so it appears
 * immediately, then reconcile with the server response.
 */
export function useCreateStatus(projectId: string) {
  const qc = useQueryClient();
  return useMutation<
    StatusDto,
    Error,
    CreateStatusInput,
    { previousBoard?: BoardDto }
  >({
    mutationFn: (input) =>
      request<StatusDto>(`/projects/${projectId}/statuses`, {
        method: 'POST',
        body: input,
      }),
    onMutate: async (input) => {
      const boardKey = qk.board(projectId);
      await qc.cancelQueries({ queryKey: boardKey });
      const previousBoard = qc.getQueryData<BoardDto>(boardKey);
      if (previousBoard) {
        const nextOrder =
          previousBoard.statuses.reduce((max, s) => Math.max(max, s.order), -1) +
          1;
        const optimistic: StatusDto = {
          id: `optimistic-${Date.now()}`,
          name: input.name,
          category: input.category,
          order: input.order ?? nextOrder,
          projectId,
        };
        qc.setQueryData<BoardDto>(boardKey, {
          ...previousBoard,
          statuses: [...previousBoard.statuses, optimistic],
        });
      }
      return { previousBoard };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previousBoard)
        qc.setQueryData(qk.board(projectId), ctx.previousBoard);
    },
    onSettled: () => invalidateStatusViews(qc, projectId),
  });
}

/** Rename a column, change its category, or reorder it. */
export function useUpdateStatus(projectId: string) {
  const qc = useQueryClient();
  return useMutation<StatusDto, Error, UpdateStatusInput>({
    mutationFn: ({ id, ...patch }) =>
      request<StatusDto>(`/statuses/${id}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: () => invalidateStatusViews(qc, projectId),
  });
}

/**
 * Delete a column. The server returns 400 when the column still has issues;
 * callers surface that as a toast. We refresh the board afterwards either way.
 */
export function useDeleteStatus(projectId: string) {
  const qc = useQueryClient();
  return useMutation<{ id: string }, Error, string>({
    mutationFn: (statusId) =>
      request<{ id: string }>(`/statuses/${statusId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateStatusViews(qc, projectId),
  });
}

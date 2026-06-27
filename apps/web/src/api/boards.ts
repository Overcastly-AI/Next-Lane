import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type BoardDto,
  type BoardSummaryDto,
  type BoardType,
  type BoardColorRule,
} from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Fetch the default board for a project. Used as the initial load when the
 * user first navigates to /projects/:id/board — same as the legacy endpoint so
 * older code that still calls GET /projects/:id/board continues to work.
 */
export function useBoardDefault(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.board(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () => request<BoardDto>(`/projects/${projectId}/board`),
  });
}

/**
 * Fetch the list of boards (summaries) for a project. Used by the board
 * switcher to enumerate available boards and select the default.
 */
export function useBoards(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.boards(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () =>
      request<BoardSummaryDto[]>(`/projects/${projectId}/boards`),
  });
}

/**
 * Fetch the full board view for a specific board id. This is the canonical
 * hook for the board page once a boardId is resolved. The query key is keyed
 * by boardId so each board has its own cache entry.
 */
export function useBoardView(boardId: string | undefined) {
  return useQuery({
    queryKey: qk.boardView(boardId ?? ''),
    enabled: !!boardId,
    queryFn: () => request<BoardDto>(`/boards/${boardId}`),
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface CreateBoardInput {
  name: string;
  type: BoardType;
}

/**
 * Create a new board for a project. Invalidates the boards list so the
 * switcher reflects the new entry immediately.
 */
export function useCreateBoard(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBoardInput) =>
      request<BoardSummaryDto>(`/projects/${projectId}/boards`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.boards(projectId) });
    },
  });
}

export interface UpdateBoardInput {
  name?: string;
  type?: BoardType;
  filterQuery?: string | null;
  colorRules?: BoardColorRule[];
}

/**
 * Rename a board, change its type, or update its filter/color rules.
 * Optimistically patches the boards list and invalidates on settle.
 */
export function useUpdateBoard(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      boardId,
      patch,
    }: {
      boardId: string;
      patch: UpdateBoardInput;
    }) =>
      request<BoardSummaryDto>(`/boards/${boardId}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: (updated) => {
      // Patch the boards list so the switcher reflects the new name/type
      // without waiting for a refetch.
      qc.setQueryData<BoardSummaryDto[]>(qk.boards(projectId), (list) =>
        list
          ? list.map((b) => (b.id === updated.id ? { ...b, ...updated } : b))
          : list,
      );
      // Patch the boardView cache if it is loaded (the board field inside BoardDto).
      qc.setQueryData<BoardDto>(qk.boardView(updated.id), (view) =>
        view ? { ...view, board: updated } : view,
      );
      void qc.invalidateQueries({ queryKey: qk.boards(projectId) });
      void qc.invalidateQueries({ queryKey: qk.boardView(updated.id) });
    },
  });
}

/**
 * Delete a board. The backend refuses to delete the last/default board with a
 * 4xx; callers should surface that as a toast. Invalidates the boards list so
 * the switcher updates and the caller can fall back to the default board.
 */
export function useDeleteBoard(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (boardId: string) =>
      request<void>(`/boards/${boardId}`, { method: 'DELETE' }),
    onSuccess: (_data, boardId) => {
      void qc.invalidateQueries({ queryKey: qk.boards(projectId) });
      // Remove the stale board view entry from the cache.
      qc.removeQueries({ queryKey: qk.boardView(boardId) });
    },
  });
}

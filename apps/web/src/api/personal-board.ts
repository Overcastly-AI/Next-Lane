import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './client';

// ---------------------------------------------------------------------------
// DTO types (mirror the backend contract; shared package has no personal-board
// types yet so we define them here, keeping them strict).
// ---------------------------------------------------------------------------

export interface PersonalCardDto {
  id: string;
  columnId: string;
  title: string;
  notes: string | null;
  rank: string;
  promotedIssueId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalColumnDto {
  id: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  cards?: PersonalCardDto[];
}

export interface PromoteResult {
  card: PersonalCardDto;
  issue: { id: string; key: string; projectId: string };
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const personalBoardQk = {
  board: ['personalBoard'] as const,
} as const;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Fetch the personal board (all columns + cards). Lazily creates the default
 * To Do / Doing / Done columns on first call (backend handles this).
 */
export function usePersonalBoard() {
  return useQuery({
    queryKey: personalBoardQk.board,
    queryFn: () => request<PersonalColumnDto[]>('/me/personal-board'),
    staleTime: 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Column mutations
// ---------------------------------------------------------------------------

export function useCreatePersonalColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) =>
      request<PersonalColumnDto>('/me/personal-columns', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: personalBoardQk.board });
    },
  });
}

export function useUpdatePersonalColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: { name?: string; order?: number };
    }) =>
      request<PersonalColumnDto>(`/me/personal-columns/${id}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: personalBoardQk.board });
    },
  });
}

export function useDeletePersonalColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/me/personal-columns/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: personalBoardQk.board });
    },
  });
}

// ---------------------------------------------------------------------------
// Card mutations
// ---------------------------------------------------------------------------

export function useCreatePersonalCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { columnId: string; title: string; notes?: string }) =>
      request<PersonalCardDto>('/me/personal-cards', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: personalBoardQk.board });
    },
  });
}

export interface UpdatePersonalCardInput {
  title?: string;
  notes?: string | null;
  columnId?: string;
  beforeId?: string | null;
  afterId?: string | null;
}

/**
 * Update a card's content and/or position. The backend uses beforeId/afterId
 * to compute the fractional rank when moving between or within columns.
 */
export function useUpdatePersonalCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdatePersonalCardInput }) =>
      request<PersonalCardDto>(`/me/personal-cards/${id}`, {
        method: 'PATCH',
        body: patch,
      }),
    onMutate: async ({ id, patch }) => {
      // Optimistic update for move operations so the UI responds instantly.
      await qc.cancelQueries({ queryKey: personalBoardQk.board });
      const previous = qc.getQueryData<PersonalColumnDto[]>(
        personalBoardQk.board,
      );
      if (previous && patch.columnId !== undefined) {
        const updated = previous.map((col) => ({
          ...col,
          cards: (col.cards ?? []).map((c) =>
            c.id === id ? { ...c, ...patch } : c,
          ),
        }));
        qc.setQueryData(personalBoardQk.board, updated);
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(personalBoardQk.board, ctx.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: personalBoardQk.board });
    },
  });
}

export function useDeletePersonalCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/me/personal-cards/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: personalBoardQk.board });
      const previous = qc.getQueryData<PersonalColumnDto[]>(
        personalBoardQk.board,
      );
      if (previous) {
        const updated = previous.map((col) => ({
          ...col,
          cards: (col.cards ?? []).filter((c) => c.id !== id),
        }));
        qc.setQueryData(personalBoardQk.board, updated);
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(personalBoardQk.board, ctx.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: personalBoardQk.board });
    },
  });
}

export function usePromotePersonalCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
      request<PromoteResult>(`/me/personal-cards/${id}/promote`, {
        method: 'POST',
        body: { projectId },
      }),
    onSuccess: () => {
      // Card gets a promotedIssueId — refresh the board so the badge appears.
      void qc.invalidateQueries({ queryKey: personalBoardQk.board });
    },
  });
}

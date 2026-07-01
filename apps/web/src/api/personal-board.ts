import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rankAfter, rankBetween } from '@next-lane/shared';
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
  /** Optional hex accent color (#rrggbb); null when unset. */
  color: string | null;
  /** Optional due date (ISO 8601); null when unset. */
  dueDate: string | null;
  rank: string;
  promotedIssueId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalColumnDto {
  id: string;
  name: string;
  order: number;
  /** Optional hex accent color for the column header/border; null when unset. */
  color: string | null;
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
    mutationFn: (input: { name: string; color?: string | null }) =>
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
      patch: { name?: string; order?: number; color?: string | null };
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

/** Reorder all of the caller's columns to match the given left-to-right ids. */
export function useReorderPersonalColumns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) =>
      request<PersonalColumnDto[]>('/me/personal-columns/reorder', {
        method: 'PATCH',
        body: { orderedIds },
      }),
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey: personalBoardQk.board });
      const previous = qc.getQueryData<PersonalColumnDto[]>(
        personalBoardQk.board,
      );
      if (previous) {
        const byId = new Map(previous.map((c) => [c.id, c]));
        const reordered = orderedIds
          .map((id, i) => {
            const col = byId.get(id);
            return col ? { ...col, order: i } : undefined;
          })
          .filter((c): c is PersonalColumnDto => c !== undefined);
        qc.setQueryData(personalBoardQk.board, reordered);
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(personalBoardQk.board, ctx.previous);
    },
    onSettled: () => {
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
    mutationFn: (input: {
      columnId: string;
      title: string;
      notes?: string;
      color?: string | null;
      dueDate?: string | null;
    }) =>
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
  color?: string | null;
  dueDate?: string | null;
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
      // Optimistic update so the UI responds instantly. For a move we mirror the
      // server exactly: pull the card out of its column, compute a fractional
      // rank between the target neighbors, and drop it into the target column —
      // the board renders cards sorted by rank, so this reflects the new order
      // without a snap-back before the refetch confirms it.
      await qc.cancelQueries({ queryKey: personalBoardQk.board });
      const previous = qc.getQueryData<PersonalColumnDto[]>(
        personalBoardQk.board,
      );
      if (!previous) return { previous };

      const isMove =
        patch.columnId !== undefined ||
        patch.beforeId !== undefined ||
        patch.afterId !== undefined;

      const dragged = previous
        .flatMap((col) => col.cards ?? [])
        .find((c) => c.id === id);

      if (isMove && dragged) {
        const targetColumnId = patch.columnId ?? dragged.columnId;
        const byRank = (a: PersonalCardDto, b: PersonalCardDto) =>
          a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
        const targetCards = (
          previous.find((c) => c.id === targetColumnId)?.cards ?? []
        )
          .filter((c) => c.id !== id)
          .slice()
          .sort(byRank);

        const beforeRank = patch.beforeId
          ? (targetCards.find((c) => c.id === patch.beforeId)?.rank ?? null)
          : null;
        const afterRank = patch.afterId
          ? (targetCards.find((c) => c.id === patch.afterId)?.rank ?? null)
          : null;

        const newRank =
          !patch.beforeId && !patch.afterId
            ? rankAfter(targetCards[targetCards.length - 1]?.rank ?? null)
            : rankBetween(beforeRank, afterRank);

        const moved: PersonalCardDto = {
          ...dragged,
          columnId: targetColumnId,
          rank: newRank,
        };
        const updated = previous.map((col) => {
          const cards = (col.cards ?? []).filter((c) => c.id !== id);
          return {
            ...col,
            cards: col.id === targetColumnId ? [...cards, moved] : cards,
          };
        });
        qc.setQueryData(personalBoardQk.board, updated);
      } else if (dragged) {
        // Content-only edit (title/notes/color/dueDate): patch in place.
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

/**
 * Checklist API hooks.
 *
 * The issue's embedded `checklist` array (and `checklistProgress`) comes back
 * on every `GET /issues/:id` call (via `listInclude`). We therefore rely on the
 * issue query as the source of truth and only need mutations here. Each mutation
 * invalidates `qk.issue(issueId)` so the embedded list refreshes.
 *
 * A lightweight standalone GET hook (`useChecklist`) is also exported for
 * components that need the list without opening the full issue drawer (unused in
 * v1 but exported for completeness).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChecklistItemDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

// ---------------------------------------------------------------------------
// Standalone list query (optional — drawer reads from issue.checklist instead)
// ---------------------------------------------------------------------------

export function useChecklist(issueId: string | undefined) {
  return useQuery({
    queryKey: qk.checklist(issueId ?? ''),
    enabled: !!issueId,
    queryFn: () =>
      request<ChecklistItemDto[]>(`/issues/${issueId}/checklist`),
  });
}

// ---------------------------------------------------------------------------
// Add item
// ---------------------------------------------------------------------------

export function useAddChecklistItem(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      request<ChecklistItemDto>(`/issues/${issueId}/checklist`, {
        method: 'POST',
        body: { text },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.issue(issueId) });
      void qc.invalidateQueries({ queryKey: qk.checklist(issueId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Update item (toggle done, edit text)
// ---------------------------------------------------------------------------

export interface UpdateChecklistItemInput {
  id: string;
  text?: string;
  done?: boolean;
  order?: number;
}

export function useUpdateChecklistItem(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: UpdateChecklistItemInput) =>
      request<ChecklistItemDto>(`/checklist/${id}`, {
        method: 'PATCH',
        body: patch,
      }),
    // Optimistic update — flip done flag immediately.
    onMutate: async ({ done }) => {
      if (done === undefined) return;
      await qc.cancelQueries({ queryKey: qk.issue(issueId) });
      // We don't mutate the full issue shape here (it's complex); the
      // invalidate below will re-fetch. Optimistic UI is handled at the
      // component level via local `pending` state.
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.issue(issueId) });
      void qc.invalidateQueries({ queryKey: qk.checklist(issueId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Delete item
// ---------------------------------------------------------------------------

export function useDeleteChecklistItem(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      request<void>(`/checklist/${itemId}`, { method: 'DELETE' }),
    // Optimistic removal from the issue cache.
    onMutate: async (itemId) => {
      await qc.cancelQueries({ queryKey: qk.issue(issueId) });
      const previous = qc.getQueryData(qk.issue(issueId));
      qc.setQueryData<{ checklist?: ChecklistItemDto[] }>(
        qk.issue(issueId),
        (prev) => {
          if (!prev?.checklist) return prev;
          const checklist = prev.checklist.filter((i) => i.id !== itemId);
          const done = checklist.filter((i) => i.done).length;
          return {
            ...prev,
            checklist,
            checklistProgress: { done, total: checklist.length },
          };
        },
      );
      return { previous };
    },
    onError: (_err, _itemId, context) => {
      if (context?.previous) {
        qc.setQueryData(qk.issue(issueId), context.previous);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.issue(issueId) });
      void qc.invalidateQueries({ queryKey: qk.checklist(issueId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Reorder items
// ---------------------------------------------------------------------------

export function useReorderChecklist(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemIds: string[]) =>
      request<void>(`/issues/${issueId}/checklist/reorder`, {
        method: 'PUT',
        body: { itemIds },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.issue(issueId) });
      void qc.invalidateQueries({ queryKey: qk.checklist(issueId) });
    },
  });
}

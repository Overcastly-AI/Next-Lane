/**
 * WorkLog API hooks.
 *
 * Covers the full CRUD surface for time-tracking worklogs:
 *   GET  /issues/:issueId/worklogs  — list (VIEWER+)
 *   POST /issues/:issueId/worklogs  — add   (MEMBER+)
 *   PATCH /worklogs/:id             — edit  (author or project ADMIN)
 *   DELETE /worklogs/:id            — remove (author or project ADMIN; 204)
 *
 * On every successful mutation we invalidate both the worklogs list and the
 * parent issue query so the timeSpentMinutes rollup is always fresh.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkLogDto, CreateWorkLogDto, UpdateWorkLogDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

// ---------------------------------------------------------------------------
// List query
// ---------------------------------------------------------------------------

export function useWorkLogs(issueId: string | undefined) {
  return useQuery({
    queryKey: qk.worklogs(issueId ?? ''),
    enabled: !!issueId,
    queryFn: () =>
      request<WorkLogDto[]>(`/issues/${issueId}/worklogs`),
  });
}

// ---------------------------------------------------------------------------
// Add a worklog
// ---------------------------------------------------------------------------

export function useAddWorkLog(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateWorkLogDto) =>
      request<WorkLogDto>(`/issues/${issueId}/worklogs`, {
        method: 'POST',
        body: dto,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.worklogs(issueId) });
      void qc.invalidateQueries({ queryKey: qk.issue(issueId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Update a worklog (author or admin)
// ---------------------------------------------------------------------------

export interface UpdateWorkLogInput extends UpdateWorkLogDto {
  id: string;
}

export function useUpdateWorkLog(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: UpdateWorkLogInput) =>
      request<WorkLogDto>(`/worklogs/${id}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.worklogs(issueId) });
      void qc.invalidateQueries({ queryKey: qk.issue(issueId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Delete a worklog (author or admin; server returns 204)
// ---------------------------------------------------------------------------

export function useDeleteWorkLog(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workLogId: string) =>
      request<void>(`/worklogs/${workLogId}`, { method: 'DELETE' }),
    // Optimistic removal from the list cache.
    onMutate: async (workLogId) => {
      await qc.cancelQueries({ queryKey: qk.worklogs(issueId) });
      const previous = qc.getQueryData<WorkLogDto[]>(qk.worklogs(issueId));
      qc.setQueryData<WorkLogDto[]>(qk.worklogs(issueId), (prev) =>
        prev ? prev.filter((w) => w.id !== workLogId) : prev,
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(qk.worklogs(issueId), ctx.previous);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.worklogs(issueId) });
      void qc.invalidateQueries({ queryKey: qk.issue(issueId) });
    },
  });
}

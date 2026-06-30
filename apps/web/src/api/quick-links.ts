/**
 * Quick Links — personal shortcuts stored server-side.
 *
 * GET  /me/quick-links        → QuickLinkDto[]
 * POST /me/quick-links        → QuickLinkDto (201)
 * PATCH /me/quick-links/:id   → QuickLinkDto
 * DELETE /me/quick-links/:id  → { id }
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QuickLinkDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

export function useQuickLinks() {
  return useQuery({
    queryKey: qk.quickLinks,
    queryFn: () => request<QuickLinkDto[]>('/me/quick-links'),
  });
}

export interface CreateQuickLinkInput {
  label: string;
  url: string;
}

export function useCreateQuickLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateQuickLinkInput) =>
      request<QuickLinkDto>('/me/quick-links', { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.quickLinks });
    },
  });
}

export interface UpdateQuickLinkInput {
  label?: string;
  url?: string;
  order?: number;
}

export function useUpdateQuickLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateQuickLinkInput & { id: string }) =>
      request<QuickLinkDto>(`/me/quick-links/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.quickLinks });
    },
  });
}

export function useDeleteQuickLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<{ id: string }>(`/me/quick-links/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.quickLinks });
    },
  });
}

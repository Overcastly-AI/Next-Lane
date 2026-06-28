import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SavedFilterDto } from '@next-lane/shared';
import { request } from './client';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const savedFilterKeys = {
  list: (projectId: string) => ['savedFilters', projectId] as const,
};

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

export interface CreateSavedFilterInput {
  name: string;
  query: string;
  shared?: boolean;
}

export interface UpdateSavedFilterInput {
  name?: string;
  query?: string;
  shared?: boolean;
}

// ---------------------------------------------------------------------------
// Query hook
// ---------------------------------------------------------------------------

/**
 * Fetch saved filters for a project: the caller's own plus any project-shared
 * ones from other members.
 */
export function useSavedFilters(projectId: string | undefined) {
  return useQuery({
    queryKey: savedFilterKeys.list(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () =>
      request<SavedFilterDto[]>(`/projects/${projectId}/saved-filters`),
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/** Create a new saved filter in a project. */
export function useCreateSavedFilter(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSavedFilterInput) =>
      request<SavedFilterDto>(`/projects/${projectId}/saved-filters`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: savedFilterKeys.list(projectId),
      });
    },
  });
}

/** Update a saved filter (owner only — name, query, shared). */
export function useUpdateSavedFilter(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: UpdateSavedFilterInput;
    }) =>
      request<SavedFilterDto>(`/saved-filters/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: savedFilterKeys.list(projectId),
      });
    },
  });
}

/** Delete a saved filter (owner only). */
export function useDeleteSavedFilter(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/saved-filters/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: savedFilterKeys.list(projectId),
      });
    },
  });
}

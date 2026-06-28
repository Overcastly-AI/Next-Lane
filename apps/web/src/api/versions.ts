import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  VersionDto,
  CreateVersionDto,
  UpdateVersionDto,
} from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

/** Fetch all versions for a project, ordered by createdAt ascending (server-side). */
export function useVersions(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.versions(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () =>
      request<VersionDto[]>(`/projects/${projectId}/versions`),
  });
}

/** Create a new project version (ADMIN only). */
export function useCreateVersion(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateVersionDto) =>
      request<VersionDto>(`/projects/${projectId}/versions`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.versions(projectId) });
    },
  });
}

/** Update an existing version's name, description, releaseDate, or state (ADMIN only). */
export function useUpdateVersion(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateVersionDto }) =>
      request<VersionDto>(`/versions/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.versions(projectId) });
    },
  });
}

/** Delete a version (ADMIN only). Server returns 204; IssueVersion join rows cascade. */
export function useDeleteVersion(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/versions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.versions(projectId) });
    },
  });
}

/**
 * Atomically replace the full set of versions assigned to an issue.
 * Calls PUT /issues/:issueId/versions { versionIds } and invalidates issue + board caches.
 */
export function useSetIssueVersions(
  issueId: string,
  projectId: string,
  boardId?: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionIds: string[]) =>
      request<void>(`/issues/${issueId}/versions`, {
        method: 'PUT',
        body: { versionIds },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.issue(issueId) });
      void qc.invalidateQueries({ queryKey: qk.board(projectId) });
      if (boardId) {
        void qc.invalidateQueries({ queryKey: qk.boardView(boardId) });
      }
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Role, type ProjectMemberDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

/**
 * A project's EFFECTIVE members: every member of the project's workspace,
 * annotated with their effective role and whether it comes from a
 * per-project `ProjectMembership` override. Any workspace member (read
 * access) may fetch this — used by the Settings → Members section.
 */
export function useProjectMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.projectMembers(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () => request<ProjectMemberDto[]>(`/projects/${projectId}/members`),
  });
}

/**
 * Set (create or replace) a project-scoped role override for `userId`.
 * Requires the caller to hold EFFECTIVE project ADMIN (a project-level
 * override can itself grant this, not just workspace ADMIN). The server
 * refuses (400) to override a workspace ADMIN — always full access.
 */
export function useSetProjectRoleOverride(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      request<ProjectMemberDto>(`/projects/${projectId}/members/${userId}/role`, {
        method: 'PUT',
        body: { role },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.projectMembers(projectId) });
    },
  });
}

/**
 * Clear a project-scoped role override, reverting `userId` back to
 * inheriting their workspace role for this project. Requires EFFECTIVE
 * project ADMIN.
 */
export function useClearProjectRoleOverride(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      request<ProjectMemberDto>(`/projects/${projectId}/members/${userId}/role`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.projectMembers(projectId) });
    },
  });
}

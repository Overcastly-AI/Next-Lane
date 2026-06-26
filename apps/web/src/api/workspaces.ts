import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MembershipDto, Role, WorkspaceDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';
import { useAuth } from '@/auth/AuthContext';

export function useWorkspaces() {
  return useQuery({
    queryKey: qk.workspaces,
    queryFn: () => request<WorkspaceDto[]>('/workspaces'),
  });
}

export function useWorkspaceMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: qk.workspaceMembers(workspaceId ?? ''),
    enabled: !!workspaceId,
    queryFn: () =>
      request<MembershipDto[]>(`/workspaces/${workspaceId}/members`),
  });
}

/**
 * The current user's role in the given workspace, derived from the membership
 * list (any member, including a VIEWER, may read it). Returns `null` while the
 * role is unknown (no workspaceId yet, still loading, or not a member) so
 * callers can treat "unknown" distinctly from an explicit VIEWER.
 */
export function useMyRole(workspaceId: string | undefined): Role | null {
  const { user } = useAuth();
  const membersQuery = useWorkspaceMembers(workspaceId);
  if (!user) return null;
  return (
    membersQuery.data?.find((m) => m.user.id === user.id)?.role ?? null
  );
}

export interface CreateWorkspaceInput {
  name: string;
  slug?: string;
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkspaceInput) =>
      request<WorkspaceDto>('/workspaces', { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.workspaces });
    },
  });
}

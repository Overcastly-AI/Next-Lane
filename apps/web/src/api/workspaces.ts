import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MembershipDto, Role, WorkspaceDto } from '@next-lane/shared';
import { request, getToken, API_URL } from './client';
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

// ── Branding mutations ────────────────────────────────────────────────────────

export interface UpdateWorkspaceBrandingInput {
  name?: string;
  brandColor?: string | null;
}

/**
 * PATCH /workspaces/:id — update name and/or brandColor.
 * Admin-only. Invalidates the workspaces list so the header + theme update.
 */
export function useUpdateWorkspaceBranding(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateWorkspaceBrandingInput) =>
      request<WorkspaceDto>(`/workspaces/${workspaceId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.workspaces });
    },
  });
}

/**
 * POST /workspaces/:id/logo (multipart) — upload a new workspace logo.
 * Admin-only. Uses fetch directly for multipart/form-data.
 * Invalidates the workspaces list so the header updates.
 */
export function useUploadWorkspaceLogo(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<WorkspaceDto> => {
      const formData = new FormData();
      formData.append('file', file);
      const token = getToken();
      const res = await fetch(`${API_URL}/api/workspaces/${workspaceId}/logo`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const text = await res.text();
      let data: unknown = null;
      if (text) {
        try { data = JSON.parse(text); } catch { data = text; }
      }
      if (!res.ok) {
        const msg =
          (data && typeof data === 'object' && 'message' in data
            ? String((data as { message: unknown }).message)
            : null) ?? `Upload failed (${res.status})`;
        throw new Error(msg);
      }
      return data as WorkspaceDto;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.workspaces });
    },
  });
}

/**
 * DELETE /workspaces/:id/logo — remove the workspace logo.
 * Admin-only. Invalidates the workspaces list.
 */
export function useDeleteWorkspaceLogo(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<WorkspaceDto>(`/workspaces/${workspaceId}/logo`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.workspaces });
    },
  });
}

/**
 * POST /workspaces/:id/members — invite by email or change an existing member's
 * role (the backend upserts). Admin-only.
 * Invalidates the membership list so the page reflects the change immediately.
 */
export interface AddMemberInput {
  email: string;
  role?: Role;
}

export function useAddMember(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddMemberInput) =>
      request<MembershipDto>(`/workspaces/${workspaceId}/members`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: qk.workspaceMembers(workspaceId),
      });
    },
  });
}

/**
 * DELETE /workspaces/:id — permanently removes the workspace and all its
 * contents. Admin-only. Invalidates the workspaces list.
 */
export function useDeleteWorkspace(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<{ id: string }>(`/workspaces/${workspaceId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.workspaces });
    },
  });
}

/**
 * Remove a workspace member by membershipId.
 * Only available to ADMINs; the server rejects any attempt that would leave the
 * workspace with no administrators (returns 400/403 surfaced as a toast).
 */
export function useRemoveMember(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) =>
      request<void>(`/workspaces/${workspaceId}/members/${membershipId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: qk.workspaceMembers(workspaceId),
      });
    },
  });
}

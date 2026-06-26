import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkspaceDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

export function useWorkspaces() {
  return useQuery({
    queryKey: qk.workspaces,
    queryFn: () => request<WorkspaceDto[]>('/workspaces'),
  });
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

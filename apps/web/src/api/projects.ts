import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

export function useProjects(workspaceId: string | undefined) {
  return useQuery({
    queryKey: qk.projects(workspaceId ?? ''),
    enabled: !!workspaceId,
    queryFn: () =>
      request<ProjectDto[]>(`/projects?workspaceId=${workspaceId}`),
  });
}

export interface CreateProjectInput {
  workspaceId: string;
  key: string;
  name: string;
  description?: string;
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      request<ProjectDto>(`/projects`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: (project) => {
      void qc.invalidateQueries({
        queryKey: qk.projects(project.workspaceId),
      });
    },
  });
}

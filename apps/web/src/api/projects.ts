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

/** Fetch a single project (used by the project settings page). */
export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.project(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () => request<ProjectDto>(`/projects/${projectId}`),
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

export interface UpdateProjectInput {
  /** The project key is immutable, so only name/description are editable. */
  name?: string;
  description?: string;
}

/**
 * Update a project's name/description. Refreshes the single-project cache, the
 * workspace project list, and the board (its header shows the project name).
 */
export function useUpdateProject(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectInput) =>
      request<ProjectDto>(`/projects/${projectId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: (project) => {
      qc.setQueryData(qk.project(projectId), project);
      void qc.invalidateQueries({ queryKey: qk.projects(project.workspaceId) });
      void qc.invalidateQueries({ queryKey: qk.board(projectId) });
    },
  });
}

/** Archive a project (soft delete). ADMIN only on the server. */
export function useArchiveProject(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<ProjectDto>(`/projects/${projectId}`, { method: 'DELETE' }),
    onSuccess: (project) => {
      qc.setQueryData(qk.project(projectId), project);
      void qc.invalidateQueries({ queryKey: qk.projects(project.workspaceId) });
    },
  });
}

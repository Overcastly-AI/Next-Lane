import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SprintDto, SprintState } from '@next-lane/shared';
import { request } from './client';
import { qk, invalidateBoardFamily } from './keys';

export interface CreateSprintInput {
  name: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
}

export function useCreateSprint(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSprintInput) =>
      request<SprintDto>(`/projects/${projectId}/sprints`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.sprints(projectId) });
    },
  });
}

export interface UpdateSprintInput {
  id: string;
  patch: Partial<{
    name: string;
    goal: string | null;
    state: SprintState;
    startDate: string | null;
    endDate: string | null;
  }>;
}

export function useUpdateSprint(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSprintInput) =>
      request<SprintDto>(`/sprints/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () => {
      // A lifecycle change (start/complete) can move issues in/out of the active
      // sprint, so refresh both the sprint list, the project issues, and the board.
      void qc.invalidateQueries({ queryKey: qk.sprints(projectId) });
      void qc.invalidateQueries({ queryKey: qk.projectIssues(projectId) });
      invalidateBoardFamily(qc, projectId);
    },
  });
}

export function useDeleteSprint(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<{ id: string }>(`/sprints/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.sprints(projectId) });
      void qc.invalidateQueries({ queryKey: qk.projectIssues(projectId) });
      invalidateBoardFamily(qc, projectId);
    },
  });
}

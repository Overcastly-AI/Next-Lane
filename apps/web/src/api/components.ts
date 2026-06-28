import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ComponentDto, CreateComponentDto, UpdateComponentDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

/** Fetch all components for a project, ordered by name ascending (server-side). */
export function useComponents(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.components(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () =>
      request<ComponentDto[]>(`/projects/${projectId}/components`),
  });
}

/** Create a new project component (ADMIN only). */
export function useCreateComponent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateComponentDto) =>
      request<ComponentDto>(`/projects/${projectId}/components`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.components(projectId) });
    },
  });
}

/** Update an existing component's name, description, or defaultAssigneeId (ADMIN only). */
export function useUpdateComponent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateComponentDto }) =>
      request<ComponentDto>(`/components/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.components(projectId) });
    },
  });
}

/** Delete a component (ADMIN only). Server returns 204; issues become componentId=null. */
export function useDeleteComponent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/components/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.components(projectId) });
    },
  });
}

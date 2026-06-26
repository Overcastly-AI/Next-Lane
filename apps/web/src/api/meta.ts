import { useQuery } from '@tanstack/react-query';
import type {
  UserDto,
  StatusDto,
  SprintDto,
  LabelDto,
} from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

export function useUsers() {
  return useQuery({
    queryKey: qk.users,
    queryFn: () => request<UserDto[]>('/users'),
  });
}

export function useStatuses(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.statuses(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () =>
      request<StatusDto[]>(`/projects/${projectId}/statuses`),
  });
}

export function useSprints(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.sprints(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () => request<SprintDto[]>(`/projects/${projectId}/sprints`),
  });
}

export function useLabels(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.labels(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () => request<LabelDto[]>(`/projects/${projectId}/labels`),
  });
}

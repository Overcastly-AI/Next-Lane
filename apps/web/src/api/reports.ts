import { useQuery } from '@tanstack/react-query';
import type { VelocityPointDto, BurndownDto, CfdDto } from '@next-lane/shared';
import { request } from './client';

/** Velocity per active/completed sprint for a project. */
export function useVelocity(projectId: string | undefined) {
  return useQuery({
    queryKey: ['reports', 'velocity', projectId ?? ''],
    enabled: !!projectId,
    queryFn: () =>
      request<VelocityPointDto[]>(`/projects/${projectId}/reports/velocity`),
  });
}

/** Burndown series for a single sprint. */
export function useBurndown(
  projectId: string | undefined,
  sprintId: string | undefined,
) {
  return useQuery({
    queryKey: ['reports', 'burndown', projectId ?? '', sprintId ?? ''],
    enabled: !!projectId && !!sprintId,
    queryFn: () =>
      request<BurndownDto>(
        `/projects/${projectId}/sprints/${sprintId}/burndown`,
      ),
  });
}

/** Cumulative Flow Diagram: per-day issue counts per status category. */
export function useCfd(
  projectId: string | undefined,
  days: number = 30,
) {
  return useQuery({
    queryKey: ['reports', 'cfd', projectId ?? '', days],
    enabled: !!projectId,
    queryFn: () =>
      request<CfdDto>(`/projects/${projectId}/reports/cfd?days=${days}`),
  });
}

import { useQuery } from '@tanstack/react-query';
import type {
  PersonalAnalyticsDto,
  ProjectAnalyticsDto,
} from '@next-lane/shared';
import { request } from './client';

/** Query-key factory kept alongside the hooks so callers can invalidate cleanly. */
export const analyticsKeys = {
  personal: (days: number) => ['analytics', 'personal', days] as const,
  project: (projectId: string, days: number) =>
    ['analytics', 'project', projectId, days] as const,
};

/**
 * Personal analytics for the signed-in user over a rolling `days` window.
 * Fetches from `GET /me/analytics?days=N`.
 */
export function usePersonalAnalytics(days: number) {
  return useQuery({
    queryKey: analyticsKeys.personal(days),
    queryFn: () =>
      request<PersonalAnalyticsDto>(`/me/analytics?days=${days}`),
    staleTime: 60 * 1000,
  });
}

/**
 * Team/project analytics for a project over a rolling `days` window.
 * Fetches from `GET /projects/:projectId/analytics?days=N`.
 */
export function useProjectAnalytics(
  projectId: string | undefined,
  days: number,
) {
  return useQuery({
    queryKey: analyticsKeys.project(projectId ?? '', days),
    enabled: !!projectId,
    queryFn: () =>
      request<ProjectAnalyticsDto>(
        `/projects/${projectId}/analytics?days=${days}`,
      ),
    staleTime: 60 * 1000,
  });
}

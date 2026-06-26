import { useQuery } from '@tanstack/react-query';
import type { RoadmapDto } from '@next-lane/shared';
import { request } from './client';

/**
 * Roadmap timeline payload for a project: epics (with derived windows +
 * progress) and dated sprints, composed server-side so the client just renders.
 */
export function useRoadmap(projectId: string | undefined) {
  return useQuery({
    queryKey: ['roadmap', projectId ?? ''],
    enabled: !!projectId,
    queryFn: () => request<RoadmapDto>(`/projects/${projectId}/roadmap`),
  });
}

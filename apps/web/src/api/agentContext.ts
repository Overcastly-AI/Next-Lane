import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectAgentContextDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

/**
 * A project's agent-context handoff document — persistent memory that AI
 * agents (over MCP) and humans share to hand off working context between
 * sessions. Never 404s; an unconfigured project returns an empty document.
 * Any project member (VIEWER+) may read it.
 */
export function useAgentContext(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.projectAgentContext(projectId ?? ''),
    queryFn: () =>
      request<ProjectAgentContextDto>(`/projects/${projectId}/agent-context`),
    enabled: !!projectId,
  });
}

/**
 * Replace the project's agent-context document (full content replace, not a
 * merge). Requires effective project MEMBER+ on the server (403 otherwise);
 * a too-large document 400s with an exact "must not exceed 64 KB" message.
 */
export function useUpdateAgentContext(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      request<ProjectAgentContextDto>(`/projects/${projectId}/agent-context`, {
        method: 'PUT',
        body: { content },
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.projectAgentContext(projectId) });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GiteaIntegrationDto, IssueGiteaLinkDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

/** Query key for the Gitea integration config (settings-only; no realtime invalidation). */
export const giteaKeys = {
  integration: (projectId: string) => ['giteaIntegration', projectId] as const,
};

export interface UpsertGiteaIntegrationInput {
  giteaBaseUrl: string;
  repoFullName: string;
  token: string;
}

/** The project's Gitea integration config. `null` when not configured. Any project member may read it. */
export function useGiteaIntegration(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: giteaKeys.integration(projectId ?? ''),
    queryFn: () =>
      request<GiteaIntegrationDto | null>(`/projects/${projectId}/gitea`),
    enabled: enabled && !!projectId,
  });
}

/** Create or replace the project's Gitea integration config. ADMIN-only on the server. */
export function useUpsertGiteaIntegration(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertGiteaIntegrationInput) =>
      request<GiteaIntegrationDto>(`/projects/${projectId}/gitea`, {
        method: 'PUT',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: giteaKeys.integration(projectId) });
    },
  });
}

/** Remove the project's Gitea integration config. ADMIN-only on the server. */
export function useDeleteGiteaIntegration(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<{ ok: true }>(`/projects/${projectId}/gitea`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: giteaKeys.integration(projectId) });
    },
  });
}

/** Linked Gitea PRs/commits/branches for a single issue. */
export function useIssueGiteaLinks(issueId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.giteaLinks(issueId ?? ''),
    queryFn: () => request<IssueGiteaLinkDto[]>(`/issues/${issueId}/gitea-links`),
    enabled: enabled && !!issueId,
  });
}

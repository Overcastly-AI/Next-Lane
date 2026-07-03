import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GitlabIntegrationDto, IssueGitlabLinkDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

/** Query key for the GitLab integration config (settings-only; no realtime invalidation). */
export const gitlabKeys = {
  integration: (projectId: string) => ['gitlabIntegration', projectId] as const,
};

export interface UpsertGitlabIntegrationInput {
  projectPath: string;
  /** Optional — server defaults to "https://gitlab.com" when omitted. */
  gitlabBaseUrl?: string;
  token: string;
}

/** The project's GitLab integration config. `null` when not configured. Any project member may read it. */
export function useGitlabIntegration(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: gitlabKeys.integration(projectId ?? ''),
    queryFn: () =>
      request<GitlabIntegrationDto | null>(`/projects/${projectId}/gitlab`),
    enabled: enabled && !!projectId,
  });
}

/** Create or replace the project's GitLab integration config. ADMIN-only on the server. */
export function useUpsertGitlabIntegration(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertGitlabIntegrationInput) =>
      request<GitlabIntegrationDto>(`/projects/${projectId}/gitlab`, {
        method: 'PUT',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: gitlabKeys.integration(projectId) });
    },
  });
}

/** Remove the project's GitLab integration config. ADMIN-only on the server. */
export function useDeleteGitlabIntegration(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<{ ok: true }>(`/projects/${projectId}/gitlab`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: gitlabKeys.integration(projectId) });
    },
  });
}

/** Linked GitLab MRs/commits/branches for a single issue. */
export function useIssueGitlabLinks(issueId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.gitlabLinks(issueId ?? ''),
    queryFn: () => request<IssueGitlabLinkDto[]>(`/issues/${issueId}/gitlab-links`),
    enabled: enabled && !!issueId,
  });
}

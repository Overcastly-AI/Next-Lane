import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GitlabIntegrationDto,
  GitlabLiveLinkStatusDto,
  IssueGitlabLinkDto,
  UpdateGitlabAutomationInput,
} from '@next-lane/shared';
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

/**
 * Update the auto-transition-on-merge automation config. Mirrors
 * `github.ts#useUpdateGithubAutomation` exactly.
 */
export function useUpdateGitlabAutomation(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateGitlabAutomationInput) =>
      request<GitlabIntegrationDto>(`/projects/${projectId}/gitlab/automation`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: gitlabKeys.integration(projectId) });
    },
  });
}

/**
 * Live MR/pipeline status for an issue's linked GitLab MRs — polled on
 * issue drawer open. Mirrors `github.ts#useGithubLiveStatus` exactly.
 */
export function useGitlabLiveStatus(issueId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.gitlabLiveStatus(issueId ?? ''),
    queryFn: () => request<GitlabLiveLinkStatusDto[]>(`/issues/${issueId}/gitlab-links/live`),
    enabled: enabled && !!issueId,
    staleTime: 30_000,
    retry: false,
  });
}

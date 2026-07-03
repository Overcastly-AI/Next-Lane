import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GithubIntegrationDto,
  GithubLiveLinkStatusDto,
  IssueGithubLinkDto,
  UpdateGithubAutomationInput,
} from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

/** Query key for the GitHub integration config (settings-only; no realtime invalidation). */
export const githubKeys = {
  integration: (projectId: string) => ['githubIntegration', projectId] as const,
};

export interface UpsertGithubIntegrationInput {
  repoFullName: string;
  token: string;
}

/** The project's GitHub integration config. `null` when not configured. Any project member may read it. */
export function useGithubIntegration(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: githubKeys.integration(projectId ?? ''),
    queryFn: () =>
      request<GithubIntegrationDto | null>(`/projects/${projectId}/github`),
    enabled: enabled && !!projectId,
  });
}

/** Create or replace the project's GitHub integration config. ADMIN-only on the server. */
export function useUpsertGithubIntegration(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertGithubIntegrationInput) =>
      request<GithubIntegrationDto>(`/projects/${projectId}/github`, {
        method: 'PUT',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: githubKeys.integration(projectId) });
    },
  });
}

/** Remove the project's GitHub integration config. ADMIN-only on the server. */
export function useDeleteGithubIntegration(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<{ ok: true }>(`/projects/${projectId}/github`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: githubKeys.integration(projectId) });
    },
  });
}

/** Linked GitHub PRs/commits/branches for a single issue. */
export function useIssueGithubLinks(issueId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.githubLinks(issueId ?? ''),
    queryFn: () => request<IssueGithubLinkDto[]>(`/issues/${issueId}/github-links`),
    enabled: enabled && !!issueId,
  });
}

/**
 * Update the auto-transition-on-merge automation config. Token-free
 * (separate from the full PUT save) — ADMIN-only on the server.
 */
export function useUpdateGithubAutomation(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateGithubAutomationInput) =>
      request<GithubIntegrationDto>(`/projects/${projectId}/github/automation`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: githubKeys.integration(projectId) });
    },
  });
}

/**
 * Live PR/CI status for an issue's linked GitHub PRs — polled on issue
 * drawer open (`enabled` gates it to only fire once there's at least one
 * link to check, avoiding a call on every drawer open regardless of whether
 * GitHub is even configured). Disabled `refetchOnWindowFocus`/no polling
 * interval — this is an explicit "refresh" affordance, not a background
 * poll, per the v1 scope (poll-on-open is fine).
 */
export function useGithubLiveStatus(issueId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.githubLiveStatus(issueId ?? ''),
    queryFn: () => request<GithubLiveLinkStatusDto[]>(`/issues/${issueId}/github-links/live`),
    enabled: enabled && !!issueId,
    staleTime: 30_000,
    retry: false,
  });
}

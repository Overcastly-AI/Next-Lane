import { Injectable, Logger } from '@nestjs/common';
import { ssrfSafeFetch, SsrfBlockedError } from '../common/ssrf-safe-fetch';

export interface GitlabProjectInfo {
  pathWithNamespace: string;
  visibility: string;
  defaultBranch: string | null;
}

export type GitlabChecksState = 'success' | 'failure' | 'pending' | 'unknown';

export interface GitlabMergeRequestStatus {
  iid: number;
  /** GitLab's raw state, already normalized "opened" → "open" (matches the webhook handler's convention). */
  state: 'open' | 'closed' | 'merged' | 'locked';
  merged: boolean;
  mergedAt: string | null;
  checksState: GitlabChecksState | null;
  url: string;
}

const REQUEST_TIMEOUT_MS = 8000;

/** Maps GitLab pipeline `status` values to our compact vocabulary. */
function normalizeChecksState(status: string | undefined): GitlabChecksState {
  if (status === 'success') return 'success';
  if (status === 'pending' || status === 'running' || status === 'created' || status === 'waiting_for_resource') {
    return 'pending';
  }
  if (status === 'failed' || status === 'canceled' || status === 'skipped') return 'failure';
  return 'unknown';
}

function normalizeState(state: string | undefined): GitlabMergeRequestStatus['state'] {
  if (state === 'opened') return 'open';
  if (state === 'closed' || state === 'merged' || state === 'locked') return state;
  return 'open';
}

/**
 * The SINGLE seam through which the API ever talks to a GitLab instance
 * (SaaS `gitlab.com` or self-managed). Mirrors `github/github-client.service.ts`
 * exactly — see that file's header comment for the full design rationale.
 *
 * Unlike `GithubClient` (hardcoded `api.github.com`), `baseUrl` is a
 * parameter on every call — self-hosted GitLab is a first-class target, not
 * an afterthought, per `GitlabIntegration.gitlabBaseUrl`. Because `baseUrl`
 * is admin-supplied and can point anywhere, EVERY call here goes through
 * `ssrfSafeFetch` (`../common/ssrf-safe-fetch.ts` — DNS-resolved,
 * IP-blocklisted, connection PINNED to the vetted address, `redirect:
 * 'manual'`) — this is the primary SSRF risk this module carries (see
 * `webhooks.service.ts` for the shared guard `GithubClient` also reuses).
 */
@Injectable()
export class GitlabClient {
  private readonly logger = new Logger(GitlabClient.name);

  /**
   * Fetch basic project metadata. Never throws — returns null on any
   * non-2xx response, network failure, or SSRF-blocked target so callers can
   * treat "couldn't verify" as a soft failure rather than a hard dependency.
   */
  async getProject(
    baseUrl: string,
    projectPath: string,
    token: string,
  ): Promise<GitlabProjectInfo | null> {
    const origin = baseUrl.replace(/\/+$/, '');
    const encodedPath = encodeURIComponent(projectPath);
    const url = `${origin}/api/v4/projects/${encodedPath}`;
    try {
      const res = await ssrfSafeFetch(url, {
        headers: {
          'PRIVATE-TOKEN': token,
          'User-Agent': 'next-lane',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        // Drain the unread body so the pinned socket is reclaimed promptly
        // (same pattern as webhooks.service.ts delivery).
        void res.text().catch(() => {});
        this.logger.warn(
          `GitLab project lookup for ${projectPath} returned ${res.status}`,
        );
        return null;
      }
      const data = (await res.json()) as {
        path_with_namespace: string;
        visibility: string;
        default_branch: string | null;
      };
      return {
        pathWithNamespace: data.path_with_namespace,
        visibility: data.visibility,
        defaultBranch: data.default_branch,
      };
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        this.logger.warn(`GitLab project lookup for ${projectPath} blocked: ${err.reason}`);
      } else {
        this.logger.warn(`GitLab project lookup for ${projectPath} failed: ${String(err)}`);
      }
      return null;
    }
  }

  /**
   * Fetch a single merge request's live state plus its latest pipeline
   * status, in one call — GitLab's MR API embeds `pipeline` inline, unlike
   * GitHub which needs a second combined-status request. Never throws —
   * returns null on any failure (missing MR, bad token, SSRF-blocked,
   * network error) so the issue drawer degrades gracefully.
   */
  async getMergeRequestStatus(
    baseUrl: string,
    projectPath: string,
    token: string,
    iid: number,
  ): Promise<GitlabMergeRequestStatus | null> {
    const origin = baseUrl.replace(/\/+$/, '');
    const encodedPath = encodeURIComponent(projectPath);
    const url = `${origin}/api/v4/projects/${encodedPath}/merge_requests/${iid}`;
    try {
      const res = await ssrfSafeFetch(url, {
        headers: {
          'PRIVATE-TOKEN': token,
          'User-Agent': 'next-lane',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        // Drain the unread body so the pinned socket is reclaimed promptly
        // (same pattern as webhooks.service.ts delivery).
        void res.text().catch(() => {});
        this.logger.warn(`GitLab MR lookup for ${projectPath}!${iid} returned ${res.status}`);
        return null;
      }
      const data = (await res.json()) as {
        iid: number;
        state?: string;
        merged_at: string | null;
        web_url: string;
        pipeline?: { status?: string } | null;
        head_pipeline?: { status?: string } | null;
      };
      const state = normalizeState(data.state);
      return {
        iid: data.iid,
        state,
        merged: state === 'merged',
        mergedAt: data.merged_at,
        checksState: normalizeChecksState(
          (data.pipeline ?? data.head_pipeline ?? undefined)?.status,
        ),
        url: data.web_url,
      };
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        this.logger.warn(`GitLab MR lookup for ${projectPath}!${iid} blocked: ${err.reason}`);
      } else {
        this.logger.warn(`GitLab MR lookup for ${projectPath}!${iid} failed: ${String(err)}`);
      }
      return null;
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { resolveAndCheckBlocked } from '../webhooks/webhooks.service';

export interface GithubRepoInfo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

export type GithubChecksState = 'success' | 'failure' | 'pending' | 'unknown';

export interface GithubPullRequestStatus {
  number: number;
  state: 'open' | 'closed';
  merged: boolean;
  mergedAt: string | null;
  checksState: GithubChecksState | null;
  url: string;
}

const GITHUB_API_BASE = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 8000;

/** Maps GitHub's combined-status `state` values to our compact vocabulary. */
function normalizeChecksState(state: string | undefined): GithubChecksState {
  if (state === 'success' || state === 'failure' || state === 'pending') return state;
  // "error" (and anything unrecognized) folds into "failure" — both mean
  // "don't merge yet" from the drawer's point of view.
  if (state === 'error') return 'failure';
  return 'unknown';
}

/**
 * The SINGLE seam through which the API ever talks to github.com.
 *
 * Design intent (per the v1 kickoff scope): outbound network access to GitHub
 * is entirely optional in v1 — the inbound webhook receiver derives
 * everything it needs (PR/commit/branch metadata) straight from the webhook
 * payload, so no endpoint in this module currently calls out. This class
 * exists so that ANY future live GitHub API call (PR/CI status polling,
 * repo-access verification, etc.) is forced through one injectable,
 * unit-testable/mockable service rather than being scattered across the
 * codebase — this keeps `apps/api` buildable and testable in network-isolated
 * environments (no github.com egress) and gives self-hosters a single place
 * to audit or intercept outbound calls.
 *
 * `getPullRequestStatus`/`getChecksState` (PR-status polling, Phase 9 "live
 * PR/CI status") are the first REAL calls made through this seam. Even
 * though `api.github.com` is a fixed, non-admin-supplied host (unlike
 * GitLab's self-hosted `gitlabBaseUrl`), every outbound call still goes
 * through the shared SSRF pre-flight (`resolveAndCheckBlocked` /
 * `redirect: 'manual'`, the same guard `webhooks.service.ts` uses for
 * outbound webhook delivery) for defense-in-depth and so the two clients
 * share one audited code path rather than diverging.
 */
@Injectable()
export class GithubClient {
  private readonly logger = new Logger(GithubClient.name);

  /**
   * Fetch basic repository metadata. Never throws — returns null on any
   * non-2xx response or network failure so callers can treat "couldn't
   * verify" as a soft failure rather than a hard dependency.
   */
  async getRepository(
    repoFullName: string,
    token: string,
  ): Promise<GithubRepoInfo | null> {
    const url = `${GITHUB_API_BASE}/repos/${repoFullName}`;
    if (await this.isBlocked(url)) return null;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'next-lane',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'manual',
      });
      if (!res.ok) {
        this.logger.warn(
          `GitHub repo lookup for ${repoFullName} returned ${res.status}`,
        );
        return null;
      }
      const data = (await res.json()) as {
        full_name: string;
        private: boolean;
        default_branch: string;
      };
      return {
        fullName: data.full_name,
        private: data.private,
        defaultBranch: data.default_branch,
      };
    } catch (err) {
      this.logger.warn(`GitHub repo lookup for ${repoFullName} failed: ${String(err)}`);
      return null;
    }
  }

  /**
   * Fetch a single pull request's live state (open/closed/merged) plus a
   * combined checks/CI rollup for its head commit. Never throws — returns
   * null on any failure (missing PR, bad token, rate limit, network error,
   * SSRF-blocked) so the issue drawer can degrade to "couldn't refresh live
   * status" instead of breaking.
   */
  async getPullRequestStatus(
    repoFullName: string,
    token: string,
    number: number,
  ): Promise<GithubPullRequestStatus | null> {
    const url = `${GITHUB_API_BASE}/repos/${repoFullName}/pulls/${number}`;
    if (await this.isBlocked(url)) return null;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'next-lane',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'manual',
      });
      if (!res.ok) {
        this.logger.warn(`GitHub PR lookup for ${repoFullName}#${number} returned ${res.status}`);
        return null;
      }
      const data = (await res.json()) as {
        number: number;
        state: string;
        merged: boolean;
        merged_at: string | null;
        html_url: string;
        head?: { sha?: string };
      };

      let checksState: GithubChecksState | null = null;
      if (data.head?.sha) {
        checksState = await this.getChecksState(repoFullName, token, data.head.sha);
      }

      return {
        number: data.number,
        state: data.state === 'closed' ? 'closed' : 'open',
        merged: !!data.merged,
        mergedAt: data.merged_at,
        checksState,
        url: data.html_url,
      };
    } catch (err) {
      this.logger.warn(`GitHub PR lookup for ${repoFullName}#${number} failed: ${String(err)}`);
      return null;
    }
  }

  /**
   * Fetch the combined commit status (CI rollup) for a commit sha. Returns
   * null (rather than throwing) on any failure — checks are a nice-to-have
   * enrichment of the PR status, never a hard dependency.
   */
  private async getChecksState(
    repoFullName: string,
    token: string,
    sha: string,
  ): Promise<GithubChecksState | null> {
    const url = `${GITHUB_API_BASE}/repos/${repoFullName}/commits/${sha}/status`;
    if (await this.isBlocked(url)) return null;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'next-lane',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'manual',
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { state?: string };
      return normalizeChecksState(data.state);
    } catch (err) {
      this.logger.warn(`GitHub checks lookup for ${repoFullName}@${sha} failed: ${String(err)}`);
      return null;
    }
  }

  /**
   * SSRF pre-flight shared with `webhooks.service.ts`'s outbound webhook
   * delivery guard (DNS-resolve + private/loopback/link-local IP blocklist).
   * `api.github.com` is a fixed, non-admin-supplied host, so this is
   * defense-in-depth rather than the primary risk (see `GitlabClient`, whose
   * `baseUrl` IS admin-supplied and self-hosted).
   */
  private async isBlocked(url: string): Promise<boolean> {
    const result = await resolveAndCheckBlocked(url);
    if (result.blocked) {
      this.logger.warn(`Outbound GitHub call to ${url} blocked: ${result.reason ?? 'blocked by SSRF policy'}`);
    }
    return result.blocked;
  }
}

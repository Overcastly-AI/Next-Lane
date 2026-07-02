import { Injectable, Logger } from '@nestjs/common';

export interface GithubRepoInfo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

const GITHUB_API_BASE = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 8000;

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
    try {
      const res = await fetch(`${GITHUB_API_BASE}/repos/${repoFullName}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'next-lane',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
}

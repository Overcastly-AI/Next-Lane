import { Injectable, Logger } from '@nestjs/common';

export interface GitlabProjectInfo {
  pathWithNamespace: string;
  visibility: string;
  defaultBranch: string | null;
}

const REQUEST_TIMEOUT_MS = 8000;

/**
 * The SINGLE seam through which the API ever talks to a GitLab instance
 * (SaaS `gitlab.com` or self-managed). Mirrors `github/github-client.service.ts`
 * exactly — see that file's header comment for the full design rationale
 * (outbound network access is entirely optional in v1; every v1 endpoint
 * derives what it needs from the inbound webhook payload, so this class is
 * unit-tested/mocked but unused, keeping the module buildable/testable with
 * zero live-GitLab egress).
 *
 * Unlike `GithubClient` (hardcoded `api.github.com`), `baseUrl` is a
 * parameter on every call — self-hosted GitLab is a first-class target, not
 * an afterthought, per `GitlabIntegration.gitlabBaseUrl`.
 */
@Injectable()
export class GitlabClient {
  private readonly logger = new Logger(GitlabClient.name);

  /**
   * Fetch basic project metadata. Never throws — returns null on any
   * non-2xx response or network failure so callers can treat "couldn't
   * verify" as a soft failure rather than a hard dependency.
   */
  async getProject(
    baseUrl: string,
    projectPath: string,
    token: string,
  ): Promise<GitlabProjectInfo | null> {
    const origin = baseUrl.replace(/\/+$/, '');
    // GitLab's API addresses a project either by numeric id or by its
    // URL-encoded "namespace/path" (nested subgroups included).
    const encodedPath = encodeURIComponent(projectPath);
    try {
      const res = await fetch(`${origin}/api/v4/projects/${encodedPath}`, {
        headers: {
          'PRIVATE-TOKEN': token,
          'User-Agent': 'next-lane',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
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
      this.logger.warn(`GitLab project lookup for ${projectPath} failed: ${String(err)}`);
      return null;
    }
  }
}

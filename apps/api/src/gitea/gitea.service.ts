import { randomBytes } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Role, SocketEvents } from '@next-lane/shared';
import type { GiteaIntegrationDto, IssueGiteaLinkDto } from '@next-lane/shared';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuditService } from '../audit/audit.service';
import {
  assertProjectMember,
  assertProjectRole,
  getEffectiveProjectRole,
} from '../common/membership.util';
import { extractIssueNumbers } from '../common/issue-key.util';
import { encryptGiteaToken } from './gitea-crypto.util';
import { verifyGiteaSignature } from './gitea-signature.util';
import type { UpsertGiteaIntegrationDto } from './dto/upsert-gitea-integration.dto';

/** Truncate long PR/commit titles for display (first line, capped length). */
const MAX_TITLE_LENGTH = 300;

type GiteaIntegrationRow = {
  id: string;
  projectId: string;
  giteaBaseUrl: string;
  repoFullName: string;
  webhookSecret: string;
  createdAt: Date;
  updatedAt: Date;
};

function firstLine(text: string): string {
  return text.split('\n')[0].slice(0, MAX_TITLE_LENGTH);
}

/** Resolve the base origin used to build the webhook URL shown to admins. */
function resolveWebhookBaseUrl(req: Request | undefined): string {
  const explicit = process.env.GITEA_WEBHOOK_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  if (req) return `${req.protocol}://${req.get('host')}`;
  return '';
}

function toIntegrationDto(
  row: GiteaIntegrationRow,
  opts: { isAdmin: boolean; req?: Request },
): GiteaIntegrationDto {
  const base = resolveWebhookBaseUrl(opts.req);
  return {
    id: row.id,
    projectId: row.projectId,
    giteaBaseUrl: row.giteaBaseUrl,
    repoFullName: row.repoFullName,
    webhookSecret: opts.isAdmin ? row.webhookSecret : null,
    webhookUrl: `${base}/api/gitea/webhook/${row.projectId}`,
    hasToken: true,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toLinkDto(row: {
  id: string;
  issueId: string;
  kind: string;
  externalId: string;
  title: string | null;
  url: string;
  state: string | null;
  authorLogin: string | null;
  createdAt: Date;
  updatedAt: Date;
}): IssueGiteaLinkDto {
  return {
    id: row.id,
    issueId: row.issueId,
    kind: row.kind as IssueGiteaLinkDto['kind'],
    externalId: row.externalId,
    title: row.title,
    url: row.url,
    state: row.state,
    authorLogin: row.authorLogin,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface UpsertLinkInput {
  issueNumber: number;
  kind: 'PR' | 'COMMIT' | 'BRANCH';
  externalId: string;
  title: string | null;
  url: string;
  state: string | null;
  authorLogin: string | null;
}

/**
 * Third self-hosted-forge integration (after GitHub, GitLab). v1 is
 * deliberately links-only — no auto-transition-on-merge, no live PR/CI
 * status, no outbound `GiteaClient` — see `GiteaIntegration`'s schema
 * comment. Structurally this mirrors `GithubService` closely (same
 * HMAC-signed-webhook verification shape) with `GitlabService`'s
 * self-hosted-base-URL-as-first-class-field precedent for `giteaBaseUrl`.
 */
@Injectable()
export class GiteaService {
  private readonly logger = new Logger(GiteaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  // ---- Admin config CRUD ---------------------------------------------------

  /**
   * Fetch the project's Gitea integration config. Any project member may
   * read it, but the `webhookSecret` is only populated for the caller's
   * EFFECTIVE project ADMIN (workspace ADMIN, or a per-project ADMIN
   * override) — mirrors `github.service.ts#get`/`gitlab.service.ts#get`
   * exactly. Returns null when not configured.
   */
  async get(
    userId: string,
    projectId: string,
    req?: Request,
  ): Promise<GiteaIntegrationDto | null> {
    const project = await assertProjectMember(this.prisma, userId, projectId);
    const effective = await getEffectiveProjectRole(
      this.prisma,
      userId,
      project.workspaceId,
      projectId,
    );
    const isAdmin = effective?.role === Role.ADMIN;

    const row = await this.prisma.giteaIntegration.findUnique({
      where: { projectId },
    });
    if (!row) return null;
    return toIntegrationDto(row, { isAdmin, req });
  }

  /** Create or replace the project's Gitea integration config. ADMIN-only. */
  async upsert(
    userId: string,
    projectId: string,
    dto: UpsertGiteaIntegrationDto,
    req?: Request,
    ip?: string | null,
  ): Promise<GiteaIntegrationDto> {
    const project = await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);

    const existing = await this.prisma.giteaIntegration.findUnique({
      where: { projectId },
    });
    const tokenEncrypted = encryptGiteaToken(dto.token);
    const giteaBaseUrl = dto.giteaBaseUrl.trim().replace(/\/+$/, '');

    const row = existing
      ? await this.prisma.giteaIntegration.update({
          where: { projectId },
          data: { repoFullName: dto.repoFullName, giteaBaseUrl, tokenEncrypted },
        })
      : await this.prisma.giteaIntegration.create({
          data: {
            projectId,
            repoFullName: dto.repoFullName,
            giteaBaseUrl,
            tokenEncrypted,
            // Generated once at creation; a plain re-save (PUT) never
            // rotates it so the admin doesn't have to re-paste the Gitea
            // webhook secret on every config edit.
            webhookSecret: randomBytes(24).toString('hex'),
          },
        });

    this.audit.record({
      workspaceId: project.workspaceId,
      actorId: userId,
      action: existing ? 'gitea.update' : 'gitea.create',
      targetType: 'GiteaIntegration',
      targetId: row.id,
      metadata: { projectId, repoFullName: dto.repoFullName, giteaBaseUrl },
      ip,
    });

    return toIntegrationDto(row, { isAdmin: true, req });
  }

  /** Remove the project's Gitea integration config. ADMIN-only. */
  async remove(userId: string, projectId: string, ip?: string | null): Promise<{ ok: true }> {
    const project = await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);
    const existing = await this.prisma.giteaIntegration.findUnique({
      where: { projectId },
    });
    if (!existing) throw new NotFoundException('Gitea integration not configured for this project');

    await this.prisma.giteaIntegration.delete({ where: { projectId } });

    this.audit.record({
      workspaceId: project.workspaceId,
      actorId: userId,
      action: 'gitea.delete',
      targetType: 'GiteaIntegration',
      targetId: existing.id,
      metadata: { projectId, repoFullName: existing.repoFullName },
      ip,
    });

    return { ok: true };
  }

  // ---- Read: issue's linked PRs/commits/branches ---------------------------

  /** Linked Gitea PRs/commits/branches for a single issue. Any project member. */
  async listIssueLinks(userId: string, issueId: string): Promise<IssueGiteaLinkDto[]> {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { projectId: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    await assertProjectMember(this.prisma, userId, issue.projectId);

    const rows = await this.prisma.issueGiteaLink.findMany({
      where: { issueId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(toLinkDto);
  }

  // ---- Inbound webhook ------------------------------------------------------

  /**
   * Verify and process an inbound Gitea webhook delivery for `projectId`.
   *
   * Returns a small summary object; the controller maps a false verify()
   * result to 401 — kept as a plain boolean-shaped return here so unit tests
   * don't need to construct HTTP exceptions to exercise the branch. Mirrors
   * `github.service.ts#verifySignature` exactly, minus GitHub's "sha256="
   * header prefix (see `gitea-signature.util.ts`).
   */
  async verifySignature(
    projectId: string,
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<{ ok: true } | { ok: false }> {
    const integration = await this.prisma.giteaIntegration.findUnique({
      where: { projectId },
    });
    if (!integration) return { ok: false };
    const valid = verifyGiteaSignature(integration.webhookSecret, rawBody, signatureHeader);
    if (!valid) return { ok: false };
    return { ok: true };
  }

  /**
   * Process a verified `push` event payload: scan each commit's message (and
   * the pushed branch name) for this project's issue keys and upsert COMMIT /
   * BRANCH links idempotently. Mirrors `github.service.ts#handlePushEvent`.
   *
   * Gitea's push payload (api.PushPayload) is close to GitHub's but not
   * byte-identical: each commit's author/committer is a `PayloadUser`
   * (`name`/`email`/`username` — all present, unlike GitLab's commit author
   * which has no username), while the top-level `pusher`/`sender` is a full
   * Gitea API `User` object whose display-name field is `login` (not
   * `username`) — both are checked with a fallback chain so a minor Gitea
   * version difference in field naming degrades gracefully rather than
   * silently dropping the author.
   */
  async handlePushEvent(projectId: string, payload: unknown): Promise<{ linksUpserted: number }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, key: true },
    });
    if (!project) return { linksUpserted: 0 };

    const body = payload as {
      ref?: string;
      pusher?: { login?: string; username?: string; full_name?: string };
      commits?: Array<{
        id?: string;
        message?: string;
        url?: string;
        author?: { name?: string; username?: string };
      }>;
    };

    const inputs: UpsertLinkInput[] = [];

    for (const commit of body.commits ?? []) {
      const message = commit.message ?? '';
      const sha = commit.id;
      if (!sha) continue;
      const issueNumbers = extractIssueNumbers(message, project.key);
      for (const issueNumber of issueNumbers) {
        inputs.push({
          issueNumber,
          kind: 'COMMIT',
          externalId: sha,
          title: firstLine(message) || null,
          url: commit.url ?? '',
          state: null,
          authorLogin: commit.author?.username ?? commit.author?.name ?? null,
        });
      }
    }

    // Branch name itself may reference an issue key (e.g. "feature/NL-42-fix").
    const branchName = body.ref?.startsWith('refs/heads/')
      ? body.ref.slice('refs/heads/'.length)
      : null;
    if (branchName) {
      const issueNumbers = extractIssueNumbers(branchName, project.key);
      for (const issueNumber of issueNumbers) {
        inputs.push({
          issueNumber,
          kind: 'BRANCH',
          externalId: branchName,
          title: branchName,
          url: '',
          state: null,
          authorLogin: body.pusher?.login ?? body.pusher?.username ?? body.pusher?.full_name ?? null,
        });
      }
    }

    return this.upsertLinks(project.id, inputs);
  }

  /**
   * Process a verified `pull_request` event payload: scan the PR title and
   * head branch name for this project's issue keys and upsert PR links
   * idempotently, with state open/closed/merged. Mirrors
   * `github.service.ts#handlePullRequestEvent` — Gitea's `api.PullRequest`
   * shape (`number`, `title`, `html_url`, `state`, `merged`, `head.ref`,
   * `user.login`) is effectively the same field paths as GitHub's for
   * everything v1 needs.
   */
  async handlePullRequestEvent(
    projectId: string,
    payload: unknown,
  ): Promise<{ linksUpserted: number }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, key: true },
    });
    if (!project) return { linksUpserted: 0 };

    const body = payload as {
      pull_request?: {
        number?: number;
        title?: string;
        html_url?: string;
        state?: string;
        merged?: boolean;
        head?: { ref?: string };
        user?: { login?: string; username?: string };
      };
    };
    const pr = body.pull_request;
    if (!pr || pr.number === undefined) return { linksUpserted: 0 };

    const state = pr.merged ? 'merged' : pr.state ?? 'open';
    const title = pr.title ?? '';
    const branchName = pr.head?.ref ?? '';
    const issueNumbers = new Set([
      ...extractIssueNumbers(title, project.key),
      ...extractIssueNumbers(branchName, project.key),
    ]);

    const inputs: UpsertLinkInput[] = [...issueNumbers].map((issueNumber) => ({
      issueNumber,
      kind: 'PR' as const,
      externalId: String(pr.number),
      title: title || null,
      url: pr.html_url ?? '',
      state,
      authorLogin: pr.user?.login ?? pr.user?.username ?? null,
    }));

    return this.upsertLinks(project.id, inputs);
  }

  /**
   * Shared upsert path: resolves each `issueNumber` to an Issue in THIS
   * project (never cross-project — `extractIssueNumbers` is already scoped
   * to `project.key`, and this `findFirst` additionally guards against a
   * stale/renamed project key colliding with a real number in a different
   * project), upserts the link row (idempotent via the
   * `[issueId, kind, externalId]` unique constraint), and emits the existing
   * `issue.updated` realtime event so any open drawer refreshes its Gitea
   * links + issue caches. Mirrors `github.service.ts#upsertLinks` /
   * `gitlab.service.ts#upsertLinks` exactly.
   */
  private async upsertLinks(
    projectId: string,
    inputs: UpsertLinkInput[],
  ): Promise<{ linksUpserted: number }> {
    if (inputs.length === 0) return { linksUpserted: 0 };

    const affectedIssueIds = new Set<string>();
    let count = 0;

    for (const input of inputs) {
      const issue = await this.prisma.issue.findFirst({
        where: { projectId, number: input.issueNumber },
        select: { id: true },
      });
      if (!issue) continue;

      await this.prisma.issueGiteaLink.upsert({
        where: {
          issueId_kind_externalId: {
            issueId: issue.id,
            kind: input.kind,
            externalId: input.externalId,
          },
        },
        create: {
          issueId: issue.id,
          kind: input.kind,
          externalId: input.externalId,
          title: input.title,
          url: input.url,
          state: input.state,
          authorLogin: input.authorLogin,
        },
        update: {
          title: input.title,
          url: input.url,
          state: input.state,
          authorLogin: input.authorLogin,
        },
      });
      affectedIssueIds.add(issue.id);
      count++;
    }

    for (const issueId of affectedIssueIds) {
      // Minimal payload — the frontend only needs the id to invalidate the
      // issue + Gitea-links caches (see apps/web/src/api/socket.ts).
      this.realtime.emitToProject(projectId, SocketEvents.IssueUpdated, { id: issueId });
    }

    if (count > 0) {
      this.logger.debug(
        `Upserted ${count} Gitea link(s) for project ${projectId} across ${affectedIssueIds.size} issue(s)`,
      );
    }

    return { linksUpserted: count };
  }
}

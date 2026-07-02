import { randomBytes } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Role, SocketEvents } from '@next-lane/shared';
import type { GithubIntegrationDto, IssueGithubLinkDto } from '@next-lane/shared';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuditService } from '../audit/audit.service';
import { assertProjectMember, assertProjectRole } from '../common/membership.util';
import { encryptGithubToken } from './github-crypto.util';
import { verifyGithubSignature } from './github-signature.util';
import { extractIssueNumbers } from './github-issue-key.util';
import type { UpsertGithubIntegrationDto } from './dto/upsert-github-integration.dto';

/** Truncate long PR/commit titles for display (first line, capped length). */
const MAX_TITLE_LENGTH = 300;

type GithubIntegrationRow = {
  id: string;
  projectId: string;
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
  const explicit = process.env.GITHUB_WEBHOOK_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  if (req) return `${req.protocol}://${req.get('host')}`;
  return '';
}

function toIntegrationDto(
  row: GithubIntegrationRow,
  opts: { isAdmin: boolean; req?: Request },
): GithubIntegrationDto {
  const base = resolveWebhookBaseUrl(opts.req);
  return {
    id: row.id,
    projectId: row.projectId,
    repoFullName: row.repoFullName,
    webhookSecret: opts.isAdmin ? row.webhookSecret : null,
    webhookUrl: `${base}/api/github/webhook/${row.projectId}`,
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
}): IssueGithubLinkDto {
  return {
    id: row.id,
    issueId: row.issueId,
    kind: row.kind as IssueGithubLinkDto['kind'],
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

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  // ---- Admin config CRUD ---------------------------------------------------

  /**
   * Fetch the project's GitHub integration config. Any project member may
   * read it, but the `webhookSecret` is only populated for ADMINs (members
   * get a read-only summary — repoFullName + hasToken — per the acceptance
   * criteria). Returns null when not configured.
   */
  async get(
    userId: string,
    projectId: string,
    req?: Request,
  ): Promise<GithubIntegrationDto | null> {
    const project = await assertProjectMember(this.prisma, userId, projectId);
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: project.workspaceId } },
    });
    const isAdmin = membership?.role === Role.ADMIN;

    const row = await this.prisma.githubIntegration.findUnique({
      where: { projectId },
    });
    if (!row) return null;
    return toIntegrationDto(row, { isAdmin, req });
  }

  /** Create or replace the project's GitHub integration config. ADMIN-only. */
  async upsert(
    userId: string,
    projectId: string,
    dto: UpsertGithubIntegrationDto,
    req?: Request,
    ip?: string | null,
  ): Promise<GithubIntegrationDto> {
    const project = await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);

    const existing = await this.prisma.githubIntegration.findUnique({
      where: { projectId },
    });
    const tokenEncrypted = encryptGithubToken(dto.token);

    const row = existing
      ? await this.prisma.githubIntegration.update({
          where: { projectId },
          data: { repoFullName: dto.repoFullName, tokenEncrypted },
        })
      : await this.prisma.githubIntegration.create({
          data: {
            projectId,
            repoFullName: dto.repoFullName,
            tokenEncrypted,
            // Generated once at creation; a plain re-save (PUT) never rotates
            // it so the admin doesn't have to re-paste the GitHub webhook
            // secret on every config edit.
            webhookSecret: randomBytes(24).toString('hex'),
          },
        });

    this.audit.record({
      workspaceId: project.workspaceId,
      actorId: userId,
      action: existing ? 'github.update' : 'github.create',
      targetType: 'GithubIntegration',
      targetId: row.id,
      metadata: { projectId, repoFullName: dto.repoFullName },
      ip,
    });

    return toIntegrationDto(row, { isAdmin: true, req });
  }

  /** Remove the project's GitHub integration config. ADMIN-only. */
  async remove(userId: string, projectId: string, ip?: string | null): Promise<{ ok: true }> {
    const project = await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);
    const existing = await this.prisma.githubIntegration.findUnique({
      where: { projectId },
    });
    if (!existing) throw new NotFoundException('GitHub integration not configured for this project');

    await this.prisma.githubIntegration.delete({ where: { projectId } });

    this.audit.record({
      workspaceId: project.workspaceId,
      actorId: userId,
      action: 'github.delete',
      targetType: 'GithubIntegration',
      targetId: existing.id,
      metadata: { projectId, repoFullName: existing.repoFullName },
      ip,
    });

    return { ok: true };
  }

  // ---- Read: issue's linked PRs/commits/branches ---------------------------

  /** Linked GitHub PRs/commits/branches for a single issue. Any project member. */
  async listIssueLinks(userId: string, issueId: string): Promise<IssueGithubLinkDto[]> {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { projectId: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    await assertProjectMember(this.prisma, userId, issue.projectId);

    const rows = await this.prisma.issueGithubLink.findMany({
      where: { issueId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(toLinkDto);
  }

  // ---- Inbound webhook ------------------------------------------------------

  /**
   * Verify and process an inbound GitHub webhook delivery for `projectId`.
   *
   * Returns a small summary object; throws NotFoundException when no
   * integration is configured for the project, or UnauthorizedException-shape
   * via the caller (the controller maps a false verify() result to 401) —
   * kept as a plain boolean return here so unit tests don't need to construct
   * HTTP exceptions to exercise the branch.
   */
  async verifySignature(
    projectId: string,
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<{ ok: true; secret: string } | { ok: false }> {
    const integration = await this.prisma.githubIntegration.findUnique({
      where: { projectId },
    });
    if (!integration) return { ok: false };
    const valid = verifyGithubSignature(integration.webhookSecret, rawBody, signatureHeader);
    if (!valid) return { ok: false };
    return { ok: true, secret: integration.webhookSecret };
  }

  /**
   * Process a verified `push` event payload: scan each commit's message (and
   * the pushed branch name) for this project's issue keys and upsert COMMIT /
   * BRANCH links idempotently.
   */
  async handlePushEvent(projectId: string, payload: unknown): Promise<{ linksUpserted: number }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, key: true },
    });
    if (!project) return { linksUpserted: 0 };

    const body = payload as {
      ref?: string;
      pusher?: { name?: string };
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
          authorLogin: body.pusher?.name ?? null,
        });
      }
    }

    return this.upsertLinks(project.id, inputs);
  }

  /**
   * Process a verified `pull_request` event payload: scan the PR title and
   * head branch name for this project's issue keys and upsert PR links
   * idempotently, with state open/closed/merged.
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
        user?: { login?: string };
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
      authorLogin: pr.user?.login ?? null,
    }));

    return this.upsertLinks(project.id, inputs);
  }

  /**
   * Shared upsert path: resolves each `issueNumber` to an Issue in THIS
   * project (never cross-project — the acceptance criteria requires wrong-
   * project keys to be ignored, which is already guaranteed one level up by
   * `extractIssueNumbers` being scoped to `project.key`, but the findFirst
   * here additionally guards against a stale/renamed project key colliding
   * with a real number in a different project), upserts the link row
   * (idempotent via the `[issueId, kind, externalId]` unique constraint), and
   * emits the existing `issue.updated` realtime event so any open drawer
   * refreshes its GitHub links + issue caches.
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

      await this.prisma.issueGithubLink.upsert({
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
      // issue + GitHub-links caches (see apps/web/src/api/socket.ts).
      this.realtime.emitToProject(projectId, SocketEvents.IssueUpdated, { id: issueId });
    }

    if (count > 0) {
      this.logger.debug(
        `Upserted ${count} GitHub link(s) for project ${projectId} across ${affectedIssueIds.size} issue(s)`,
      );
    }

    return { linksUpserted: count };
  }
}

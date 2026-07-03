import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Role, SocketEvents } from '@next-lane/shared';
import type {
  GithubIntegrationDto,
  GithubLiveLinkStatusDto,
  IssueGithubLinkDto,
} from '@next-lane/shared';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuditService } from '../audit/audit.service';
import { IssuesService } from '../issues/issues.service';
import {
  assertProjectMember,
  assertProjectRole,
  getEffectiveProjectRole,
} from '../common/membership.util';
import { resolveAutomationActor } from '../common/automation-actor.util';
import { encryptGithubToken, decryptGithubToken } from './github-crypto.util';
import { verifyGithubSignature } from './github-signature.util';
import { extractIssueNumbers } from './github-issue-key.util';
import { GithubClient } from './github-client.service';
import type { UpsertGithubIntegrationDto } from './dto/upsert-github-integration.dto';
import type { UpdateGithubAutomationDto } from './dto/update-github-automation.dto';

/** Truncate long PR/commit titles for display (first line, capped length). */
const MAX_TITLE_LENGTH = 300;
/** Cap on how many linked PRs a single drawer-open live-status poll fetches. */
const MAX_LIVE_STATUS_LOOKUPS = 5;

type GithubIntegrationRow = {
  id: string;
  projectId: string;
  repoFullName: string;
  webhookSecret: string;
  autoTransitionOnMerge: boolean;
  autoTransitionStatusId: string | null;
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
    // Visible to every project member (not secret), unlike webhookSecret.
    autoTransitionOnMerge: row.autoTransitionOnMerge,
    autoTransitionStatusId: row.autoTransitionStatusId,
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
    private readonly issuesService: IssuesService,
    private readonly githubClient: GithubClient,
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
    // Effective project role so a per-project ADMIN override entitles the
    // user to the webhookSecret, consistent with assertProjectRole call sites.
    const effective = await getEffectiveProjectRole(
      this.prisma,
      userId,
      project.workspaceId,
      projectId,
    );
    const isAdmin = effective?.role === Role.ADMIN;

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

  /**
   * Update the auto-transition-on-merge automation config. ADMIN-only,
   * token-free (separate from `upsert()`'s full PUT so flipping the toggle
   * never forces re-entering the PAT). Requires the integration to already
   * be configured — 404 otherwise.
   *
   * Enabling requires a target status: either passed in this call
   * (`dto.statusId`) or already stored from a previous save. The status must
   * belong to THIS project (400 otherwise — the same "wrong-project safety"
   * guard every cross-reference in the codebase applies).
   */
  async updateAutomation(
    userId: string,
    projectId: string,
    dto: UpdateGithubAutomationDto,
    req?: Request,
    ip?: string | null,
  ): Promise<GithubIntegrationDto> {
    const project = await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);
    const existing = await this.prisma.githubIntegration.findUnique({ where: { projectId } });
    if (!existing) {
      throw new NotFoundException('GitHub integration not configured for this project');
    }

    const resolvedStatusId =
      dto.statusId !== undefined ? dto.statusId : existing.autoTransitionStatusId;

    if (dto.enabled) {
      if (!resolvedStatusId) {
        throw new BadRequestException(
          'A target status is required to enable auto-transition-on-merge',
        );
      }
      const status = await this.prisma.status.findUnique({
        where: { id: resolvedStatusId },
        select: { projectId: true },
      });
      if (!status || status.projectId !== projectId) {
        throw new BadRequestException('statusId does not belong to this project');
      }
    }

    const row = await this.prisma.githubIntegration.update({
      where: { projectId },
      data: {
        autoTransitionOnMerge: dto.enabled,
        autoTransitionStatusId: resolvedStatusId,
      },
    });

    this.audit.record({
      workspaceId: project.workspaceId,
      actorId: userId,
      action: 'github.automation_update',
      targetType: 'GithubIntegration',
      targetId: row.id,
      metadata: { projectId, autoTransitionOnMerge: dto.enabled, autoTransitionStatusId: resolvedStatusId },
      ip,
    });

    return toIntegrationDto(row, { isAdmin: true, req });
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

  /**
   * Live PR/CI status for an issue's linked GitHub PRs — the first REAL
   * outbound call this module makes (see `GithubClient`'s header comment).
   * Any project member may poll this (mirrors `listIssueLinks`'s access
   * level); returns `[]` when GitHub isn't configured or the issue has no PR
   * links, rather than an error, so the drawer can call this unconditionally.
   *
   * Never throws on a live-call failure — each link's entry carries `error`
   * instead so one bad/rate-limited lookup doesn't blank the whole section.
   * Capped at MAX_LIVE_STATUS_LOOKUPS most-recently-updated PR links per call
   * to bound the outbound fan-out from a single drawer open.
   */
  async getLiveStatus(userId: string, issueId: string): Promise<GithubLiveLinkStatusDto[]> {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { projectId: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    await assertProjectMember(this.prisma, userId, issue.projectId);

    const integration = await this.prisma.githubIntegration.findUnique({
      where: { projectId: issue.projectId },
    });
    if (!integration) return [];

    const prLinks = await this.prisma.issueGithubLink.findMany({
      where: { issueId, kind: 'PR' },
      orderBy: { updatedAt: 'desc' },
      take: MAX_LIVE_STATUS_LOOKUPS,
    });
    if (prLinks.length === 0) return [];

    let token: string;
    try {
      token = decryptGithubToken(integration.tokenEncrypted);
    } catch (err) {
      this.logger.warn(`Failed to decrypt GitHub token for project ${issue.projectId}: ${String(err)}`);
      const fetchedAt = new Date().toISOString();
      return prLinks.map((link) => ({
        linkId: link.id,
        externalId: link.externalId,
        state: null,
        merged: null,
        checksState: null,
        fetchedAt,
        error: 'Stored GitHub token could not be decrypted',
      }));
    }

    return Promise.all(
      prLinks.map(async (link): Promise<GithubLiveLinkStatusDto> => {
        const fetchedAt = new Date().toISOString();
        const number = Number(link.externalId);
        if (!Number.isFinite(number)) {
          return {
            linkId: link.id,
            externalId: link.externalId,
            state: null,
            merged: null,
            checksState: null,
            fetchedAt,
            error: 'Not a numeric PR number',
          };
        }
        const live = await this.githubClient.getPullRequestStatus(
          integration.repoFullName,
          token,
          number,
        );
        if (!live) {
          return {
            linkId: link.id,
            externalId: link.externalId,
            state: null,
            merged: null,
            checksState: null,
            fetchedAt,
            error: 'GitHub API unreachable',
          };
        }
        return {
          linkId: link.id,
          externalId: link.externalId,
          state: live.state,
          merged: live.merged,
          checksState: live.checksState,
          fetchedAt,
          error: null,
        };
      }),
    );
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
      select: { id: true, key: true, workspaceId: true, leadId: true },
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

    const result = await this.upsertLinks(project.id, inputs);

    if (state === 'merged' && issueNumbers.size > 0) {
      // Post-commit side effect: never let an auto-transition failure turn
      // an otherwise-successful webhook delivery into an error response
      // (mirrors the "guard post-commit side effects" pattern used
      // elsewhere for notification/webhook fan-out).
      await this.applyAutoTransition(project, [...issueNumbers]).catch((err) => {
        this.logger.error(`Auto-transition-on-merge failed for project ${project.id}: ${String(err)}`);
      });
    }

    return result;
  }

  /**
   * When the project's GitHub integration has `autoTransitionOnMerge` on,
   * move every issue referenced by a just-merged PR to
   * `autoTransitionStatusId` — reusing `IssuesService.move()`'s existing
   * workflow-transition enforcement path via the automation-bypass flag
   * (`{ automated: true }`), the exact mechanism the automation engine's own
   * TRANSITION action uses (`automation-engine.service.ts`).
   *
   * Disabled by default (schema default `false`) and a no-op with zero DB
   * queries beyond the integration lookup when off. Every issue is handled
   * independently and failures are logged + skipped rather than thrown, so
   * one issue with a restricted actor or a deleted target status never
   * blocks the others.
   */
  private async applyAutoTransition(
    project: { id: string; workspaceId: string; leadId: string | null },
    issueNumbers: number[],
  ): Promise<void> {
    const integration = await this.prisma.githubIntegration.findUnique({
      where: { projectId: project.id },
      select: { autoTransitionOnMerge: true, autoTransitionStatusId: true },
    });
    if (!integration?.autoTransitionOnMerge || !integration.autoTransitionStatusId) return;
    const targetStatusId = integration.autoTransitionStatusId;

    for (const issueNumber of issueNumbers) {
      try {
        // Re-scoped to THIS project — never a cross-project write, mirrors
        // upsertLinks' own findFirst-by-projectId guard.
        const issue = await this.prisma.issue.findFirst({
          where: { projectId: project.id, number: issueNumber },
          select: { id: true, statusId: true, assigneeId: true, reporterId: true },
        });
        if (!issue || issue.statusId === targetStatusId) continue;

        const actorId = await resolveAutomationActor(this.prisma, project, issue);
        if (!actorId) {
          this.logger.warn(
            `Auto-transition-on-merge: no eligible actor found for issue #${issueNumber} in project ${project.id}; skipping`,
          );
          continue;
        }

        await this.issuesService.move(
          actorId,
          issue.id,
          { statusId: targetStatusId },
          { automated: true },
        );
      } catch (err) {
        // Never let one issue's failure (e.g. an actor lacking effective
        // project access) block the rest of the batch.
        this.logger.warn(
          `Auto-transition-on-merge failed for issue #${issueNumber} in project ${project.id}: ${String(err)}`,
        );
      }
    }
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

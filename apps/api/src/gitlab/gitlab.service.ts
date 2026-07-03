import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Role, SocketEvents } from '@next-lane/shared';
import type {
  GitlabIntegrationDto,
  GitlabLiveLinkStatusDto,
  IssueGitlabLinkDto,
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
import { extractIssueNumbers } from '../common/issue-key.util';
import { encryptGitlabToken, decryptGitlabToken } from './gitlab-crypto.util';
import { verifyGitlabToken } from './gitlab-token-verify.util';
import { GitlabClient } from './gitlab-client.service';
import type { UpsertGitlabIntegrationDto } from './dto/upsert-gitlab-integration.dto';
import type { UpdateGitlabAutomationDto } from './dto/update-gitlab-automation.dto';

/** Truncate long MR/commit titles for display (first line, capped length). */
const MAX_TITLE_LENGTH = 300;
/** Cap on how many linked MRs a single drawer-open live-status poll fetches. */
const MAX_LIVE_STATUS_LOOKUPS = 5;

const DEFAULT_GITLAB_BASE_URL = 'https://gitlab.com';

type GitlabIntegrationRow = {
  id: string;
  projectId: string;
  gitlabBaseUrl: string;
  projectPath: string;
  webhookSecret: string;
  autoTransitionOnMerge: boolean;
  autoTransitionStatusId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function firstLine(text: string): string {
  return text.split('\n')[0].slice(0, MAX_TITLE_LENGTH);
}

/** Normalize GitLab's "opened" MR state to "open" for cross-provider consistency (matches the GitHub link's vocabulary). */
function normalizeState(state: string | undefined): string | null {
  if (!state) return null;
  return state === 'opened' ? 'open' : state;
}

/** Resolve the base origin used to build the webhook URL shown to admins. */
function resolveWebhookBaseUrl(req: Request | undefined): string {
  const explicit = process.env.GITLAB_WEBHOOK_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  if (req) return `${req.protocol}://${req.get('host')}`;
  return '';
}

function toIntegrationDto(
  row: GitlabIntegrationRow,
  opts: { isAdmin: boolean; req?: Request },
): GitlabIntegrationDto {
  const base = resolveWebhookBaseUrl(opts.req);
  return {
    id: row.id,
    projectId: row.projectId,
    gitlabBaseUrl: row.gitlabBaseUrl,
    projectPath: row.projectPath,
    webhookSecret: opts.isAdmin ? row.webhookSecret : null,
    webhookUrl: `${base}/api/gitlab/webhook/${row.projectId}`,
    hasToken: true,
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
}): IssueGitlabLinkDto {
  return {
    id: row.id,
    issueId: row.issueId,
    kind: row.kind as IssueGitlabLinkDto['kind'],
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
  kind: 'MR' | 'COMMIT' | 'BRANCH';
  externalId: string;
  title: string | null;
  url: string;
  state: string | null;
  authorLogin: string | null;
}

@Injectable()
export class GitlabService {
  private readonly logger = new Logger(GitlabService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly issuesService: IssuesService,
    private readonly gitlabClient: GitlabClient,
  ) {}

  // ---- Admin config CRUD ---------------------------------------------------

  /**
   * Fetch the project's GitLab integration config. Any project member may
   * read it, but the `webhookSecret` is only populated for the caller's
   * EFFECTIVE project ADMIN (workspace ADMIN, or a per-project ADMIN
   * override) — mirrors `github.service.ts#get` exactly. Returns null when
   * not configured.
   */
  async get(
    userId: string,
    projectId: string,
    req?: Request,
  ): Promise<GitlabIntegrationDto | null> {
    const project = await assertProjectMember(this.prisma, userId, projectId);
    const effective = await getEffectiveProjectRole(
      this.prisma,
      userId,
      project.workspaceId,
      projectId,
    );
    const isAdmin = effective?.role === Role.ADMIN;

    const row = await this.prisma.gitlabIntegration.findUnique({
      where: { projectId },
    });
    if (!row) return null;
    return toIntegrationDto(row, { isAdmin, req });
  }

  /** Create or replace the project's GitLab integration config. ADMIN-only. */
  async upsert(
    userId: string,
    projectId: string,
    dto: UpsertGitlabIntegrationDto,
    req?: Request,
    ip?: string | null,
  ): Promise<GitlabIntegrationDto> {
    const project = await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);

    const existing = await this.prisma.gitlabIntegration.findUnique({
      where: { projectId },
    });
    const tokenEncrypted = encryptGitlabToken(dto.token);
    const gitlabBaseUrl = dto.gitlabBaseUrl?.trim().replace(/\/+$/, '') || DEFAULT_GITLAB_BASE_URL;

    const row = existing
      ? await this.prisma.gitlabIntegration.update({
          where: { projectId },
          data: { projectPath: dto.projectPath, gitlabBaseUrl, tokenEncrypted },
        })
      : await this.prisma.gitlabIntegration.create({
          data: {
            projectId,
            projectPath: dto.projectPath,
            gitlabBaseUrl,
            tokenEncrypted,
            // Generated once at creation; a plain re-save (PUT) never rotates
            // it so the admin doesn't have to re-paste the GitLab webhook
            // "Secret Token" on every config edit.
            webhookSecret: randomBytes(24).toString('hex'),
          },
        });

    this.audit.record({
      workspaceId: project.workspaceId,
      actorId: userId,
      action: existing ? 'gitlab.update' : 'gitlab.create',
      targetType: 'GitlabIntegration',
      targetId: row.id,
      metadata: { projectId, projectPath: dto.projectPath, gitlabBaseUrl },
      ip,
    });

    return toIntegrationDto(row, { isAdmin: true, req });
  }

  /** Remove the project's GitLab integration config. ADMIN-only. */
  async remove(userId: string, projectId: string, ip?: string | null): Promise<{ ok: true }> {
    const project = await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);
    const existing = await this.prisma.gitlabIntegration.findUnique({
      where: { projectId },
    });
    if (!existing) throw new NotFoundException('GitLab integration not configured for this project');

    await this.prisma.gitlabIntegration.delete({ where: { projectId } });

    this.audit.record({
      workspaceId: project.workspaceId,
      actorId: userId,
      action: 'gitlab.delete',
      targetType: 'GitlabIntegration',
      targetId: existing.id,
      metadata: { projectId, projectPath: existing.projectPath },
      ip,
    });

    return { ok: true };
  }

  /**
   * Update the auto-transition-on-merge automation config. Mirrors
   * `github.service.ts#updateAutomation` exactly — ADMIN-only, token-free,
   * requires the integration to already be configured, requires a
   * project-scoped target status when enabling.
   */
  async updateAutomation(
    userId: string,
    projectId: string,
    dto: UpdateGitlabAutomationDto,
    req?: Request,
    ip?: string | null,
  ): Promise<GitlabIntegrationDto> {
    const project = await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);
    const existing = await this.prisma.gitlabIntegration.findUnique({ where: { projectId } });
    if (!existing) {
      throw new NotFoundException('GitLab integration not configured for this project');
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

    const row = await this.prisma.gitlabIntegration.update({
      where: { projectId },
      data: {
        autoTransitionOnMerge: dto.enabled,
        autoTransitionStatusId: resolvedStatusId,
      },
    });

    this.audit.record({
      workspaceId: project.workspaceId,
      actorId: userId,
      action: 'gitlab.automation_update',
      targetType: 'GitlabIntegration',
      targetId: row.id,
      metadata: { projectId, autoTransitionOnMerge: dto.enabled, autoTransitionStatusId: resolvedStatusId },
      ip,
    });

    return toIntegrationDto(row, { isAdmin: true, req });
  }

  // ---- Read: issue's linked MRs/commits/branches ---------------------------

  /** Linked GitLab MRs/commits/branches for a single issue. Any project member. */
  async listIssueLinks(userId: string, issueId: string): Promise<IssueGitlabLinkDto[]> {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { projectId: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    await assertProjectMember(this.prisma, userId, issue.projectId);

    const rows = await this.prisma.issueGitlabLink.findMany({
      where: { issueId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(toLinkDto);
  }

  /**
   * Live MR/pipeline status for an issue's linked GitLab MRs — the first
   * REAL outbound call this module makes (see `GitlabClient`'s header
   * comment). Mirrors `github.service.ts#getLiveStatus` exactly; returns
   * `[]` when GitLab isn't configured or there are no MR links, and never
   * throws on a live-call failure (each entry carries `error` instead).
   */
  async getLiveStatus(userId: string, issueId: string): Promise<GitlabLiveLinkStatusDto[]> {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { projectId: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    await assertProjectMember(this.prisma, userId, issue.projectId);

    const integration = await this.prisma.gitlabIntegration.findUnique({
      where: { projectId: issue.projectId },
    });
    if (!integration) return [];

    const mrLinks = await this.prisma.issueGitlabLink.findMany({
      where: { issueId, kind: 'MR' },
      orderBy: { updatedAt: 'desc' },
      take: MAX_LIVE_STATUS_LOOKUPS,
    });
    if (mrLinks.length === 0) return [];

    let token: string;
    try {
      token = decryptGitlabToken(integration.tokenEncrypted);
    } catch (err) {
      this.logger.warn(`Failed to decrypt GitLab token for project ${issue.projectId}: ${String(err)}`);
      const fetchedAt = new Date().toISOString();
      return mrLinks.map((link) => ({
        linkId: link.id,
        externalId: link.externalId,
        state: null,
        merged: null,
        checksState: null,
        fetchedAt,
        error: 'Stored GitLab token could not be decrypted',
      }));
    }

    return Promise.all(
      mrLinks.map(async (link): Promise<GitlabLiveLinkStatusDto> => {
        const fetchedAt = new Date().toISOString();
        const iid = Number(link.externalId);
        if (!Number.isFinite(iid)) {
          return {
            linkId: link.id,
            externalId: link.externalId,
            state: null,
            merged: null,
            checksState: null,
            fetchedAt,
            error: 'Not a numeric MR iid',
          };
        }
        const live = await this.gitlabClient.getMergeRequestStatus(
          integration.gitlabBaseUrl,
          integration.projectPath,
          token,
          iid,
        );
        if (!live) {
          return {
            linkId: link.id,
            externalId: link.externalId,
            state: null,
            merged: null,
            checksState: null,
            fetchedAt,
            error: 'GitLab API unreachable',
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
   * Verify an inbound GitLab webhook delivery for `projectId` against the
   * literal `X-Gitlab-Token` header value (GitLab does not sign the body —
   * see `gitlab-token-verify.util.ts`). Returns a small discriminated result;
   * the controller maps a false result to 401.
   */
  async verifyToken(
    projectId: string,
    tokenHeader: string | undefined,
  ): Promise<{ ok: true } | { ok: false }> {
    const integration = await this.prisma.gitlabIntegration.findUnique({
      where: { projectId },
    });
    if (!integration) return { ok: false };
    const valid = verifyGitlabToken(integration.webhookSecret, tokenHeader);
    if (!valid) return { ok: false };
    return { ok: true };
  }

  /**
   * Process a verified "Push Hook" event payload: scan each commit's message
   * (and the pushed branch name) for this project's issue keys and upsert
   * COMMIT / BRANCH links idempotently. Mirrors `github.service.ts#handlePushEvent`.
   */
  async handlePushEvent(projectId: string, payload: unknown): Promise<{ linksUpserted: number }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, key: true },
    });
    if (!project) return { linksUpserted: 0 };

    const body = payload as {
      ref?: string;
      user_username?: string;
      user_name?: string;
      commits?: Array<{
        id?: string;
        message?: string;
        url?: string;
        author?: { name?: string; email?: string };
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
          // GitLab's push-hook commit objects only carry author name/email
          // (no username field, unlike GitHub) — best-effort display value.
          authorLogin: commit.author?.name ?? null,
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
          authorLogin: body.user_username ?? body.user_name ?? null,
        });
      }
    }

    return this.upsertLinks(project.id, inputs);
  }

  /**
   * Process a verified "Merge Request Hook" event payload: scan the MR
   * title, description, and source branch name for this project's issue
   * keys and upsert MR links idempotently, with state open/closed/merged/
   * locked. Mirrors `github.service.ts#handlePullRequestEvent`.
   */
  async handleMergeRequestEvent(
    projectId: string,
    payload: unknown,
  ): Promise<{ linksUpserted: number }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, key: true, workspaceId: true, leadId: true },
    });
    if (!project) return { linksUpserted: 0 };

    const body = payload as {
      user?: { username?: string; name?: string };
      object_attributes?: {
        iid?: number;
        title?: string;
        description?: string;
        url?: string;
        state?: string;
        source_branch?: string;
      };
    };
    const mr = body.object_attributes;
    if (!mr || mr.iid === undefined) return { linksUpserted: 0 };

    const state = normalizeState(mr.state);
    const title = mr.title ?? '';
    const description = mr.description ?? '';
    const branchName = mr.source_branch ?? '';
    const issueNumbers = new Set([
      ...extractIssueNumbers(title, project.key),
      ...extractIssueNumbers(description, project.key),
      ...extractIssueNumbers(branchName, project.key),
    ]);

    const inputs: UpsertLinkInput[] = [...issueNumbers].map((issueNumber) => ({
      issueNumber,
      kind: 'MR' as const,
      externalId: String(mr.iid),
      title: title || null,
      url: mr.url ?? '',
      state,
      authorLogin: body.user?.username ?? body.user?.name ?? null,
    }));

    const result = await this.upsertLinks(project.id, inputs);

    if (state === 'merged' && issueNumbers.size > 0) {
      // Post-commit side effect: never let an auto-transition failure turn
      // an otherwise-successful webhook delivery into an error response.
      await this.applyAutoTransition(project, [...issueNumbers]).catch((err) => {
        this.logger.error(`Auto-transition-on-merge failed for project ${project.id}: ${String(err)}`);
      });
    }

    return result;
  }

  /**
   * When the project's GitLab integration has `autoTransitionOnMerge` on,
   * move every issue referenced by a just-merged MR to
   * `autoTransitionStatusId`. Mirrors `github.service.ts#applyAutoTransition`
   * exactly — see that method's header comment for the full rationale.
   */
  private async applyAutoTransition(
    project: { id: string; workspaceId: string; leadId: string | null },
    issueNumbers: number[],
  ): Promise<void> {
    const integration = await this.prisma.gitlabIntegration.findUnique({
      where: { projectId: project.id },
      select: { autoTransitionOnMerge: true, autoTransitionStatusId: true },
    });
    if (!integration?.autoTransitionOnMerge || !integration.autoTransitionStatusId) return;
    const targetStatusId = integration.autoTransitionStatusId;

    for (const issueNumber of issueNumbers) {
      try {
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
        this.logger.warn(
          `Auto-transition-on-merge failed for issue #${issueNumber} in project ${project.id}: ${String(err)}`,
        );
      }
    }
  }

  /**
   * Shared upsert path — identical semantics to
   * `github.service.ts#upsertLinks` (idempotent via the
   * `[issueId, kind, externalId]` unique constraint; scoped strictly to
   * issues within THIS project; emits the existing `issue.updated` realtime
   * event so any open drawer refreshes its GitLab links + issue caches).
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

      await this.prisma.issueGitlabLink.upsert({
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
      // issue + GitLab-links caches (see apps/web/src/api/socket.ts).
      this.realtime.emitToProject(projectId, SocketEvents.IssueUpdated, { id: issueId });
    }

    if (count > 0) {
      this.logger.debug(
        `Upserted ${count} GitLab link(s) for project ${projectId} across ${affectedIssueIds.size} issue(s)`,
      );
    }

    return { linksUpserted: count };
  }
}

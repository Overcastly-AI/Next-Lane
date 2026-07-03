import { Injectable } from '@nestjs/common';
import { Role, SocketEvents } from '@next-lane/shared';
import type { ProjectAgentContextDto } from '@next-lane/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { assertProjectMember, assertProjectRole } from '../common/membership.util';
import type { UpsertAgentContextDto } from './dto/upsert-agent-context.dto';

type ContextRow = {
  content: string;
  updatedAt: Date;
  updatedBy: { id: string; name: string } | null;
};

function toDto(
  row: ContextRow | null,
  staleness: { changesSinceUpdate: number; lastProjectActivityAt: Date | null },
): ProjectAgentContextDto {
  return {
    content: row?.content ?? '',
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
    staleness: {
      changesSinceUpdate: staleness.changesSinceUpdate,
      lastProjectActivityAt: staleness.lastProjectActivityAt?.toISOString() ?? null,
    },
  };
}

@Injectable()
export class AgentContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Fetch a project's agent-context document. Any project member (VIEWER+)
   * may read it. Returns an "empty" DTO (never 404) when nothing has been
   * written yet, so a first-time agent call is a normal read, not an error.
   */
  async get(userId: string, projectId: string): Promise<ProjectAgentContextDto> {
    const project = await assertProjectMember(this.prisma, userId, projectId);

    const row = await this.prisma.projectAgentContext.findUnique({
      where: { projectId },
      select: {
        content: true,
        updatedAt: true,
        updatedBy: { select: { id: true, name: true } },
      },
    });

    // Baseline for "since when do we count changes": the document's own
    // updatedAt when it exists, otherwise the project's creation time (so a
    // never-written document reports "everything that's happened in this
    // project so far" rather than an arbitrary epoch-sized number).
    const baseline = row?.updatedAt ?? project.createdAt;
    const staleness = await this.computeStaleness(projectId, baseline);

    return toDto(row, staleness);
  }

  /**
   * Create or replace the project's agent-context document. Requires
   * EFFECTIVE project MEMBER+ (a per-project role override, when present,
   * governs this the same as every other project-scoped write).
   */
  async upsert(
    userId: string,
    projectId: string,
    dto: UpsertAgentContextDto,
  ): Promise<ProjectAgentContextDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.MEMBER);

    const row = await this.prisma.projectAgentContext.upsert({
      where: { projectId },
      create: { projectId, content: dto.content, updatedById: userId },
      update: { content: dto.content, updatedById: userId },
      select: {
        content: true,
        updatedAt: true,
        updatedBy: { select: { id: true, name: true } },
      },
    });

    this.realtime.emitToProject(projectId, SocketEvents.ProjectAgentContextUpdated, {
      projectId,
    });

    // Recompute against the fresh updatedAt — changesSinceUpdate is 0 by
    // construction (nothing can be newer than the write that just happened),
    // but lastProjectActivityAt should still reflect real project history.
    const staleness = await this.computeStaleness(projectId, row.updatedAt);
    return toDto(row, staleness);
  }

  /**
   * Approximate, cheap "how much has this project changed since `since`"
   * count, combining two sources that already exist in the schema:
   *
   *  1. `ActivityLog` rows for any issue in this project (issue creation +
   *     every logged field change — status/assignee/priority/title/etc.;
   *     see `IssuesService`) newer than `since`.
   *  2. `AuditEvent` rows scoped to this project (matched via the JSON
   *     `metadata.projectId` field every project-scoped audit write already
   *     sets — webhook/GitHub/GitLab/role-override config changes) newer
   *     than `since`.
   *
   * This is deliberately NOT exhaustive — comment bodies, for example,
   * aren't separately logged to ActivityLog — so it undercounts rather than
   * overcounts. That's the honest tradeoff for a cheap, single-purpose
   * "should I double-check this handoff?" signal, not an audit log.
   */
  async computeStaleness(
    projectId: string,
    since: Date,
  ): Promise<{ changesSinceUpdate: number; lastProjectActivityAt: Date | null }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });

    const [activityCount, latestActivity, auditCount, latestAudit] = await Promise.all([
      this.prisma.activityLog.count({
        where: { issue: { projectId }, createdAt: { gt: since } },
      }),
      this.prisma.activityLog.findFirst({
        where: { issue: { projectId } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      project
        ? this.prisma.auditEvent.count({
            where: {
              workspaceId: project.workspaceId,
              createdAt: { gt: since },
              metadata: { path: ['projectId'], equals: projectId },
            },
          })
        : Promise.resolve(0),
      project
        ? this.prisma.auditEvent.findFirst({
            where: {
              workspaceId: project.workspaceId,
              metadata: { path: ['projectId'], equals: projectId },
            },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          })
        : Promise.resolve(null),
    ]);

    const lastProjectActivityAt = [latestActivity?.createdAt, latestAudit?.createdAt]
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    return {
      changesSinceUpdate: activityCount + auditCount,
      lastProjectActivityAt,
    };
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, QuickLink } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  MyWorkDto,
  MyWorkIssueDto,
  IssueType,
  Priority,
  StatusCategory,
  SprintState,
  QuickLinkDto,
} from '@next-lane/shared';
import { CreateQuickLinkDto, UpdateQuickLinkDto } from './dto/quick-link.dto';

/** Max issues returned per group (assigned / reported). */
const RESULT_CAP = 100;

/** Columns selected for a My Work row. */
const myWorkSelect = {
  id: true,
  number: true,
  title: true,
  type: true,
  priority: true,
  projectId: true,
  statusId: true,
  dueDate: true,
  updatedAt: true,
  project: { select: { key: true } },
  status: { select: { name: true, category: true } },
  sprint: { select: { name: true, state: true } },
} satisfies Prisma.IssueSelect;

type MyWorkRow = Prisma.IssueGetPayload<{ select: typeof myWorkSelect }>;

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The caller's personal work across every workspace/project they belong to.
   *
   * Scoping is enforced exactly like cross-project search: we derive the
   * caller's workspace ids from their memberships and constrain every issue
   * query to projects in those workspaces, so a row can never come from another
   * tenant's data. Issues are additionally filtered by the caller being the
   * assignee (assigned group) or reporter (reported group).
   */
  async getMyWork(userId: string): Promise<MyWorkDto> {
    // The only authorization boundary for the result set.
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    const workspaceIds = memberships.map((m) => m.workspaceId);

    if (workspaceIds.length === 0) {
      return { assigned: [], reported: [] };
    }

    const inMyWorkspaces: Prisma.IssueWhereInput = {
      project: { workspaceId: { in: workspaceIds } },
    };

    const [assigned, reported] = await Promise.all([
      this.prisma.issue.findMany({
        where: { ...inMyWorkspaces, assigneeId: userId },
        take: RESULT_CAP,
        orderBy: { updatedAt: 'desc' },
        select: myWorkSelect,
      }),
      this.prisma.issue.findMany({
        where: { ...inMyWorkspaces, reporterId: userId },
        take: RESULT_CAP,
        orderBy: { updatedAt: 'desc' },
        select: myWorkSelect,
      }),
    ]);

    return {
      assigned: assigned.map(toMyWorkIssue),
      reported: reported.map(toMyWorkIssue),
    };
  }

  // ── Quick links ───────────────────────────────────────────────────────────
  //
  // Personal shortcuts to external apps, shown in the header. Every query is
  // scoped to the caller's userId, so a user can only ever see or mutate their
  // own links.

  /** List the caller's quick links, ordered for display. */
  async listQuickLinks(userId: string): Promise<QuickLinkDto[]> {
    const links = await this.prisma.quickLink.findMany({
      where: { userId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return links.map(toQuickLinkDto);
  }

  /** Create a quick link, appended after the caller's existing links. */
  async createQuickLink(
    userId: string,
    dto: CreateQuickLinkDto,
  ): Promise<QuickLinkDto> {
    const last = await this.prisma.quickLink.findFirst({
      where: { userId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const nextOrder = last ? last.order + 1 : 0;

    const link = await this.prisma.quickLink.create({
      data: {
        userId,
        label: dto.label,
        url: dto.url,
        color: dto.color ?? null,
        group: dto.group ?? null,
        order: nextOrder,
      },
    });
    return toQuickLinkDto(link);
  }

  /** Update one of the caller's quick links. */
  async updateQuickLink(
    userId: string,
    id: string,
    dto: UpdateQuickLinkDto,
  ): Promise<QuickLinkDto> {
    await this.assertOwnedQuickLink(userId, id);

    const data: Prisma.QuickLinkUpdateInput = {};
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.url !== undefined) data.url = dto.url;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.group !== undefined) data.group = dto.group;
    if (dto.order !== undefined) data.order = dto.order;

    const link = await this.prisma.quickLink.update({ where: { id }, data });
    return toQuickLinkDto(link);
  }

  /** Delete one of the caller's quick links. */
  async deleteQuickLink(userId: string, id: string): Promise<{ id: string }> {
    await this.assertOwnedQuickLink(userId, id);
    await this.prisma.quickLink.delete({ where: { id } });
    return { id };
  }

  /** Throws NotFound unless the quick link exists and belongs to the caller. */
  private async assertOwnedQuickLink(
    userId: string,
    id: string,
  ): Promise<void> {
    const existing = await this.prisma.quickLink.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Quick link not found');
    }
  }
}

function toQuickLinkDto(l: QuickLink): QuickLinkDto {
  return {
    id: l.id,
    label: l.label,
    url: l.url,
    color: l.color,
    group: l.group,
    order: l.order,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

function toMyWorkIssue(r: MyWorkRow): MyWorkIssueDto {
  return {
    id: r.id,
    key: `${r.project.key}-${r.number}`,
    number: r.number,
    title: r.title,
    type: r.type as IssueType,
    priority: r.priority as Priority,
    projectId: r.projectId,
    projectKey: r.project.key,
    statusId: r.statusId,
    statusName: r.status.name,
    statusCategory: r.status.category as StatusCategory,
    sprintName: r.sprint?.name ?? null,
    sprintState: (r.sprint?.state as SprintState | undefined) ?? null,
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

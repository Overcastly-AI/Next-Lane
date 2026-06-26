import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  assertProjectMember,
  assertProjectRole,
  assertWorkspaceMember,
} from '../common/membership.util';
import { toIssueDto } from './issue.mapper';
import { toUserDto } from '../auth/auth.service';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { MoveIssueDto, ListIssuesQueryDto } from './dto/move-issue.dto';
import {
  SocketEvents,
  StatusCategory,
  initialRanks,
  rankAfter,
  rankBetween,
  Role,
} from '@next-lane/shared';
import type { IssueDto, CommentDto, ActivityDto } from '@next-lane/shared';

const listInclude = {
  status: true,
  assignee: true,
  reporter: true,
  labels: { include: { label: true } },
  project: { select: { key: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.IssueInclude;

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * When an `assigneeId` is provided (non-null), reject it unless that user is a
   * member of the project's workspace. Without this, any authenticated user from
   * any tenant could be set as assignee on another tenant's issue. `null` is
   * allowed (explicit unassign). `undefined` means "no change" and is skipped.
   */
  private async assertAssigneeInWorkspace(
    workspaceId: string,
    assigneeId: string | null | undefined,
  ): Promise<void> {
    if (assigneeId == null) return;
    await assertWorkspaceMember(this.prisma, assigneeId, workspaceId);
  }

  async create(userId: string, dto: CreateIssueDto): Promise<IssueDto> {
    const project = await assertProjectRole(
      this.prisma,
      userId,
      dto.projectId,
      Role.MEMBER,
    );
    await this.assertAssigneeInWorkspace(project.workspaceId, dto.assigneeId);

    const issue = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.update({
        where: { id: dto.projectId },
        data: { issueSeq: { increment: 1 } },
      });
      const number = project.issueSeq;

      let statusId = dto.statusId;
      if (!statusId) {
        const todo = await tx.status.findFirst({
          where: { projectId: dto.projectId, category: StatusCategory.TODO },
          orderBy: { order: 'asc' },
        });
        const first =
          todo ??
          (await tx.status.findFirst({
            where: { projectId: dto.projectId },
            orderBy: { order: 'asc' },
          }));
        if (!first) {
          throw new NotFoundException('Project has no statuses');
        }
        statusId = first.id;
      }

      const last = await tx.issue.findFirst({
        where: { statusId },
        orderBy: { rank: 'desc' },
      });
      const rank = rankAfter(last?.rank ?? null);

      const created = await tx.issue.create({
        data: {
          number,
          projectId: dto.projectId,
          type: dto.type,
          title: dto.title,
          description: dto.description,
          statusId,
          assigneeId: dto.assigneeId,
          reporterId: userId,
          priority: dto.priority,
          parentId: dto.parentId,
          sprintId: dto.sprintId,
          storyPoints: dto.storyPoints,
          rank,
        },
        include: listInclude,
      });

      await tx.activityLog.create({
        data: {
          issueId: created.id,
          actorId: userId,
          field: 'created',
          from: null,
          to: null,
        },
      });

      return created;
    });

    const dtoOut = toIssueDto(issue);
    this.realtime.emitToProject(
      issue.projectId,
      SocketEvents.IssueCreated,
      dtoOut,
    );
    if (dtoOut.assigneeId) {
      await this.notifyAssignment(userId, dtoOut.assigneeId, dtoOut);
    }
    return dtoOut;
  }

  /**
   * Notify a newly-set assignee and auto-watch them. Resolves the actor's name
   * for a friendly message. Never notifies self-assignment (handled downstream).
   */
  private async notifyAssignment(
    actorId: string,
    assigneeId: string,
    issue: IssueDto,
  ): Promise<void> {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });
    await this.notifications.notifyAssigned({
      assigneeId,
      actorId,
      actorName: actor?.name ?? 'Someone',
      issue: { id: issue.id, key: issue.key, projectId: issue.projectId },
    });
  }

  async findAll(
    userId: string,
    query: ListIssuesQueryDto,
  ): Promise<IssueDto[]> {
    if (!query.projectId) {
      throw new BadRequestException('projectId is required');
    }
    await assertProjectMember(this.prisma, userId, query.projectId);

    const where: Prisma.IssueWhereInput = { projectId: query.projectId };
    if (query.sprintId) where.sprintId = query.sprintId;
    if (query.assigneeId) where.assigneeId = query.assigneeId;
    if (query.type) where.type = query.type as Prisma.IssueWhereInput['type'];
    if (query.statusId) where.statusId = query.statusId;
    if (query.q) {
      where.title = { contains: query.q, mode: 'insensitive' };
    }

    const issues = await this.prisma.issue.findMany({
      where,
      include: listInclude,
      orderBy: { rank: 'asc' },
    });
    return issues.map(toIssueDto);
  }

  async findOne(
    userId: string,
    id: string,
  ): Promise<IssueDto & { comments: CommentDto[]; activities: ActivityDto[] }> {
    const refSelect = {
      id: true,
      number: true,
      type: true,
      title: true,
      statusId: true,
      project: { select: { key: true } },
      status: true,
    } satisfies Prisma.IssueSelect;

    const issue = await this.prisma.issue.findUnique({
      where: { id },
      include: {
        ...listInclude,
        comments: { include: { author: true }, orderBy: { createdAt: 'asc' } },
        activities: { include: { actor: true }, orderBy: { createdAt: 'desc' } },
        parent: { select: refSelect },
        children: { select: refSelect, orderBy: { rank: 'asc' } },
      },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    await assertProjectMember(this.prisma, userId, issue.projectId);

    const base = toIssueDto(issue);
    const comments: CommentDto[] = issue.comments.map((c) => ({
      id: c.id,
      body: c.body,
      issueId: c.issueId,
      author: toUserDto(c.author),
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));
    const activities: ActivityDto[] = issue.activities.map((a) => ({
      id: a.id,
      issueId: a.issueId,
      actor: toUserDto(a.actor),
      field: a.field,
      from: a.from,
      to: a.to,
      createdAt: a.createdAt.toISOString(),
    }));
    return { ...base, comments, activities };
  }

  async getActivity(userId: string, id: string): Promise<ActivityDto[]> {
    const issue = await this.prisma.issue.findUnique({ where: { id } });
    if (!issue) throw new NotFoundException('Issue not found');
    await assertProjectMember(this.prisma, userId, issue.projectId);
    const activities = await this.prisma.activityLog.findMany({
      where: { issueId: id },
      include: { actor: true },
      orderBy: { createdAt: 'desc' },
    });
    return activities.map((a) => ({
      id: a.id,
      issueId: a.issueId,
      actor: toUserDto(a.actor),
      field: a.field,
      from: a.from,
      to: a.to,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  /**
   * Reject any referenced id that does not belong to `projectId`. Guards against
   * a member of one project attaching their issue to another project's
   * status/sprint/parent (or reordering against a foreign issue), which would
   * corrupt foreign boards and leak their rank ordering.
   */
  private async assertSameProject(
    projectId: string,
    refs: {
      statusId?: string | null;
      sprintId?: string | null;
      parentId?: string | null;
      issueId?: string | null;
    },
  ): Promise<void> {
    const checks: Array<Promise<void>> = [];

    if (refs.statusId != null) {
      const statusId = refs.statusId;
      checks.push(
        this.prisma.status
          .findUnique({ where: { id: statusId }, select: { projectId: true } })
          .then((status) => {
            if (!status || status.projectId !== projectId) {
              throw new BadRequestException(
                'statusId does not belong to this project',
              );
            }
          }),
      );
    }

    if (refs.sprintId != null) {
      const sprintId = refs.sprintId;
      checks.push(
        this.prisma.sprint
          .findUnique({ where: { id: sprintId }, select: { projectId: true } })
          .then((sprint) => {
            if (!sprint || sprint.projectId !== projectId) {
              throw new BadRequestException(
                'sprintId does not belong to this project',
              );
            }
          }),
      );
    }

    if (refs.parentId != null) {
      const parentId = refs.parentId;
      checks.push(
        this.prisma.issue
          .findUnique({ where: { id: parentId }, select: { projectId: true } })
          .then((parent) => {
            if (!parent || parent.projectId !== projectId) {
              throw new BadRequestException(
                'parentId does not belong to this project',
              );
            }
          }),
      );
    }

    if (refs.issueId != null) {
      const issueId = refs.issueId;
      checks.push(
        this.prisma.issue
          .findUnique({ where: { id: issueId }, select: { projectId: true } })
          .then((neighbor) => {
            if (!neighbor || neighbor.projectId !== projectId) {
              throw new BadRequestException(
                'neighbor issue does not belong to this project',
              );
            }
          }),
      );
    }

    await Promise.all(checks);
  }

  /**
   * Reject a parent assignment that would create a cycle. A cycle happens if the
   * proposed parent is the issue itself, or if the issue is an ancestor of the
   * proposed parent (i.e. walking up from `parentId` reaches `id`). We walk the
   * ancestor chain with a hop cap as a defensive guard against any pre-existing
   * corrupt data.
   */
  private async assertNoParentCycle(
    id: string,
    parentId: string,
  ): Promise<void> {
    if (parentId === id) {
      throw new BadRequestException('An issue cannot be its own parent');
    }
    let cursor: string | null = parentId;
    let hops = 0;
    while (cursor && hops < 1000) {
      if (cursor === id) {
        throw new BadRequestException(
          'parentId would create a cycle in the issue hierarchy',
        );
      }
      const next: { parentId: string | null } | null =
        await this.prisma.issue.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      cursor = next?.parentId ?? null;
      hops += 1;
    }
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateIssueDto,
  ): Promise<IssueDto> {
    const existing = await this.prisma.issue.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Issue not found');
    const project = await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.MEMBER,
    );

    await this.assertSameProject(existing.projectId, {
      statusId: dto.statusId,
      sprintId: dto.sprintId,
      parentId: dto.parentId,
    });
    if (dto.parentId != null) {
      await this.assertNoParentCycle(id, dto.parentId);
    }
    await this.assertAssigneeInWorkspace(project.workspaceId, dto.assigneeId);

    const activities: Prisma.ActivityLogCreateManyInput[] = [];
    if (dto.statusId !== undefined && dto.statusId !== existing.statusId) {
      activities.push({
        issueId: id,
        actorId: userId,
        field: 'status',
        from: existing.statusId,
        to: dto.statusId,
      });
    }
    if (
      dto.assigneeId !== undefined &&
      dto.assigneeId !== existing.assigneeId
    ) {
      activities.push({
        issueId: id,
        actorId: userId,
        field: 'assignee',
        from: existing.assigneeId,
        to: dto.assigneeId,
      });
    }
    if (dto.priority !== undefined && dto.priority !== existing.priority) {
      activities.push({
        issueId: id,
        actorId: userId,
        field: 'priority',
        from: existing.priority,
        to: dto.priority,
      });
    }

    const issue = await this.prisma.issue.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        type: dto.type,
        statusId: dto.statusId,
        assigneeId: dto.assigneeId,
        priority: dto.priority,
        storyPoints: dto.storyPoints,
        parentId: dto.parentId,
        sprintId: dto.sprintId,
      },
      include: listInclude,
    });

    if (activities.length > 0) {
      await this.prisma.activityLog.createMany({ data: activities });
    }

    const dtoOut = toIssueDto(issue);
    this.realtime.emitToProject(
      issue.projectId,
      SocketEvents.IssueUpdated,
      dtoOut,
    );
    if (
      dto.assigneeId != null &&
      dto.assigneeId !== existing.assigneeId
    ) {
      await this.notifyAssignment(userId, dto.assigneeId, dtoOut);
    }
    return dtoOut;
  }

  /**
   * Collision fallback for {@link move}: when the requested neighbors leave no
   * representable gap, re-rank every issue in the destination column with fresh,
   * evenly spaced ranks. The moved issue (`id`) is positioned immediately before
   * `beforeId` (or appended to the end when `beforeId` is null). Returns the
   * rank the moved issue should receive; the caller persists it together with
   * the status change. Runs on the supplied transaction client so the rebalance
   * and the move commit atomically.
   */
  private async rebalanceAndPlace(
    tx: Prisma.TransactionClient,
    id: string,
    statusId: string,
    beforeId: string | null,
  ): Promise<string> {
    const column = await tx.issue.findMany({
      where: { statusId, id: { not: id } },
      orderBy: { rank: 'asc' },
      select: { id: true },
    });

    const order: string[] = [];
    let inserted = false;
    for (const issue of column) {
      if (issue.id === beforeId) {
        order.push(id);
        inserted = true;
      }
      order.push(issue.id);
    }
    if (!inserted) order.push(id);

    const ranks = initialRanks(order.length);
    let movedRank: string | null = null;
    for (let i = 0; i < order.length; i += 1) {
      if (order[i] === id) {
        movedRank = ranks[i];
        continue; // caller writes the moved issue's rank + status together
      }
      await tx.issue.update({
        where: { id: order[i] },
        data: { rank: ranks[i] },
      });
    }
    // order always contains `id`, so movedRank is assigned above.
    return movedRank as string;
  }

  async move(
    userId: string,
    id: string,
    dto: MoveIssueDto,
  ): Promise<IssueDto> {
    const existing = await this.prisma.issue.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Issue not found');
    await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.MEMBER,
    );

    await this.assertSameProject(existing.projectId, {
      statusId: dto.statusId,
      issueId: dto.beforeId,
    });
    await this.assertSameProject(existing.projectId, {
      issueId: dto.afterId,
    });

    const statusChanged = dto.statusId !== existing.statusId;

    // Read neighbor ranks, compute the new rank, and persist inside a single
    // transaction. Doing the read + compute + write atomically prevents two
    // concurrent moves from both reading the same neighbors and computing
    // colliding ranks (lost-update / TOCTOU). If the neighbors leave no gap
    // (equal, or already adjacent so `rankBetween` would throw), we fall back
    // to rebalancing every issue in the destination column with fresh, evenly
    // spaced ranks — still within the transaction — and re-derive the moved
    // issue's rank from the rebalanced order.
    const issue = await this.prisma.$transaction(async (tx) => {
      let beforeRank: string | null = null;
      let afterRank: string | null = null;
      if (dto.beforeId) {
        const before = await tx.issue.findUnique({
          where: { id: dto.beforeId },
        });
        beforeRank = before?.rank ?? null;
      }
      if (dto.afterId) {
        const after = await tx.issue.findUnique({
          where: { id: dto.afterId },
        });
        afterRank = after?.rank ?? null;
      }

      let newRank: string;
      try {
        newRank = rankBetween(beforeRank, afterRank);
      } catch {
        newRank = await this.rebalanceAndPlace(
          tx,
          id,
          dto.statusId,
          dto.beforeId ?? null,
        );
      }

      const updated = await tx.issue.update({
        where: { id },
        data: { statusId: dto.statusId, rank: newRank },
        include: listInclude,
      });

      if (statusChanged) {
        await tx.activityLog.create({
          data: {
            issueId: id,
            actorId: userId,
            field: 'status',
            from: existing.statusId,
            to: dto.statusId,
          },
        });
      }

      return updated;
    });

    this.realtime.emitToProject(issue.projectId, SocketEvents.IssueMoved, {
      issueId: issue.id,
      statusId: issue.statusId,
      rank: issue.rank,
    });
    return toIssueDto(issue);
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    const existing = await this.prisma.issue.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Issue not found');
    await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.MEMBER,
    );

    await this.prisma.issue.delete({ where: { id } });
    this.realtime.emitToProject(
      existing.projectId,
      SocketEvents.IssueDeleted,
      { issueId: id },
    );
    return { id };
  }
}

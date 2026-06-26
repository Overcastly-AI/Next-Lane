import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import { toIssueDto } from './issue.mapper';
import { toUserDto } from '../auth/auth.service';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { MoveIssueDto, ListIssuesQueryDto } from './dto/move-issue.dto';
import {
  SocketEvents,
  StatusCategory,
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
  ) {}

  async create(userId: string, dto: CreateIssueDto): Promise<IssueDto> {
    await assertProjectRole(this.prisma, userId, dto.projectId, Role.MEMBER);

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
    return dtoOut;
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
    const issue = await this.prisma.issue.findUnique({
      where: { id },
      include: {
        ...listInclude,
        comments: { include: { author: true }, orderBy: { createdAt: 'asc' } },
        activities: { include: { actor: true }, orderBy: { createdAt: 'desc' } },
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

  async update(
    userId: string,
    id: string,
    dto: UpdateIssueDto,
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
      sprintId: dto.sprintId,
      parentId: dto.parentId,
    });

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
    return dtoOut;
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

    let beforeRank: string | null = null;
    let afterRank: string | null = null;
    if (dto.beforeId) {
      const before = await this.prisma.issue.findUnique({
        where: { id: dto.beforeId },
      });
      beforeRank = before?.rank ?? null;
    }
    if (dto.afterId) {
      const after = await this.prisma.issue.findUnique({
        where: { id: dto.afterId },
      });
      afterRank = after?.rank ?? null;
    }
    const newRank = rankBetween(beforeRank, afterRank);
    const statusChanged = dto.statusId !== existing.statusId;

    const issue = await this.prisma.issue.update({
      where: { id },
      data: { statusId: dto.statusId, rank: newRank },
      include: listInclude,
    });

    if (statusChanged) {
      await this.prisma.activityLog.create({
        data: {
          issueId: id,
          actorId: userId,
          field: 'status',
          from: existing.statusId,
          to: dto.statusId,
        },
      });
    }

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

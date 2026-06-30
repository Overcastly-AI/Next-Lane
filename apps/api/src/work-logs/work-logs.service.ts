import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import { Role } from '@next-lane/shared';
import { toUserDto } from '../auth/auth.service';
import type { WorkLogDto } from '@next-lane/shared';
import { CreateWorkLogDto, UpdateWorkLogDto } from './dto/work-log.dto';

/** Map a Prisma WorkLog row (with user included) to a `WorkLogDto`. */
export function toWorkLogDto(workLog: {
  id: string;
  issueId: string;
  userId: string;
  user: {
    id: string;
    email: string;
    name: string;
    avatarColor: string;
    emailNotifications: boolean;
    createdAt: Date;
  };
  minutes: number;
  note: string | null;
  workedAt: Date;
  createdAt: Date;
}): WorkLogDto {
  return {
    id: workLog.id,
    issueId: workLog.issueId,
    userId: workLog.userId,
    user: toUserDto(workLog.user),
    minutes: workLog.minutes,
    note: workLog.note,
    workedAt: workLog.workedAt.toISOString(),
    createdAt: workLog.createdAt.toISOString(),
  };
}

@Injectable()
export class WorkLogsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Load an issue (with projectId) and throw 404 if not found. */
  private async getIssue(
    issueId: string,
  ): Promise<{ id: string; projectId: string }> {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { id: true, projectId: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    return issue;
  }

  /**
   * Load a workLog (with its issue projectId and the userId of the author)
   * and throw 404 if not found. Callers then verify membership/authorship.
   */
  private async getWorkLog(workLogId: string): Promise<{
    id: string;
    issueId: string;
    userId: string;
    projectId: string;
  }> {
    const workLog = await this.prisma.workLog.findUnique({
      where: { id: workLogId },
      select: {
        id: true,
        issueId: true,
        userId: true,
        issue: { select: { projectId: true } },
      },
    });
    if (!workLog) throw new NotFoundException('Work log not found');
    return {
      id: workLog.id,
      issueId: workLog.issueId,
      userId: workLog.userId,
      projectId: workLog.issue.projectId,
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async findAll(
    userId: string,
    issueId: string,
  ): Promise<WorkLogDto[]> {
    const issue = await this.getIssue(issueId);
    await assertProjectMember(this.prisma, userId, issue.projectId);

    const workLogs = await this.prisma.workLog.findMany({
      where: { issueId },
      include: { user: true },
      orderBy: { workedAt: 'desc' },
    });

    return workLogs.map(toWorkLogDto);
  }

  async create(
    userId: string,
    issueId: string,
    dto: CreateWorkLogDto,
  ): Promise<WorkLogDto> {
    if (dto.minutes < 1) {
      throw new BadRequestException('minutes must be at least 1');
    }

    const issue = await this.getIssue(issueId);
    await assertProjectRole(this.prisma, userId, issue.projectId, Role.MEMBER);

    const workLog = await this.prisma.workLog.create({
      data: {
        issueId,
        userId,
        minutes: dto.minutes,
        note: dto.note ?? null,
        ...(dto.workedAt !== undefined
          ? { workedAt: new Date(dto.workedAt) }
          : {}),
      },
      include: { user: true },
    });

    return toWorkLogDto(workLog);
  }

  async update(
    userId: string,
    workLogId: string,
    dto: UpdateWorkLogDto,
  ): Promise<WorkLogDto> {
    const workLogRef = await this.getWorkLog(workLogId);

    // assertProjectMember throws ForbiddenException when not a member (404/403)
    // and returns the project (with workspace) so we can look up the role.
    const project = await assertProjectMember(
      this.prisma,
      userId,
      workLogRef.projectId,
    );

    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_workspaceId: { userId, workspaceId: project.workspaceId },
      },
      select: { role: true },
    });

    // membership cannot be null here (assertProjectMember already confirmed it),
    // but guard defensively to satisfy TypeScript and preserve 403 semantics.
    if (!membership) {
      throw new ForbiddenException('Not a member of this project');
    }

    const isAuthor = workLogRef.userId === userId;
    const isAdmin = membership.role === Role.ADMIN;

    if (!isAuthor && !isAdmin) {
      throw new ForbiddenException(
        'Only the author or a project admin can edit this work log',
      );
    }

    const workLog = await this.prisma.workLog.update({
      where: { id: workLogId },
      data: {
        ...(dto.minutes !== undefined ? { minutes: dto.minutes } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.workedAt !== undefined
          ? { workedAt: new Date(dto.workedAt) }
          : {}),
      },
      include: { user: true },
    });

    return toWorkLogDto(workLog);
  }

  async remove(userId: string, workLogId: string): Promise<void> {
    const workLogRef = await this.getWorkLog(workLogId);

    // assertProjectMember throws ForbiddenException when not a member (404/403)
    // and returns the project (with workspace) so we can look up the role.
    const project = await assertProjectMember(
      this.prisma,
      userId,
      workLogRef.projectId,
    );

    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_workspaceId: { userId, workspaceId: project.workspaceId },
      },
      select: { role: true },
    });

    if (!membership) {
      throw new ForbiddenException('Not a member of this project');
    }

    const isAuthor = workLogRef.userId === userId;
    const isAdmin = membership.role === Role.ADMIN;

    if (!isAuthor && !isAdmin) {
      throw new ForbiddenException(
        'Only the author or a project admin can delete this work log',
      );
    }

    await this.prisma.workLog.delete({ where: { id: workLogId } });
  }
}

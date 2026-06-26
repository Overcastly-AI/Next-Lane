import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertProjectMember } from '../common/membership.util';
import { toProjectDto } from '../projects/projects.service';
import { toStatusDto } from '../statuses/statuses.service';
import { toIssueDto } from '../issues/issue.mapper';
import { SprintState } from '@next-lane/shared';
import type { BoardDto } from '@next-lane/shared';

const issueInclude = {
  status: true,
  assignee: true,
  reporter: true,
  labels: { include: { label: true } },
  project: { select: { key: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.IssueInclude;

@Injectable()
export class BoardService {
  constructor(private readonly prisma: PrismaService) {}

  async getBoard(userId: string, projectId: string): Promise<BoardDto> {
    const project = await assertProjectMember(this.prisma, userId, projectId);

    const statuses = await this.prisma.status.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });

    const issues = await this.prisma.issue.findMany({
      where: {
        projectId,
        project: { archived: false },
        OR: [
          { sprintId: null },
          { sprint: { state: SprintState.ACTIVE } },
        ],
      },
      include: issueInclude,
      orderBy: [{ status: { order: 'asc' } }, { rank: 'asc' }],
    });

    return {
      project: toProjectDto(project),
      statuses: statuses.map(toStatusDto),
      issues: issues.map(toIssueDto),
    };
  }
}

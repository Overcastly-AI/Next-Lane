import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertProjectMember } from '../common/membership.util';
import { toProjectDto } from '../projects/projects.service';
import { toStatusDto } from '../statuses/statuses.service';
import { toIssueDto } from '../issues/issue.mapper';
import { SprintState } from '@next-lane/shared';
import type { BoardDto } from '@next-lane/shared';

/**
 * Maximum number of issues returned in a single board response.
 * Prevents OOM on projects with thousands of issues. When the cap is hit,
 * `issuesTruncated` is set to true in the response so the UI can inform
 * the user that results are partial.
 */
export const BOARD_ISSUES_CAP = 500;

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

    // Fetch one extra row beyond the cap so we can detect truncation without a
    // separate COUNT query. If we get CAP+1 rows we slice to CAP and set the flag.
    const rows = await this.prisma.issue.findMany({
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
      take: BOARD_ISSUES_CAP + 1,
    });

    const issuesTruncated = rows.length > BOARD_ISSUES_CAP;
    const issues = issuesTruncated ? rows.slice(0, BOARD_ISSUES_CAP) : rows;

    return {
      project: toProjectDto(project),
      statuses: statuses.map(toStatusDto),
      issues: issues.map(toIssueDto),
      issuesTruncated,
    };
  }
}

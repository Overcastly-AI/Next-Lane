import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  MyWorkDto,
  MyWorkIssueDto,
  IssueType,
  Priority,
  StatusCategory,
  SprintState,
} from '@next-lane/shared';

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

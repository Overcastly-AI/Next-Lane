import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertProjectMember } from '../common/membership.util';
import { IssueType, StatusCategory, SprintState } from '@next-lane/shared';
import type {
  RoadmapDto,
  RoadmapEpicDto,
  SprintDto,
} from '@next-lane/shared';

/** Minimum of two dates that may be null (null is ignored). */
function minDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

/** Maximum of two dates that may be null (null is ignored). */
function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

@Injectable()
export class RoadmapService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stakeholder roadmap for a project: every epic with a derived time window and
   * completion progress, plus every dated sprint, on a shared timeline.
   *
   * An epic's window is derived from the sprints its child issues belong to —
   * earliest sprint start to latest sprint end. When no child has a dated
   * sprint, it falls back to the epic's own createdAt (a zero-width marker the
   * client can render). Epics with neither get a null window and are surfaced in
   * a "No dates" lane. Progress is the fraction of child issues currently in a
   * DONE-category status.
   *
   * No schema change is needed; everything is derived from existing data. Read
   * only and membership-authorized: VIEWERs can see it.
   */
  async getRoadmap(userId: string, projectId: string): Promise<RoadmapDto> {
    const project = await assertProjectMember(this.prisma, userId, projectId);
    const projectKey = project.key;

    const doneStatusIds = await this.doneStatusIds(projectId);

    // All epics with their children's status + sprint window. Children are the
    // direct sub-issues (stories/tasks) parented to the epic.
    const epicRows = await this.prisma.issue.findMany({
      where: { projectId, type: IssueType.EPIC },
      orderBy: [{ createdAt: 'asc' }],
      include: {
        status: { select: { category: true } },
        children: {
          select: {
            statusId: true,
            sprint: { select: { startDate: true, endDate: true } },
          },
        },
      },
    });

    const epics: RoadmapEpicDto[] = epicRows.map((epic) => {
      const childCount = epic.children.length;
      let doneCount = 0;
      let start: Date | null = null;
      let end: Date | null = null;
      let fromSprints = false;

      for (const child of epic.children) {
        if (doneStatusIds.has(child.statusId)) doneCount += 1;
        const s = child.sprint?.startDate ?? null;
        const e = child.sprint?.endDate ?? null;
        if (s || e) {
          fromSprints = true;
          start = minDate(start, s ?? e);
          end = maxDate(end, e ?? s);
        }
      }

      // Fall back to the epic's own createdAt when no child sprint dates exist,
      // so a freshly created epic still appears on the timeline.
      if (!fromSprints) {
        start = epic.createdAt;
        end = epic.createdAt;
      }

      return {
        id: epic.id,
        key: `${projectKey}-${epic.number}`,
        title: epic.title,
        statusCategory: epic.status.category as StatusCategory,
        childCount,
        doneCount,
        progress: childCount === 0 ? 0 : doneCount / childCount,
        start: start ? start.toISOString() : null,
        end: end ? end.toISOString() : null,
        fromSprints,
      };
    });

    // Dated sprints only — an undated sprint has no place on the time axis.
    const sprintRows = await this.prisma.sprint.findMany({
      where: {
        projectId,
        OR: [{ startDate: { not: null } }, { endDate: { not: null } }],
      },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    });

    const sprints: SprintDto[] = sprintRows.map((s) => ({
      id: s.id,
      name: s.name,
      goal: s.goal,
      state: s.state as SprintState,
      startDate: s.startDate ? s.startDate.toISOString() : null,
      endDate: s.endDate ? s.endDate.toISOString() : null,
      projectId: s.projectId,
    }));

    return { projectId, epics, sprints };
  }

  /** Set of status IDs in the project whose category is DONE. */
  private async doneStatusIds(projectId: string): Promise<Set<string>> {
    const rows = await this.prisma.status.findMany({
      where: { projectId, category: StatusCategory.DONE },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }
}

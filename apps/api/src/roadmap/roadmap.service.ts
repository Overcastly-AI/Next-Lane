import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertProjectMember } from '../common/membership.util';
import { IssueType, StatusCategory, SprintState } from '@next-lane/shared';
import type {
  RoadmapDto,
  RoadmapEpicDto,
  SprintDto,
} from '@next-lane/shared';

/**
 * Maximum number of epics returned in a single roadmap response.
 * Prevents OOM on projects with a very large epic backlog. When the cap is
 * hit, `epicsTruncated` is set to true so the UI can inform the user.
 */
export const ROADMAP_EPICS_CAP = 500;

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
   * An epic's window is derived, in priority order:
   *   1. The epic issue's own `startDate` → `dueDate` (or `startDate` alone
   *      when no due date is set), when `startDate` is present — this lets an
   *      agent or user plan an epic directly instead of it being purely a
   *      derived rollup of its children's sprints.
   *   2. The sprints its child issues belong to — earliest sprint start to
   *      latest sprint end.
   *   3. The epic's own `createdAt` (a zero-width marker the client can
   *      render) when neither of the above applies.
   * Epics with no date context at all get a null window and are surfaced in a
   * "No dates" lane. Progress is the fraction of child issues currently in a
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
    // Fetch one extra row beyond the cap to detect truncation without a COUNT.
    const epicRowsFetched = await this.prisma.issue.findMany({
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
      take: ROADMAP_EPICS_CAP + 1,
    });

    const epicsTruncated = epicRowsFetched.length > ROADMAP_EPICS_CAP;
    const epicRows = epicsTruncated
      ? epicRowsFetched.slice(0, ROADMAP_EPICS_CAP)
      : epicRowsFetched;

    const epics: RoadmapEpicDto[] = epicRows.map((epic) => {
      const childCount = epic.children.length;
      let doneCount = 0;
      for (const child of epic.children) {
        if (doneStatusIds.has(child.statusId)) doneCount += 1;
      }

      let start: Date | null = null;
      let end: Date | null = null;
      let fromSprints = false;
      let fromOwnDates = false;

      if (epic.startDate) {
        // Highest priority: the epic issue's own start/due date range. A due
        // date isn't required — a start-only epic still gets a (zero-width)
        // marker rather than falling through to the sprint/createdAt logic.
        fromOwnDates = true;
        start = epic.startDate;
        end = epic.dueDate ?? epic.startDate;
      } else {
        for (const child of epic.children) {
          const s = child.sprint?.startDate ?? null;
          const e = child.sprint?.endDate ?? null;
          if (s || e) {
            fromSprints = true;
            start = minDate(start, s ?? e);
            end = maxDate(end, e ?? s);
          }
        }

        // Fall back to the epic's own createdAt when no child sprint dates
        // exist, so a freshly created epic still appears on the timeline.
        if (!fromSprints) {
          start = epic.createdAt;
          end = epic.createdAt;
        }
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
        fromOwnDates,
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

    return { projectId, epics, sprints, epicsTruncated };
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

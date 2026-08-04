import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertProjectMember } from '../common/membership.util';
import {
  IssueType,
  IssueLinkType,
  StatusCategory,
  SprintState,
  VersionState,
} from '@next-lane/shared';
import type {
  RoadmapChildDto,
  RoadmapDependencyDto,
  RoadmapDto,
  RoadmapEpicChildrenDto,
  RoadmapEpicDto,
  RoadmapMilestoneDto,
  SprintDto,
} from '@next-lane/shared';

/**
 * Maximum number of epics returned in a single roadmap response.
 * Prevents OOM on projects with a very large epic backlog. When the cap is
 * hit, `epicsTruncated` is set to true so the UI can inform the user.
 */
export const ROADMAP_EPICS_CAP = 500;

/** Maximum children returned when a single epic row is expanded. */
export const ROADMAP_EPIC_CHILDREN_CAP = 200;

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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days from `from` to `to`, rounded up, never negative. */
function wholeDaysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / MS_PER_DAY);
}

/** A child's scheduled window: its own dates first, its sprint's as fallback. */
function childWindow(child: {
  startDate: Date | null;
  dueDate: Date | null;
  sprint: { startDate: Date | null; endDate: Date | null } | null;
}): { start: Date | null; end: Date | null; fromSprint: boolean } {
  if (child.startDate || child.dueDate) {
    return {
      start: child.startDate ?? child.dueDate,
      end: child.dueDate ?? child.startDate,
      fromSprint: false,
    };
  }
  const s = child.sprint?.startDate ?? null;
  const e = child.sprint?.endDate ?? null;
  if (s || e) return { start: s ?? e, end: e ?? s, fromSprint: true };
  return { start: null, end: null, fromSprint: false };
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

    // All epics with their children's status, OWN dates, and sprint window.
    // Children are the direct sub-issues (stories/tasks) parented to the epic.
    //
    // `startDate`/`dueDate` on the child are the important part and were
    // missing until 2026-08-01: the rollup only ever looked at the child's
    // SPRINT, so a story with real dates that wasn't in a sprint contributed
    // nothing, and its epic sat at a zero-width `createdAt` marker. Reported
    // by the founder as "the dates do not trickle up to the epic level".
    //
    // Fetch one extra row beyond the cap to detect truncation without a COUNT.
    const epicRowsFetched = await this.prisma.issue.findMany({
      where: { projectId, type: IssueType.EPIC },
      orderBy: [{ createdAt: 'asc' }],
      include: {
        status: { select: { category: true } },
        children: {
          select: {
            statusId: true,
            startDate: true,
            dueDate: true,
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

      // ── What the children actually span ────────────────────────────────
      // Each child contributes its OWN dates when it has them, and falls back
      // to its sprint's dates when it doesn't. Own dates take precedence for
      // the same reason they do on the epic: an explicit date beats an
      // inherited one.
      let rollupStart: Date | null = null;
      let rollupEnd: Date | null = null;

      for (const child of epic.children) {
        const { start: cs, end: ce } = childWindow(child);
        if (!cs && !ce) continue;
        rollupStart = minDate(rollupStart, cs ?? ce);
        rollupEnd = maxDate(rollupEnd, ce ?? cs);
      }

      // ── What the bar draws ─────────────────────────────────────────────
      // The epic's own dates are a commitment and win outright. `dueDate`
      // alone counts too: an epic with only a deadline has stated something
      // real, and treating that as "no dates" (as this did before) dropped it
      // into the No-dates lane despite carrying the most important date on it.
      let start: Date | null = null;
      let end: Date | null = null;
      let fromOwnDates = false;
      // Keeps its original contract: "the DISPLAYED window was derived from
      // the children", not merely "the children are dated" — whether they are
      // dated is what `rollupStart`/`rollupEnd` are for. Repurposing it broke
      // an existing assertion, correctly.
      let fromSprints = false;

      if (epic.startDate || epic.dueDate) {
        fromOwnDates = true;
        start = epic.startDate ?? epic.dueDate;
        end = epic.dueDate ?? epic.startDate;
      } else if (rollupStart || rollupEnd) {
        fromSprints = true;
        start = rollupStart ?? rollupEnd;
        end = rollupEnd ?? rollupStart;
      } else {
        // Nothing anywhere: a zero-width marker at creation time, so a fresh
        // epic still appears on the timeline instead of vanishing.
        start = epic.createdAt;
        end = epic.createdAt;
      }

      // ── Where reality escapes the plan ─────────────────────────────────
      // Only meaningful when the epic states its own window; otherwise the
      // bar IS the rollup and can't overrun itself.
      let overrunDays = 0;
      let underrunDays = 0;
      let childrenOutside = 0;
      if (fromOwnDates && start && end) {
        if (rollupEnd && rollupEnd.getTime() > end.getTime()) {
          overrunDays = wholeDaysBetween(end, rollupEnd);
        }
        if (rollupStart && rollupStart.getTime() < start.getTime()) {
          underrunDays = wholeDaysBetween(rollupStart, start);
        }
        for (const child of epic.children) {
          const { start: cs, end: ce } = childWindow(child);
          if (!cs && !ce) continue;
          const lo = (cs ?? ce) as Date;
          const hi = (ce ?? cs) as Date;
          if (lo.getTime() < start.getTime() || hi.getTime() > end.getTime()) {
            childrenOutside += 1;
          }
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
        rollupStart: rollupStart ? rollupStart.toISOString() : null,
        rollupEnd: rollupEnd ? rollupEnd.toISOString() : null,
        overrunDays,
        underrunDays,
        childrenOutside,
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

    const [milestones, dependencies] = await Promise.all([
      this.milestones(projectId, doneStatusIds),
      this.dependencies(epics),
    ]);

    return {
      projectId,
      epics,
      sprints,
      milestones,
      dependencies,
      epicsTruncated,
    };
  }

  /**
   * Children of one epic, for expanding a roadmap row.
   *
   * A separate call rather than part of the roadmap payload on purpose: with
   * 500 epics the inline version could be tens of thousands of rows on a read
   * that most users never expand. This is paid for only when a row is opened.
   */
  async getEpicChildren(
    userId: string,
    projectId: string,
    epicId: string,
  ): Promise<RoadmapEpicChildrenDto> {
    const project = await assertProjectMember(this.prisma, userId, projectId);

    const epic = await this.prisma.issue.findFirst({
      where: { id: epicId, projectId, type: IssueType.EPIC },
      select: { id: true },
    });
    if (!epic) throw new NotFoundException('Epic not found in this project.');

    const rows = await this.prisma.issue.findMany({
      where: { parentId: epicId, projectId },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        number: true,
        title: true,
        type: true,
        startDate: true,
        dueDate: true,
        status: { select: { category: true } },
        sprint: { select: { name: true, startDate: true, endDate: true } },
      },
      take: ROADMAP_EPIC_CHILDREN_CAP + 1,
    });

    const truncated = rows.length > ROADMAP_EPIC_CHILDREN_CAP;
    const kept = truncated ? rows.slice(0, ROADMAP_EPIC_CHILDREN_CAP) : rows;

    const children: RoadmapChildDto[] = kept.map((c) => {
      const win = childWindow({
        startDate: c.startDate,
        dueDate: c.dueDate,
        sprint: c.sprint
          ? { startDate: c.sprint.startDate, endDate: c.sprint.endDate }
          : null,
      });
      return {
        id: c.id,
        key: `${project.key}-${c.number}`,
        title: c.title,
        type: c.type as IssueType,
        statusCategory: c.status.category as StatusCategory,
        start: win.start ? win.start.toISOString() : null,
        end: win.end ? win.end.toISOString() : null,
        fromSprint: win.fromSprint,
        sprintName: c.sprint?.name ?? null,
      };
    });

    return { epicId, children, truncated };
  }

  /**
   * Dated project versions as release markers. Nothing new is modelled — the
   * roadmap draws what release management already tracks.
   */
  private async milestones(
    projectId: string,
    doneStatusIds: Set<string>,
  ): Promise<RoadmapMilestoneDto[]> {
    const rows = await this.prisma.version.findMany({
      where: { projectId, releaseDate: { not: null } },
      orderBy: [{ releaseDate: 'asc' }],
      select: {
        id: true,
        name: true,
        releaseDate: true,
        state: true,
        issues: { select: { issue: { select: { statusId: true } } } },
      },
    });

    return rows.map((v) => ({
      id: v.id,
      name: v.name,
      // Safe: the `not: null` filter above guarantees this.
      releaseDate: (v.releaseDate as Date).toISOString(),
      state: v.state as VersionState,
      openIssueCount: v.issues.filter(
        (link) => !doneStatusIds.has(link.issue.statusId),
      ).length,
    }));
  }

  /**
   * BLOCKS relationships BETWEEN the epics on this roadmap.
   *
   * Only epic-to-epic links are drawn. A story blocking another story is real
   * and useful, but rendering it on a lane the story isn't on would be a line
   * pointing at nothing — those belong in the expanded child view.
   *
   * `violated` is what makes an arrow worth looking at: the blocker is
   * scheduled to finish after the epic it blocks is due to start, which is a
   * plan that cannot happen in the order it claims.
   */
  private async dependencies(
    epics: RoadmapEpicDto[],
  ): Promise<RoadmapDependencyDto[]> {
    if (epics.length === 0) return [];
    const byId = new Map(epics.map((e) => [e.id, e]));
    const ids = [...byId.keys()];

    // Every blocking relationship is STORED as BLOCKS with source = the
    // blocker: `IssueLinksService` normalizes a user's BLOCKED_BY into a
    // BLOCKS with the two ends swapped. So one query in one direction is the
    // complete set — querying both would double-count.
    const links = await this.prisma.issueLink.findMany({
      where: {
        type: IssueLinkType.BLOCKS,
        sourceId: { in: ids },
        targetId: { in: ids },
      },
      select: { sourceId: true, targetId: true },
    });

    return links.map((l) => {
      const from = byId.get(l.sourceId);
      const to = byId.get(l.targetId);
      const fromEnd = from?.end ? Date.parse(from.end) : null;
      const toStart = to?.start ? Date.parse(to.start) : null;
      return {
        fromEpicId: l.sourceId,
        toEpicId: l.targetId,
        violated:
          fromEnd !== null && toStart !== null ? fromEnd > toStart : false,
      };
    });
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

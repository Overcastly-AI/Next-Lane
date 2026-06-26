import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertProjectMember } from '../common/membership.util';
import { SprintState, StatusCategory } from '@next-lane/shared';
import type {
  VelocityPointDto,
  BurndownDto,
  BurndownPointDto,
} from '@next-lane/shared';

/** Story points are optional on issues; a null value contributes 0 points. */
function points(storyPoints: number | null): number {
  return storyPoints ?? 0;
}

/** UTC date key (YYYY-MM-DD) so day buckets are stable regardless of timezone. */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of day keys from `start` to `end` (UTC, by calendar day). */
function dayRange(start: Date, end: Date): string[] {
  const days: string[] = [];
  const cur = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  const last = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
  );
  // Cap the range so a misconfigured sprint window can't produce an enormous
  // series; 366 days is well beyond any realistic sprint.
  let guard = 0;
  while (cur.getTime() <= last.getTime() && guard < 366) {
    days.push(dayKey(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard += 1;
  }
  return days;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Velocity report: for every COMPLETED sprint plus the ACTIVE one (oldest →
   * newest), the committed story points (sum of all issues' storyPoints) and the
   * completed story points (issues that ended in a DONE-category status).
   *
   * Story points default to 0 when null. "Completed" is judged by the issue's
   * current status category — by the time a sprint is completed, incomplete
   * issues have been returned to the backlog, so the issues still attached to a
   * completed sprint are the ones that finished in it.
   */
  async velocity(
    userId: string,
    projectId: string,
  ): Promise<VelocityPointDto[]> {
    await assertProjectMember(this.prisma, userId, projectId);

    const doneStatusIds = await this.doneStatusIds(projectId);

    const sprints = await this.prisma.sprint.findMany({
      where: {
        projectId,
        state: { in: [SprintState.ACTIVE, SprintState.COMPLETED] },
      },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        issues: { select: { storyPoints: true, statusId: true } },
      },
    });

    return sprints.map((sprint) => {
      let committed = 0;
      let completed = 0;
      for (const issue of sprint.issues) {
        const p = points(issue.storyPoints);
        committed += p;
        if (doneStatusIds.has(issue.statusId)) completed += p;
      }
      return {
        sprintId: sprint.id,
        sprintName: sprint.name,
        state: sprint.state as SprintState,
        committed,
        completed,
      };
    });
  }

  /**
   * Burndown for a single sprint: a daily series over the sprint window
   * (startDate → endDate) with an ideal linear line from total committed points
   * down to 0, and the actual remaining points.
   *
   * Actual remaining is derived from ActivityLog: each issue with story points
   * is "burned down" on the day it transitioned INTO a DONE-category status
   * (the latest such transition wins, so a re-opened-then-redone issue burns on
   * its final completion). Issues completed before the window start are counted
   * as already done on day one; issues never transitioned via the log but
   * currently in a DONE status are credited on the final day so the actual line
   * reconciles with the velocity "completed" figure.
   */
  async burndown(
    userId: string,
    projectId: string,
    sprintId: string,
  ): Promise<BurndownDto> {
    await assertProjectMember(this.prisma, userId, projectId);

    const sprint = await this.prisma.sprint.findFirst({
      where: { id: sprintId, projectId },
      include: {
        issues: { select: { id: true, storyPoints: true, statusId: true } },
      },
    });
    if (!sprint) throw new NotFoundException('Sprint not found');

    const doneStatusIds = await this.doneStatusIds(projectId);

    const totalCommitted = sprint.issues.reduce(
      (sum, i) => sum + points(i.storyPoints),
      0,
    );

    // Window: fall back to the sprint's creation day if dates aren't set, and to
    // "today" for the end so an in-flight sprint still produces a sensible line.
    const start = sprint.startDate ?? sprint.createdAt;
    const end = sprint.endDate ?? new Date(Math.max(Date.now(), start.getTime()));
    const days = dayRange(start, end);

    // No window to plot (shouldn't happen given the fallbacks, but be safe).
    if (days.length === 0) {
      return {
        sprintId: sprint.id,
        sprintName: sprint.name,
        state: sprint.state as SprintState,
        startDate: sprint.startDate ? sprint.startDate.toISOString() : null,
        endDate: sprint.endDate ? sprint.endDate.toISOString() : null,
        totalCommitted,
        series: [],
      };
    }

    const pointsByIssue = new Map<string, number>();
    for (const issue of sprint.issues) {
      pointsByIssue.set(issue.id, points(issue.storyPoints));
    }

    // When each issue was completed (the latest transition into a DONE status).
    const completedAt = await this.completionDates(
      sprint.issues.map((i) => i.id),
      doneStatusIds,
    );

    // Credit issues currently in a DONE status that have no logged transition
    // (e.g. seeded or imported data) on the final day, so the actual line lands
    // on the same total the velocity report reports.
    const finalDay = days[days.length - 1];
    for (const issue of sprint.issues) {
      if (doneStatusIds.has(issue.statusId) && !completedAt.has(issue.id)) {
        completedAt.set(issue.id, finalDay);
      }
    }

    // Burned points per day key (clamping early completions to the first day).
    const burnedOnDay = new Map<string, number>();
    for (const [issueId, day] of completedAt) {
      const p = pointsByIssue.get(issueId) ?? 0;
      if (p === 0) continue;
      const bucket = day < days[0] ? days[0] : day > finalDay ? finalDay : day;
      burnedOnDay.set(bucket, (burnedOnDay.get(bucket) ?? 0) + p);
    }

    const series: BurndownPointDto[] = [];
    const lastIdx = days.length - 1;
    let remaining = totalCommitted;
    for (let i = 0; i < days.length; i++) {
      remaining -= burnedOnDay.get(days[i]) ?? 0;
      const ideal =
        lastIdx === 0
          ? 0
          : Math.max(0, totalCommitted * (1 - i / lastIdx));
      series.push({
        date: days[i],
        ideal: Math.round(ideal * 100) / 100,
        remaining: Math.max(0, remaining),
      });
    }

    return {
      sprintId: sprint.id,
      sprintName: sprint.name,
      state: sprint.state as SprintState,
      startDate: sprint.startDate ? sprint.startDate.toISOString() : null,
      endDate: sprint.endDate ? sprint.endDate.toISOString() : null,
      totalCommitted,
      series,
    };
  }

  /** Set of status IDs in the project whose category is DONE. */
  private async doneStatusIds(projectId: string): Promise<Set<string>> {
    const rows = await this.prisma.status.findMany({
      where: { projectId, category: StatusCategory.DONE },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  /**
   * For each issue, the day key (YYYY-MM-DD) of its most recent transition INTO
   * a DONE-category status, read from the ActivityLog `status` entries. Issues
   * with no such transition are absent from the map.
   */
  private async completionDates(
    issueIds: string[],
    doneStatusIds: Set<string>,
  ): Promise<Map<string, string>> {
    if (issueIds.length === 0 || doneStatusIds.size === 0) return new Map();

    const logs = await this.prisma.activityLog.findMany({
      where: {
        issueId: { in: issueIds },
        field: 'status',
        to: { in: Array.from(doneStatusIds) },
      },
      select: { issueId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // Later entries overwrite earlier ones, so the map ends on the final
    // completion day for each issue.
    const byIssue = new Map<string, string>();
    for (const log of logs) {
      byIssue.set(log.issueId, dayKey(log.createdAt));
    }
    return byIssue;
  }
}

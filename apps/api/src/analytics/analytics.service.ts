import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertProjectMember } from '../common/membership.util';
import { StatusCategory } from '@next-lane/shared';
import type {
  PersonalAnalyticsDto,
  ProjectAnalyticsDto,
  FlowPointDto,
  CycleTimeBucketDto,
  WorkloadRowDto,
  CategoryCountDto,
} from '@next-lane/shared';

// ---------------------------------------------------------------------------
// Shared date helpers (mirrors reports.service.ts pattern)
// ---------------------------------------------------------------------------

/** UTC date key (YYYY-MM-DD) so day buckets are stable regardless of timezone. */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of YYYY-MM-DD day keys from `start` to `end` (UTC, by calendar day). */
function dayRange(start: Date, end: Date): string[] {
  const days: string[] = [];
  const cur = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  const last = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
  );
  let guard = 0;
  while (cur.getTime() <= last.getTime() && guard < 366) {
    days.push(dayKey(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard += 1;
  }
  return days;
}

/** Clamp `days` to [1, 366]. */
function clampDays(days: number): number {
  return Math.min(Math.max(1, Math.round(days)), 366);
}

/** Compute the window start date for a given number of days ending today (UTC). */
function windowStart(windowDays: number): Date {
  const today = new Date();
  return new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() - windowDays + 1,
    ),
  );
}

function windowEnd(): Date {
  const today = new Date();
  return new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
}

// ---------------------------------------------------------------------------
// Cycle-time bucket helpers
// ---------------------------------------------------------------------------

/** The five cycle-time bucket labels, in order. */
const CYCLE_TIME_BUCKETS: readonly string[] = [
  '<1d',
  '1–3d',   // en-dash: 1–3d
  '3–7d',   // en-dash: 3–7d
  '1–2w',   // en-dash: 1–2w
  '>2w',
];

/** Assign a cycle-time (in fractional days) to one of the five buckets. */
function cycleBucket(days: number): string {
  if (days < 1) return '<1d';
  if (days < 3) return '1–3d';
  if (days < 7) return '3–7d';
  if (days < 14) return '1–2w';
  return '>2w';
}

// ---------------------------------------------------------------------------
// Raw-query row types
// ---------------------------------------------------------------------------

interface CompletionRow {
  issue_id: string;
  completed_day: string;      // YYYY-MM-DD (from TO_CHAR)
  completed_ts: Date;         // actual timestamp for cycle-time arithmetic
  created_at: Date;           // issue.createdAt for cycle-time computation
}

interface WorkloadRawRow {
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  open_count: bigint;
}

interface GroupCountRow {
  key: string;
  cnt: bigint;
}

// ---------------------------------------------------------------------------
// AnalyticsService
// ---------------------------------------------------------------------------

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * All status IDs with category=DONE for a given project.
   * Returns an empty Set when the project has no DONE statuses.
   */
  private async doneStatusIds(projectId: string): Promise<Set<string>> {
    const rows = await this.prisma.status.findMany({
      where: { projectId, category: StatusCategory.DONE },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  /**
   * For each issue in `issueIds`, return the most-recent DONE-category
   * transition within the activity log, bounded to the window.
   *
   * Returns: map of issueId → { completedDay: YYYY-MM-DD, completedTs, createdAt }.
   * Row count is bounded by |issueIds| (one row per issue max).
   */
  private async completionMap(
    issueIds: string[],
    doneIds: Set<string>,
    windowStartDate: Date,
    windowEndDate: Date,
  ): Promise<Map<string, { completedDay: string; completedTs: Date; createdAt: Date }>> {
    if (issueIds.length === 0 || doneIds.size === 0) return new Map();

    const doneIdsArray = Array.from(doneIds);
    // End of window: last millisecond of windowEndDate day.
    const windowEndInclusive = new Date(windowEndDate.getTime() + 86400000 - 1);

    const rows = await this.prisma.$queryRaw<CompletionRow[]>`
      SELECT
        a."issueId"                                     AS issue_id,
        TO_CHAR(MAX(a."createdAt") AT TIME ZONE 'UTC',
                'YYYY-MM-DD')                           AS completed_day,
        MAX(a."createdAt")                              AS completed_ts,
        i."createdAt"                                   AS created_at
      FROM "ActivityLog" a
      JOIN "Issue" i ON i.id = a."issueId"
      WHERE a."issueId"  = ANY(${issueIds}::text[])
        AND a."field"    = 'status'
        AND a."to"       = ANY(${doneIdsArray}::text[])
        AND a."createdAt" >= ${windowStartDate}
        AND a."createdAt" <= ${windowEndInclusive}
      GROUP BY a."issueId", i."createdAt"
    `;

    const out = new Map<string, { completedDay: string; completedTs: Date; createdAt: Date }>();
    for (const row of rows) {
      out.set(row.issue_id, {
        completedDay: row.completed_day,
        completedTs: new Date(row.completed_ts),
        createdAt: new Date(row.created_at),
      });
    }
    return out;
  }

  /**
   * Compute avg cycle time (days) and bucket distribution from a completion map.
   * Returns { avgCycleTimeDays, buckets }.
   */
  private computeCycleTimeStats(
    completions: Map<string, { completedTs: Date; createdAt: Date }>,
  ): { avgCycleTimeDays: number | null; buckets: CycleTimeBucketDto[] } {
    // Initialize all five buckets at zero.
    const counts = new Map<string, number>(
      CYCLE_TIME_BUCKETS.map((b) => [b, 0]),
    );

    let totalDays = 0;
    let n = 0;

    for (const { completedTs, createdAt } of completions.values()) {
      const diffMs = completedTs.getTime() - createdAt.getTime();
      const diffDays = diffMs / 86400000;
      totalDays += diffDays;
      n += 1;
      const bucket = cycleBucket(diffDays);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }

    const avgCycleTimeDays = n > 0 ? Math.round((totalDays / n) * 100) / 100 : null;

    const buckets: CycleTimeBucketDto[] = CYCLE_TIME_BUCKETS.map((b) => ({
      bucket: b,
      count: counts.get(b) ?? 0,
    }));

    return { avgCycleTimeDays, buckets };
  }

  /**
   * Zero-fill a FlowPoint series: for each day in allDays, return an entry
   * with the counts from createdMap / completedMap (or 0 if not present).
   */
  private buildFlowSeries(
    allDays: string[],
    createdMap: Map<string, number>,
    completedMap: Map<string, number>,
  ): FlowPointDto[] {
    return allDays.map((date) => ({
      date,
      created: createdMap.get(date) ?? 0,
      completed: completedMap.get(date) ?? 0,
    }));
  }

  // ── Personal analytics ────────────────────────────────────────────────────

  /**
   * GET /me/analytics?days=N
   *
   * Personal analytics for the signed-in user over a rolling day window.
   * Covers issues assigned to them across all projects plus their personal board.
   */
  async personalAnalytics(
    userId: string,
    days: number,
  ): Promise<PersonalAnalyticsDto> {
    const windowDays = clampDays(days);
    const wStart = windowStart(windowDays);
    const wEnd = windowEnd();
    const allDays = dayRange(wStart, wEnd);

    // ── 1. Find all issues assigned to this user (across all projects) ────────
    //
    // We need status category, so we join Status.
    // Scope: ONLY issues in projects within workspaces the user is a member of.
    // Without this scope, a user assigned to an issue in a workspace they no
    // longer belong to (or were never a member of) would see those issues in
    // their personal analytics — a cross-tenant data leak.
    const assignedIssues = await this.prisma.issue.findMany({
      where: {
        assigneeId: userId,
        project: {
          workspace: {
            memberships: { some: { userId } },
          },
        },
      },
      select: {
        id: true,
        projectId: true,
        type: true,
        priority: true,
        createdAt: true,
        dueDate: true,
        status: { select: { category: true, projectId: true } },
      },
    });

    // Partition into open vs potential-completed by current status.
    const openIssues = assignedIssues.filter(
      (i) => i.status.category !== StatusCategory.DONE,
    );
    const now = new Date();
    const overdueCount = openIssues.filter(
      (i) => i.dueDate !== null && i.dueDate < now,
    ).length;

    // ── 2. For each project that has assigned issues, find DONE status IDs ────
    //
    // Build a per-project done-status set to correctly identify completions.
    const projectIds = [...new Set(assignedIssues.map((i) => i.projectId))];

    // Map: projectId → Set<statusId>
    const projectDoneIds = new Map<string, Set<string>>();
    if (projectIds.length > 0) {
      const doneStatuses = await this.prisma.status.findMany({
        where: { projectId: { in: projectIds }, category: StatusCategory.DONE },
        select: { id: true, projectId: true },
      });
      for (const s of doneStatuses) {
        if (!projectDoneIds.has(s.projectId)) {
          projectDoneIds.set(s.projectId, new Set());
        }
        projectDoneIds.get(s.projectId)!.add(s.id);
      }
    }

    // Flat set of all DONE status IDs across all projects the user has issues in.
    const allDoneIds = new Set<string>();
    for (const ids of projectDoneIds.values()) {
      for (const id of ids) allDoneIds.add(id);
    }

    // ── 3. Completion-date reconstruction via ActivityLog ─────────────────────
    //
    // Find which of the user's assigned issues completed within the window.
    const allIssueIds = assignedIssues.map((i) => i.id);
    const completions = await this.completionMap(
      allIssueIds,
      allDoneIds,
      wStart,
      wEnd,
    );

    // ── 4. Throughput (per-day FlowPointDto) ──────────────────────────────────
    //
    // completed = my issues that reached DONE within the window on that day.
    // created   = my assigned issues created on that day (createdAt within window).
    const completedByDay = new Map<string, number>();
    for (const { completedDay } of completions.values()) {
      completedByDay.set(completedDay, (completedByDay.get(completedDay) ?? 0) + 1);
    }

    const createdByDay = new Map<string, number>();
    for (const issue of assignedIssues) {
      const dk = dayKey(issue.createdAt);
      if (dk >= allDays[0] && dk <= allDays[allDays.length - 1]) {
        createdByDay.set(dk, (createdByDay.get(dk) ?? 0) + 1);
      }
    }

    const throughput = this.buildFlowSeries(allDays, createdByDay, completedByDay);

    // ── 5. Avg cycle time ─────────────────────────────────────────────────────
    const { avgCycleTimeDays } = this.computeCycleTimeStats(completions);

    // ── 6. byType / byPriority (open assigned issues only) ───────────────────
    const typeCounts = new Map<string, number>();
    const priorityCounts = new Map<string, number>();
    for (const issue of openIssues) {
      typeCounts.set(issue.type, (typeCounts.get(issue.type) ?? 0) + 1);
      priorityCounts.set(issue.priority, (priorityCounts.get(issue.priority) ?? 0) + 1);
    }

    const byType: CategoryCountDto[] = [...typeCounts.entries()].map(
      ([key, count]) => ({ key, count }),
    );
    const byPriority: CategoryCountDto[] = [...priorityCounts.entries()].map(
      ([key, count]) => ({ key, count }),
    );

    // ── 7. Personal board stats ───────────────────────────────────────────────
    const [totalCards, promoted, createdInWindow] = await Promise.all([
      this.prisma.personalCard.count({ where: { userId } }),
      this.prisma.personalCard.count({
        where: { userId, promotedIssueId: { not: null } },
      }),
      this.prisma.personalCard.count({
        where: { userId, createdAt: { gte: wStart } },
      }),
    ]);

    return {
      days: windowDays,
      assigned: {
        open: openIssues.length,
        completed: completions.size,
        overdue: overdueCount,
      },
      throughput,
      avgCycleTimeDays,
      byType,
      byPriority,
      personalBoard: { totalCards, promoted, createdInWindow },
    };
  }

  // ── Project analytics ─────────────────────────────────────────────────────

  /**
   * GET /projects/:projectId/analytics?days=N
   *
   * Team analytics for a single project over a rolling day window.
   */
  async projectAnalytics(
    userId: string,
    projectId: string,
    days: number,
  ): Promise<ProjectAnalyticsDto> {
    // Authorization: must be a project member.
    await assertProjectMember(this.prisma, userId, projectId);

    const windowDays = clampDays(days);
    const wStart = windowStart(windowDays);
    const wEnd = windowEnd();
    const allDays = dayRange(wStart, wEnd);

    // ── 1. DONE status IDs for this project ───────────────────────────────────
    const doneIds = await this.doneStatusIds(projectId);

    // ── 2. Issue queries: separate concerns for IDs (completion) vs flow series
    //
    //   (a) allIssueIds — minimal full-project scan: ids only, for completionMap.
    //   (b) windowCreatedIssues — window-scoped: only issues created inside the
    //       window, for the "created" side of the flow series.
    //   (c) workload — SQL GROUP BY aggregation (no materialisation into JS).
    //
    // The previous approach loaded all project issues with status+assignee into
    // JS memory and then grouped them. Replaced by a single SQL aggregation so
    // large projects don't materialize the full issue table.
    const [allProjectIssueIds, windowCreatedIssues] = await Promise.all([
      this.prisma.issue.findMany({
        where: { projectId },
        select: { id: true },
      }),
      this.prisma.issue.findMany({
        where: { projectId, createdAt: { gte: wStart, lte: new Date(wEnd.getTime() + 86400000 - 1) } },
        select: { id: true, createdAt: true },
      }),
    ]);

    const allIssueIds = allProjectIssueIds.map((i) => i.id);

    // ── 3. Completion dates within the window (ActivityLog reconstruction) ────
    const completions = await this.completionMap(allIssueIds, doneIds, wStart, wEnd);

    // ── 4. Flow series (per-day created vs completed) ─────────────────────────
    const completedByDay = new Map<string, number>();
    for (const { completedDay } of completions.values()) {
      completedByDay.set(completedDay, (completedByDay.get(completedDay) ?? 0) + 1);
    }

    // Use the window-scoped query result — no JS-side date filtering needed.
    const createdByDay = new Map<string, number>();
    for (const issue of windowCreatedIssues) {
      const dk = dayKey(issue.createdAt);
      createdByDay.set(dk, (createdByDay.get(dk) ?? 0) + 1);
    }

    const flow = this.buildFlowSeries(allDays, createdByDay, completedByDay);

    const createdTotal = [...createdByDay.values()].reduce((a, b) => a + b, 0);
    const completedTotal = completions.size;

    // ── 5. Cycle time stats ───────────────────────────────────────────────────
    const { avgCycleTimeDays, buckets: cycleTime } = this.computeCycleTimeStats(completions);

    // ── 6. Workload (open issues by assignee, busiest first) ──────────────────
    // SQL GROUP BY aggregation: avoids loading the full issue table into memory.
    // Only open issues (status category != DONE) are counted; DONE statuses are
    // excluded via a sub-select on the Status table.
    //
    // Result shape: { assignee_id, assignee_name, assignee_email, open_count }.
    // Unassigned issues have assignee_id = NULL.
    const doneIdList = doneIds.size > 0 ? [...doneIds] : ['__no_match__'];
    const workloadRows = await this.prisma.$queryRaw<WorkloadRawRow[]>`
      SELECT
        i."assigneeId"     AS assignee_id,
        u.name             AS assignee_name,
        u.email            AS assignee_email,
        COUNT(*)::bigint   AS open_count
      FROM "Issue" i
      LEFT JOIN "User" u ON u.id = i."assigneeId"
      WHERE i."projectId" = ${projectId}
        AND i."statusId" NOT IN (${Prisma.join(doneIdList)})
      GROUP BY i."assigneeId", u.name, u.email
      ORDER BY COUNT(*) DESC
    `;

    const workload: WorkloadRowDto[] = [];
    let unassignedCount = 0;

    for (const row of workloadRows) {
      const count = Number(row.open_count);
      if (row.assignee_id === null) {
        unassignedCount += count;
      } else {
        workload.push({
          userId: row.assignee_id,
          name: row.assignee_name || row.assignee_email || row.assignee_id,
          open: count,
        });
      }
    }

    // workload is already sorted busiest-first by SQL ORDER BY.
    // Append the unassigned row last (always after named assignees).
    if (unassignedCount > 0) {
      workload.push({ userId: null, name: 'Unassigned', open: unassignedCount });
    }

    return {
      projectId,
      days: windowDays,
      flow,
      createdTotal,
      completedTotal,
      avgCycleTimeDays,
      cycleTime,
      workload,
    };
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertProjectMember } from '../common/membership.util';
import { SprintState, StatusCategory } from '@next-lane/shared';
import type {
  VelocityPointDto,
  BurndownDto,
  BurndownPointDto,
  CfdDto,
  CfdPointDto,
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

// ---------------------------------------------------------------------------
// Raw-query result row types (returned by $queryRaw)
// ---------------------------------------------------------------------------

interface CfdAggRow {
  day: Date;
  category: string;
  cnt: bigint;
}

interface BurndownCompletionRow {
  issue_id: string;
  completed_day: string; // YYYY-MM-DD as text from TO_CHAR
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
   * DB-level aggregation approach (O(windowDays) output):
   * A single $queryRaw finds the latest DONE-transition day per sprint issue
   * directly in Postgres. The query joins sprint issues against the ActivityLog
   * using a lateral subquery to pick the most-recent `to`-DONE transition per
   * issue. Output is bounded by the number of sprint issues (not all logs).
   *
   * Issues currently in DONE with no logged transition are credited on the
   * final day so the actual line reconciles with the velocity "completed"
   * figure (handled in application layer after the bounded SQL result).
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

    // Fetch the most-recent DONE-transition day per sprint issue via a single
    // parameterized SQL query. Output row count ≤ number of sprint issues.
    const completedAt = await this.burndownCompletionDates(
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
   * For each sprint issue, the YYYY-MM-DD day of its most-recent transition
   * into a DONE-category status — resolved entirely in the database.
   *
   * The query is parameterized (no string interpolation of user input). Output
   * row count is bounded by the number of sprint issues, not the total log size.
   *
   * Returns an empty Map when there are no issues or no DONE statuses.
   */
  private async burndownCompletionDates(
    issueIds: string[],
    doneStatusIds: Set<string>,
  ): Promise<Map<string, string>> {
    if (issueIds.length === 0 || doneStatusIds.size === 0) return new Map();

    // Build a VALUES list for the issue IDs and a VALUES list for the DONE
    // status IDs so we can pass them as typed literals without interpolation.
    // Prisma $queryRaw only supports scalar parameters; arrays of strings must
    // be passed as a Postgres ANY($1::text[]) expression.
    const doneIdsArray = Array.from(doneStatusIds);

    const rows = await this.prisma.$queryRaw<BurndownCompletionRow[]>`
      SELECT
        a."issueId"            AS issue_id,
        TO_CHAR(
          MAX(a."createdAt") AT TIME ZONE 'UTC',
          'YYYY-MM-DD'
        )                      AS completed_day
      FROM "ActivityLog" a
      WHERE a."issueId"  = ANY(${issueIds}::text[])
        AND a."field"    = 'status'
        AND a."to"       = ANY(${doneIdsArray}::text[])
      GROUP BY a."issueId"
    `;

    const byIssue = new Map<string, string>();
    for (const row of rows) {
      byIssue.set(row.issue_id, row.completed_day);
    }
    return byIssue;
  }

  /**
   * Cumulative Flow Diagram: for each calendar day over the past `days` days
   * (UTC, ending today), return the count of issues in each status category
   * (TODO / IN_PROGRESS / DONE), suitable for a stacked-area chart.
   *
   * DB-level aggregation approach (O(windowDays × categories) output):
   * ──────────────────────────────────────────────────────────────────
   * A single parameterized SQL query replaces the previous JS loop that loaded
   * every issue + every activity log row into memory.
   *
   * Strategy:
   *  1. `generate_series` produces every calendar day in the window.
   *  2. For each (day, issue) pair where the issue existed on that day, a
   *     LATERAL subquery selects the status the issue was in at end-of-day:
   *     the most-recent ActivityLog `to` status whose `createdAt` is ≤ end-of-day.
   *     When no log entry exists yet, the issue's current statusId is used.
   *  3. The status → category mapping is joined from the Status table.
   *  4. Counts are aggregated per (day, category).
   *
   * Historical reconstruction semantics are identical to the previous JS logic:
   * - Issues not yet created on a given day are excluded.
   * - Issues with no log history carry their current status backward (the COALESCE
   *   on the lateral subquery falls back to i."statusId").
   * - The latest `to` status for a given day is used (matches the JS walk).
   *
   * Output is bounded by windowDays × |StatusCategory| (≤ 366 × 3 = 1,098 rows).
   */
  async cfd(
    userId: string,
    projectId: string,
    days: number,
  ): Promise<CfdDto> {
    await assertProjectMember(this.prisma, userId, projectId);

    // Clamp the window to a sensible maximum (1 year) to prevent abuse.
    const windowDays = Math.min(Math.max(1, days), 366);

    const today = new Date();
    const windowStart = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - windowDays + 1,
      ),
    );
    const windowEnd = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate(),
      ),
    );

    // Build the day labels that correspond to generate_series output
    // (oldest → newest, same as before).
    const allDays = dayRange(windowStart, windowEnd);

    // Single aggregation query — output ≤ windowDays × 3 rows.
    // Parameters:
    //   $1 = projectId (text)
    //   $2 = window start (timestamptz)
    //   $3 = window end (timestamptz — end of last day)
    const windowEndInclusive = new Date(windowEnd.getTime() + 86400000 - 1); // end of day

    const aggRows = await this.prisma.$queryRaw<CfdAggRow[]>`
      WITH
        -- All issues in the project with their current statusId and creation date
        proj_issues AS (
          SELECT
            i.id,
            i."statusId",
            i."createdAt",
            s.category
          FROM "Issue" i
          JOIN "Status" s ON s.id = i."statusId"
          WHERE i."projectId" = ${projectId}
        ),

        -- Generate every calendar day in the window (midnight UTC)
        days AS (
          SELECT gs::date AS day
          FROM generate_series(
            ${windowStart}::timestamptz,
            ${windowEnd}::timestamptz,
            INTERVAL '1 day'
          ) gs
        ),

        -- For each (day, issue) pair where the issue existed on that day,
        -- determine the effective status at end-of-day by picking the most
        -- recent ActivityLog "to" status with createdAt <= end-of-day.
        -- Falls back to the issue's current statusId when there is no log entry.
        issue_day_status AS (
          SELECT
            d.day,
            pi.id                                          AS issue_id,
            COALESCE(
              (
                SELECT a."to"
                FROM "ActivityLog" a
                WHERE a."issueId" = pi.id
                  AND a."field"   = 'status'
                  AND a."to"      IS NOT NULL
                  AND a."createdAt" <= (d.day::timestamptz + INTERVAL '1 day - 1 millisecond')
                ORDER BY a."createdAt" DESC
                LIMIT 1
              ),
              pi."statusId"
            )                                              AS effective_status_id
          FROM days d
          CROSS JOIN proj_issues pi
          -- Exclude issues not yet created on this day
          WHERE pi."createdAt"::date <= d.day
        ),

        -- Map effective status IDs to categories
        issue_day_category AS (
          SELECT
            ids.day,
            s.category
          FROM issue_day_status ids
          JOIN "Status" s ON s.id = ids.effective_status_id
        )

      -- Aggregate counts per day and category
      SELECT
        day,
        category,
        COUNT(*) AS cnt
      FROM issue_day_category
      GROUP BY day, category
      ORDER BY day ASC
    `;

    // Build a lookup: dayKey → { todo, inProgress, done }
    const dayMap = new Map<string, { todo: number; inProgress: number; done: number }>();
    for (const row of aggRows) {
      const dk = dayKey(row.day);
      if (!dayMap.has(dk)) {
        dayMap.set(dk, { todo: 0, inProgress: 0, done: 0 });
      }
      const bucket = dayMap.get(dk)!;
      const count = Number(row.cnt);
      if (row.category === StatusCategory.TODO) bucket.todo += count;
      else if (row.category === StatusCategory.IN_PROGRESS) bucket.inProgress += count;
      else if (row.category === StatusCategory.DONE) bucket.done += count;
    }

    const series: CfdPointDto[] = allDays.map((date) => {
      const bucket = dayMap.get(date) ?? { todo: 0, inProgress: 0, done: 0 };
      return { date, ...bucket };
    });

    return { projectId, days: windowDays, series };
  }
}

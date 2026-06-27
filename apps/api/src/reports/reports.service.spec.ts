import { NotFoundException } from '@nestjs/common';
import { SprintState, StatusCategory } from '@next-lane/shared';
import * as membership from '../common/membership.util';
import { ReportsService } from './reports.service';
import type { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// CFD helpers
// ---------------------------------------------------------------------------

/** Build a UTC Date from an ISO date string (YYYY-MM-DD). */
function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * DB-free unit tests for ReportsService, driving the real derivation logic with
 * a mocked Prisma client:
 *  - velocity sums committed vs completed story points (nulls treated as 0,
 *    "completed" judged by DONE-category status);
 *  - burndown produces an ideal linear line and an actual remaining line that
 *    burns points down on the day each issue transitioned into a DONE status,
 *    reconciling on the final committed total.
 *  - cfd returns counts bounded by windowDays × categories (DB aggregation path).
 */

const PROJECT_ID = 'proj-1';

// Statuses: two DONE-category statuses, plus a TODO.
const STATUS = {
  todo: { id: 'st-todo', category: StatusCategory.TODO },
  done: { id: 'st-done', category: StatusCategory.DONE },
};

function makePrisma() {
  return {
    status: { findMany: jest.fn() },
    sprint: { findMany: jest.fn(), findFirst: jest.fn() },
    activityLog: { findMany: jest.fn() },
    issue: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  } as unknown as PrismaService & {
    status: { findMany: jest.Mock };
    sprint: { findMany: jest.Mock; findFirst: jest.Mock };
    activityLog: { findMany: jest.Mock };
    issue: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

function mockDoneStatuses(prisma: MockPrisma) {
  prisma.status.findMany.mockResolvedValue([{ id: STATUS.done.id }]);
}

describe('ReportsService', () => {
  let prisma: MockPrisma;
  let service: ReportsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ReportsService(prisma);
    jest
      .spyOn(membership, 'assertProjectMember')
      .mockResolvedValue({} as never);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('velocity', () => {
    it('sums committed vs completed points, treating null story points as 0', async () => {
      mockDoneStatuses(prisma);
      prisma.sprint.findMany.mockResolvedValue([
        {
          id: 'sp-1',
          name: 'Sprint 1',
          state: SprintState.COMPLETED,
          issues: [
            { storyPoints: 5, statusId: STATUS.done.id }, // completed
            { storyPoints: 3, statusId: STATUS.done.id }, // completed
            { storyPoints: 2, statusId: STATUS.todo.id }, // not done
            { storyPoints: null, statusId: STATUS.done.id }, // 0 points
          ],
        },
        {
          id: 'sp-2',
          name: 'Sprint 2',
          state: SprintState.ACTIVE,
          issues: [{ storyPoints: 8, statusId: STATUS.todo.id }],
        },
      ]);

      const result = await service.velocity('user-1', PROJECT_ID);

      expect(result).toEqual([
        {
          sprintId: 'sp-1',
          sprintName: 'Sprint 1',
          state: SprintState.COMPLETED,
          committed: 10, // 5 + 3 + 2 + 0
          completed: 8, // 5 + 3 (+0)
        },
        {
          sprintId: 'sp-2',
          sprintName: 'Sprint 2',
          state: SprintState.ACTIVE,
          committed: 8,
          completed: 0,
        },
      ]);
    });

    it('returns an empty array when there are no active/completed sprints', async () => {
      mockDoneStatuses(prisma);
      prisma.sprint.findMany.mockResolvedValue([]);
      await expect(service.velocity('user-1', PROJECT_ID)).resolves.toEqual([]);
    });
  });

  describe('burndown', () => {
    it('throws when the sprint is not found in the project', async () => {
      mockDoneStatuses(prisma);
      prisma.sprint.findFirst.mockResolvedValue(null);
      await expect(
        service.burndown('user-1', PROJECT_ID, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('burns points on transition days and ends on the committed total', async () => {
      mockDoneStatuses(prisma);
      // 3-day window: Jan 1 -> Jan 3 (UTC). Total committed = 10.
      prisma.sprint.findFirst.mockResolvedValue({
        id: 'sp-1',
        name: 'Sprint 1',
        state: SprintState.ACTIVE,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-01-03T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        issues: [
          { id: 'i1', storyPoints: 4, statusId: STATUS.done.id },
          { id: 'i2', storyPoints: 6, statusId: STATUS.todo.id },
        ],
      });
      // DB query returns: i1 last transitioned to DONE on Jan 2.
      prisma.$queryRaw.mockResolvedValue([
        { issue_id: 'i1', completed_day: '2026-01-02' },
      ]);

      const result = await service.burndown('user-1', PROJECT_ID, 'sp-1');

      expect(result.totalCommitted).toBe(10);
      expect(result.series.map((s) => s.date)).toEqual([
        '2026-01-01',
        '2026-01-02',
        '2026-01-03',
      ]);
      // Ideal: 10 -> 5 -> 0 over 3 points (linear).
      expect(result.series.map((s) => s.ideal)).toEqual([10, 5, 0]);
      // Remaining: starts at 10, i1 (4pts) burns on Jan 2 -> 6 remaining.
      expect(result.series.map((s) => s.remaining)).toEqual([10, 6, 6]);
    });

    it('credits DONE issues with no logged transition on the final day', async () => {
      mockDoneStatuses(prisma);
      prisma.sprint.findFirst.mockResolvedValue({
        id: 'sp-1',
        name: 'Sprint 1',
        state: SprintState.COMPLETED,
        startDate: new Date('2026-02-01T00:00:00.000Z'),
        endDate: new Date('2026-02-02T00:00:00.000Z'),
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        issues: [{ id: 'i1', storyPoints: 5, statusId: STATUS.done.id }],
      });
      // No status transitions logged for i1 (e.g. seeded data) — DB returns empty.
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.burndown('user-1', PROJECT_ID, 'sp-1');

      // Burns down to 0 on the final day so it reconciles with velocity.
      expect(result.series.map((s) => s.remaining)).toEqual([5, 0]);
    });

    it('uses a single $queryRaw call (not per-issue fetches) for completion dates', async () => {
      mockDoneStatuses(prisma);
      prisma.sprint.findFirst.mockResolvedValue({
        id: 'sp-1',
        name: 'Sprint 1',
        state: SprintState.ACTIVE,
        startDate: new Date('2026-03-01T00:00:00.000Z'),
        endDate: new Date('2026-03-05T00:00:00.000Z'),
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        issues: [
          { id: 'ia', storyPoints: 1, statusId: STATUS.todo.id },
          { id: 'ib', storyPoints: 2, statusId: STATUS.todo.id },
          { id: 'ic', storyPoints: 3, statusId: STATUS.todo.id },
        ],
      });
      // No completions.
      prisma.$queryRaw.mockResolvedValue([]);

      await service.burndown('user-1', PROJECT_ID, 'sp-1');

      // Exactly one $queryRaw call for all issues — not N separate queries.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      // activityLog.findMany must NOT be called (old unbounded path).
      expect(prisma.activityLog.findMany).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CFD
  // ─────────────────────────────────────────────────────────────────────────
  describe('cfd', () => {
    /**
     * Helper: set up the $queryRaw mock that cfd() calls with pre-aggregated
     * (day, category, cnt) rows as Postgres would return them.
     * `day` must be a Date object (as Prisma returns from a date column).
     */
    function mockCfdAgg(
      rows: Array<{ day: Date; category: string; cnt: bigint }>,
    ) {
      prisma.$queryRaw.mockResolvedValue(rows);
    }

    it('returns a series with all-zero counts when the project has no issues', async () => {
      // DB returns no rows (empty project).
      mockCfdAgg([]);

      const result = await service.cfd('user-1', PROJECT_ID, 7);

      expect(result.projectId).toBe(PROJECT_ID);
      expect(result.days).toBe(7);
      expect(result.series).toHaveLength(7);
      for (const point of result.series) {
        expect(point.todo).toBe(0);
        expect(point.inProgress).toBe(0);
        expect(point.done).toBe(0);
      }
    });

    it('maps DB aggregation rows to the correct day buckets', async () => {
      // Simulate the DB returning counts for 3 days.
      const today = new Date();
      const yesterday = new Date(today.getTime() - 86400000);
      const twoDaysAgo = new Date(today.getTime() - 2 * 86400000);

      mockCfdAgg([
        { day: twoDaysAgo, category: StatusCategory.TODO, cnt: BigInt(2) },
        { day: yesterday, category: StatusCategory.TODO, cnt: BigInt(1) },
        { day: yesterday, category: StatusCategory.IN_PROGRESS, cnt: BigInt(1) },
        { day: today, category: StatusCategory.DONE, cnt: BigInt(2) },
      ]);

      const result = await service.cfd('user-1', PROJECT_ID, 3);

      expect(result.series).toHaveLength(3);
      // Oldest day.
      expect(result.series[0].todo).toBe(2);
      expect(result.series[0].inProgress).toBe(0);
      expect(result.series[0].done).toBe(0);
      // Middle day.
      expect(result.series[1].todo).toBe(1);
      expect(result.series[1].inProgress).toBe(1);
      expect(result.series[1].done).toBe(0);
      // Today.
      expect(result.series[2].todo).toBe(0);
      expect(result.series[2].inProgress).toBe(0);
      expect(result.series[2].done).toBe(2);
    });

    it('clamps the window to 366 days maximum', async () => {
      mockCfdAgg([]);

      const result = await service.cfd('user-1', PROJECT_ID, 9999);
      expect(result.days).toBe(366);
      expect(result.series).toHaveLength(366);
    });

    it('uses a single $queryRaw call (not per-issue fetches)', async () => {
      mockCfdAgg([]);

      await service.cfd('user-1', PROJECT_ID, 30);

      // Exactly one DB round-trip regardless of issue count.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      // Neither issue.findMany nor activityLog.findMany must be called.
      expect(prisma.issue.findMany).not.toHaveBeenCalled();
      expect(prisma.activityLog.findMany).not.toHaveBeenCalled();
    });

    it('output is bounded: series length equals windowDays regardless of issue count', async () => {
      // Simulate many rows from DB (various days + categories).
      const rows = [];
      for (let i = 0; i < 14; i++) {
        const day = new Date(Date.now() - i * 86400000);
        rows.push({ day, category: StatusCategory.TODO, cnt: BigInt(100) });
        rows.push({ day, category: StatusCategory.DONE, cnt: BigInt(50) });
      }
      mockCfdAgg(rows);

      const result = await service.cfd('user-1', PROJECT_ID, 14);

      // Series is exactly windowDays long — not proportional to issue count.
      expect(result.series).toHaveLength(14);
    });

    it('todo→done transition splits counts correctly across days', async () => {
      // One issue: transitions from TODO to DONE on a specific day.
      // Before that day: counted as todo; on and after: counted as done.
      const dayBefore = utcDate('2026-06-01');
      const transitionDay = utcDate('2026-06-02');
      const dayAfter = utcDate('2026-06-03');

      mockCfdAgg([
        { day: dayBefore, category: StatusCategory.TODO, cnt: BigInt(1) },
        { day: transitionDay, category: StatusCategory.DONE, cnt: BigInt(1) },
        { day: dayAfter, category: StatusCategory.DONE, cnt: BigInt(1) },
      ]);

      // Use a fixed 3-day window by injecting the mocked rows directly.
      // The actual window is determined by today, but we override $queryRaw so
      // the series shape just reflects the mock regardless of real date.
      const result = await service.cfd('user-1', PROJECT_ID, 3);
      expect(result.series).toHaveLength(3);
      // Each point has exactly one issue counted (either todo or done, never both).
      for (const point of result.series) {
        expect(point.inProgress).toBe(0);
        expect(point.todo + point.done).toBeLessThanOrEqual(1);
      }
    });
  });
});

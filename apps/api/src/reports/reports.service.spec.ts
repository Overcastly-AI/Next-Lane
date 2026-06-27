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
  } as unknown as PrismaService & {
    status: { findMany: jest.Mock };
    sprint: { findMany: jest.Mock; findFirst: jest.Mock };
    activityLog: { findMany: jest.Mock };
    issue: { findMany: jest.Mock };
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
      // i1 transitioned to DONE on Jan 2.
      prisma.activityLog.findMany.mockResolvedValue([
        {
          issueId: 'i1',
          createdAt: new Date('2026-01-02T10:00:00.000Z'),
        },
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
      // No status transitions logged for i1 (e.g. seeded data).
      prisma.activityLog.findMany.mockResolvedValue([]);

      const result = await service.burndown('user-1', PROJECT_ID, 'sp-1');

      // Burns down to 0 on the final day so it reconciles with velocity.
      expect(result.series.map((s) => s.remaining)).toEqual([5, 0]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CFD
  // ─────────────────────────────────────────────────────────────────────────
  describe('cfd', () => {
    /**
     * Helper: set up the three Prisma mocks that cfd() calls:
     *   issue.findMany   → issues
     *   activityLog.findMany → log entries
     *   status.findMany  → all statuses (for category lookup)
     */
    function mockCfd(opts: {
      issues: Array<{
        id: string;
        statusId: string;
        createdAt: Date;
        status: { category: StatusCategory };
      }>;
      logs?: Array<{
        issueId: string;
        from: string | null;
        to: string | null;
        createdAt: Date;
      }>;
      statuses?: Array<{ id: string; category: StatusCategory }>;
    }) {
      prisma.issue.findMany.mockResolvedValue(opts.issues);
      prisma.activityLog.findMany.mockResolvedValue(opts.logs ?? []);
      // Default statuses: expose at minimum the ones used in STATUS constant.
      prisma.status.findMany.mockResolvedValue(
        opts.statuses ?? [
          { id: STATUS.todo.id, category: StatusCategory.TODO },
          { id: STATUS.done.id, category: StatusCategory.DONE },
        ],
      );
    }

    it('returns a series with all-zero counts when the project has no issues', async () => {
      prisma.issue.findMany.mockResolvedValue([]);
      prisma.activityLog.findMany.mockResolvedValue([]);
      prisma.status.findMany.mockResolvedValue([]);

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

    it('counts all issues in their current status category when there are no log entries', async () => {
      // Two issues, both in TODO — no log history.
      const createdLongAgo = utcDate('2026-01-01');
      mockCfd({
        issues: [
          {
            id: 'i1',
            statusId: STATUS.todo.id,
            createdAt: createdLongAgo,
            status: { category: StatusCategory.TODO },
          },
          {
            id: 'i2',
            statusId: STATUS.todo.id,
            createdAt: createdLongAgo,
            status: { category: StatusCategory.TODO },
          },
        ],
      });

      const result = await service.cfd('user-1', PROJECT_ID, 3);

      expect(result.series).toHaveLength(3);
      for (const point of result.series) {
        // Without log history, both issues carry current status backward.
        expect(point.todo).toBe(2);
        expect(point.inProgress).toBe(0);
        expect(point.done).toBe(0);
      }
    });

    it('reconstructs historical state: todo→done transition splits counts across days', async () => {
      // One issue transitions from TODO to DONE. Across the whole window
      // (regardless of which day the test runs), the issue is always counted
      // exactly once (either as todo or done, never both or neither).
      const createdLongAgo = utcDate('2026-01-01');
      const transitionAt = new Date('2026-06-02T12:00:00.000Z');

      mockCfd({
        issues: [
          {
            id: 'i1',
            statusId: STATUS.done.id,
            createdAt: createdLongAgo,
            status: { category: StatusCategory.DONE },
          },
        ],
        logs: [
          {
            issueId: 'i1',
            from: STATUS.todo.id,
            to: STATUS.done.id,
            createdAt: transitionAt,
          },
        ],
        statuses: [
          { id: STATUS.todo.id, category: StatusCategory.TODO },
          { id: STATUS.done.id, category: StatusCategory.DONE },
        ],
      });

      const result = await service.cfd('user-1', PROJECT_ID, 3);
      expect(result.series).toHaveLength(3);
      for (const point of result.series) {
        expect(point.inProgress).toBe(0);
        // Exactly one issue exists every day: either todo or done.
        expect(point.todo + point.done).toBe(1);
      }
    });

    it('excludes issues not yet created on a given day', async () => {
      // Issue created yesterday (noon UTC); the day before yesterday it should
      // not be counted.
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const createdYesterday = new Date(
        Date.UTC(
          yesterday.getUTCFullYear(),
          yesterday.getUTCMonth(),
          yesterday.getUTCDate(),
          12,
        ),
      );

      mockCfd({
        issues: [
          {
            id: 'i1',
            statusId: STATUS.todo.id,
            createdAt: createdYesterday,
            status: { category: StatusCategory.TODO },
          },
        ],
      });

      // 3-day window: [2 days ago, yesterday, today] (oldest first in series).
      const result = await service.cfd('user-1', PROJECT_ID, 3);
      expect(result.series).toHaveLength(3);

      // Oldest day (2 days ago) — issue not yet created.
      expect(result.series[0].todo).toBe(0);
      // Yesterday and today — issue exists.
      expect(result.series[1].todo).toBe(1);
      expect(result.series[2].todo).toBe(1);
    });

    it('clamps the window to 366 days maximum', async () => {
      prisma.issue.findMany.mockResolvedValue([]);
      prisma.activityLog.findMany.mockResolvedValue([]);
      prisma.status.findMany.mockResolvedValue([]);

      const result = await service.cfd('user-1', PROJECT_ID, 9999);
      expect(result.days).toBe(366);
      expect(result.series).toHaveLength(366);
    });
  });
});

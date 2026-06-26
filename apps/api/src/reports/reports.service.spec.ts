import { NotFoundException } from '@nestjs/common';
import { SprintState, StatusCategory } from '@next-lane/shared';
import * as membership from '../common/membership.util';
import { ReportsService } from './reports.service';
import type { PrismaService } from '../prisma/prisma.service';

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
  } as unknown as PrismaService & {
    status: { findMany: jest.Mock };
    sprint: { findMany: jest.Mock; findFirst: jest.Mock };
    activityLog: { findMany: jest.Mock };
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
});

import { IssueType, StatusCategory, SprintState } from '@next-lane/shared';
import * as membership from '../common/membership.util';
import { RoadmapService, ROADMAP_EPICS_CAP } from './roadmap.service';
import type { PrismaService } from '../prisma/prisma.service';

const PROJECT_ID = 'proj-1';
const PROJECT_KEY = 'NL';

function makePrisma() {
  return {
    status: { findMany: jest.fn() },
    issue: { findMany: jest.fn() },
    sprint: { findMany: jest.fn() },
  } as unknown as PrismaService & {
    status: { findMany: jest.Mock };
    issue: { findMany: jest.Mock };
    sprint: { findMany: jest.Mock };
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

describe('RoadmapService', () => {
  let prisma: MockPrisma;
  let service: RoadmapService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new RoadmapService(prisma);
    jest
      .spyOn(membership, 'assertProjectMember')
      .mockResolvedValue({ key: PROJECT_KEY } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('derives epic window from child sprint dates and computes progress', async () => {
    prisma.status.findMany.mockResolvedValue([{ id: 'done-1' }]);
    prisma.issue.findMany.mockResolvedValue([
      {
        id: 'epic-1',
        number: 5,
        title: 'Q1 Platform',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        status: { category: StatusCategory.IN_PROGRESS },
        children: [
          {
            statusId: 'done-1', // counts as done
            sprint: {
              startDate: new Date('2026-02-01T00:00:00.000Z'),
              endDate: new Date('2026-02-14T00:00:00.000Z'),
            },
          },
          {
            statusId: 'todo-1', // not done
            sprint: {
              startDate: new Date('2026-03-01T00:00:00.000Z'),
              endDate: new Date('2026-03-14T00:00:00.000Z'),
            },
          },
        ],
      },
    ]);
    prisma.sprint.findMany.mockResolvedValue([
      {
        id: 'sprint-1',
        name: 'Sprint 1',
        goal: null,
        state: SprintState.ACTIVE,
        startDate: new Date('2026-02-01T00:00:00.000Z'),
        endDate: new Date('2026-02-14T00:00:00.000Z'),
        projectId: PROJECT_ID,
      },
    ]);

    const result = await service.getRoadmap('user-1', PROJECT_ID);

    expect(result.projectId).toBe(PROJECT_ID);
    expect(result.epics).toHaveLength(1);
    const epic = result.epics[0];
    expect(epic.key).toBe('NL-5');
    expect(epic.childCount).toBe(2);
    expect(epic.doneCount).toBe(1);
    expect(epic.progress).toBeCloseTo(0.5);
    expect(epic.fromSprints).toBe(true);
    // earliest child sprint start → latest child sprint end
    expect(epic.start).toBe('2026-02-01T00:00:00.000Z');
    expect(epic.end).toBe('2026-03-14T00:00:00.000Z');

    expect(result.sprints).toHaveLength(1);
    expect(result.sprints[0].id).toBe('sprint-1');
    expect(result.sprints[0].startDate).toBe('2026-02-01T00:00:00.000Z');

    // Only DONE-category status ids are fetched for progress.
    expect(prisma.status.findMany).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID, category: StatusCategory.DONE },
      select: { id: true },
    });
    // Only epics are queried.
    expect(prisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT_ID, type: IssueType.EPIC },
      }),
    );
  });

  it("uses the epic's own startDate/dueDate range when startDate is present, taking priority over child sprint dates", async () => {
    prisma.status.findMany.mockResolvedValue([{ id: 'done-1' }]);
    prisma.issue.findMany.mockResolvedValue([
      {
        id: 'epic-own-dates',
        number: 7,
        title: 'Self-planned epic',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        startDate: new Date('2026-04-01T00:00:00.000Z'),
        dueDate: new Date('2026-04-30T00:00:00.000Z'),
        status: { category: StatusCategory.IN_PROGRESS },
        children: [
          {
            statusId: 'done-1',
            sprint: {
              // Would derive a very different window if own-dates weren't prioritized.
              startDate: new Date('2026-02-01T00:00:00.000Z'),
              endDate: new Date('2026-02-14T00:00:00.000Z'),
            },
          },
        ],
      },
    ]);
    prisma.sprint.findMany.mockResolvedValue([]);

    const result = await service.getRoadmap('user-1', PROJECT_ID);
    const epic = result.epics[0];
    expect(epic.fromOwnDates).toBe(true);
    expect(epic.fromSprints).toBe(false);
    expect(epic.start).toBe('2026-04-01T00:00:00.000Z');
    expect(epic.end).toBe('2026-04-30T00:00:00.000Z');
  });

  it('uses a zero-width own-dates marker when the epic has startDate but no dueDate', async () => {
    prisma.status.findMany.mockResolvedValue([]);
    prisma.issue.findMany.mockResolvedValue([
      {
        id: 'epic-start-only',
        number: 8,
        title: 'Start-only epic',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        startDate: new Date('2026-05-01T00:00:00.000Z'),
        dueDate: null,
        status: { category: StatusCategory.TODO },
        children: [],
      },
    ]);
    prisma.sprint.findMany.mockResolvedValue([]);

    const result = await service.getRoadmap('user-1', PROJECT_ID);
    const epic = result.epics[0];
    expect(epic.fromOwnDates).toBe(true);
    expect(epic.start).toBe('2026-05-01T00:00:00.000Z');
    expect(epic.end).toBe('2026-05-01T00:00:00.000Z');
  });

  it('falls back to createdAt window when no child has a dated sprint', async () => {
    prisma.status.findMany.mockResolvedValue([]);
    prisma.issue.findMany.mockResolvedValue([
      {
        id: 'epic-2',
        number: 9,
        title: 'Unscheduled epic',
        createdAt: new Date('2026-05-10T00:00:00.000Z'),
        status: { category: StatusCategory.TODO },
        children: [{ statusId: 'todo-1', sprint: null }],
      },
    ]);
    prisma.sprint.findMany.mockResolvedValue([]);

    const result = await service.getRoadmap('user-1', PROJECT_ID);

    const epic = result.epics[0];
    expect(epic.fromSprints).toBe(false);
    expect(epic.start).toBe('2026-05-10T00:00:00.000Z');
    expect(epic.end).toBe('2026-05-10T00:00:00.000Z');
    expect(epic.childCount).toBe(1);
    expect(epic.doneCount).toBe(0);
    expect(epic.progress).toBe(0);
  });

  it('returns zero progress for an epic with no children', async () => {
    prisma.status.findMany.mockResolvedValue([{ id: 'done-1' }]);
    prisma.issue.findMany.mockResolvedValue([
      {
        id: 'epic-3',
        number: 1,
        title: 'Empty epic',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        status: { category: StatusCategory.TODO },
        children: [],
      },
    ]);
    prisma.sprint.findMany.mockResolvedValue([]);

    const result = await service.getRoadmap('user-1', PROJECT_ID);
    expect(result.epics[0].childCount).toBe(0);
    expect(result.epics[0].progress).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Cap / truncation tests
  // -------------------------------------------------------------------------

  function makeEpicRow(i: number) {
    return {
      id: `epic-${i}`,
      number: i,
      title: `Epic ${i}`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      status: { category: StatusCategory.TODO },
      children: [],
    };
  }

  it('returns epicsTruncated: false when under the cap', async () => {
    prisma.status.findMany.mockResolvedValue([]);
    prisma.issue.findMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => makeEpicRow(i)),
    );
    prisma.sprint.findMany.mockResolvedValue([]);

    const result = await service.getRoadmap('user-1', PROJECT_ID);
    expect(result.epicsTruncated).toBe(false);
    expect(result.epics).toHaveLength(5);
  });

  it('applies take: ROADMAP_EPICS_CAP + 1 to the epic Prisma query', async () => {
    prisma.status.findMany.mockResolvedValue([]);
    prisma.issue.findMany.mockResolvedValue([]);
    prisma.sprint.findMany.mockResolvedValue([]);

    await service.getRoadmap('user-1', PROJECT_ID);

    expect(prisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: ROADMAP_EPICS_CAP + 1 }),
    );
  });

  it('sets epicsTruncated: true and slices to CAP when result exceeds cap', async () => {
    prisma.status.findMany.mockResolvedValue([]);
    // Return CAP + 1 rows to simulate truncation.
    prisma.issue.findMany.mockResolvedValue(
      Array.from({ length: ROADMAP_EPICS_CAP + 1 }, (_, i) => makeEpicRow(i)),
    );
    prisma.sprint.findMany.mockResolvedValue([]);

    const result = await service.getRoadmap('user-1', PROJECT_ID);
    expect(result.epicsTruncated).toBe(true);
    expect(result.epics).toHaveLength(ROADMAP_EPICS_CAP);
  });

  it('preserves createdAt ordering when truncating epics', async () => {
    prisma.status.findMany.mockResolvedValue([]);
    const rows = Array.from({ length: ROADMAP_EPICS_CAP + 1 }, (_, i) =>
      makeEpicRow(i),
    );
    prisma.issue.findMany.mockResolvedValue(rows);
    prisma.sprint.findMany.mockResolvedValue([]);

    const result = await service.getRoadmap('user-1', PROJECT_ID);

    // First epic is row 0, last is row CAP-1 (extra row dropped at end).
    expect(result.epics[0].id).toBe('epic-0');
    expect(result.epics[ROADMAP_EPICS_CAP - 1].id).toBe(
      `epic-${ROADMAP_EPICS_CAP - 1}`,
    );
    expect(prisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'asc' }] }),
    );
  });
});

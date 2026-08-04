import { IssueType, StatusCategory, SprintState } from '@next-lane/shared';
import * as membership from '../common/membership.util';
import { RoadmapService, ROADMAP_EPICS_CAP } from './roadmap.service';
import type { PrismaService } from '../prisma/prisma.service';

const PROJECT_ID = 'proj-1';
const PROJECT_KEY = 'NL';

function makePrisma() {
  return {
    status: { findMany: jest.fn() },
    issue: { findMany: jest.fn(), findFirst: jest.fn() },
    sprint: { findMany: jest.fn() },
    version: { findMany: jest.fn() },
    issueLink: { findMany: jest.fn() },
  } as unknown as PrismaService & {
    status: { findMany: jest.Mock };
    issue: { findMany: jest.Mock; findFirst: jest.Mock };
    sprint: { findMany: jest.Mock };
    version: { findMany: jest.Mock };
    issueLink: { findMany: jest.Mock };
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

describe('RoadmapService', () => {
  let prisma: MockPrisma;
  let service: RoadmapService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new RoadmapService(prisma);
    // Milestones and dependencies are additive lanes; default them to empty so
    // every pre-existing test keeps asserting exactly what it meant to.
    prisma.version.findMany.mockResolvedValue([]);
    prisma.issueLink.findMany.mockResolvedValue([]);
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
  // ── Child-date rollup (founder report 2026-08-02) ────────────────────────
  //
  // "I put stories in related to the epic with start and end dates. But the
  // dates do not trickle up to the epic level." The rollup only ever read the
  // child's SPRINT, so a dated story that wasn't in a sprint contributed
  // nothing and its epic collapsed to a zero-width createdAt marker.

  it("rolls a child's OWN start/due dates up to the epic, with no sprint involved", async () => {
    prisma.status.findMany.mockResolvedValue([]);
    prisma.issue.findMany.mockResolvedValue([
      {
        id: 'epic-rollup',
        number: 11,
        title: 'Dated stories, no sprints',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        startDate: null,
        dueDate: null,
        status: { category: StatusCategory.IN_PROGRESS },
        children: [
          {
            statusId: 'todo-1',
            startDate: new Date('2026-05-04T00:00:00.000Z'),
            dueDate: new Date('2026-05-15T00:00:00.000Z'),
            sprint: null,
          },
          {
            statusId: 'todo-1',
            startDate: new Date('2026-06-01T00:00:00.000Z'),
            dueDate: new Date('2026-06-30T00:00:00.000Z'),
            sprint: null,
          },
        ],
      },
    ]);
    prisma.sprint.findMany.mockResolvedValue([]);

    const [epic] = (await service.getRoadmap('user-1', PROJECT_ID)).epics;

    // Before the fix this was the epic's createdAt twice — a dot on 2026-01-01.
    expect(epic.start).toBe('2026-05-04T00:00:00.000Z');
    expect(epic.end).toBe('2026-06-30T00:00:00.000Z');
    expect(epic.rollupStart).toBe('2026-05-04T00:00:00.000Z');
    expect(epic.rollupEnd).toBe('2026-06-30T00:00:00.000Z');
    expect(epic.fromOwnDates).toBe(false);
  });

  it("prefers a child's own dates over the dates of the sprint it sits in", async () => {
    prisma.status.findMany.mockResolvedValue([]);
    prisma.issue.findMany.mockResolvedValue([
      {
        id: 'epic-mixed',
        number: 12,
        title: 'Own dates beat sprint dates',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        startDate: null,
        dueDate: null,
        status: { category: StatusCategory.IN_PROGRESS },
        children: [
          {
            statusId: 'todo-1',
            startDate: new Date('2026-09-01T00:00:00.000Z'),
            dueDate: new Date('2026-09-10T00:00:00.000Z'),
            // Explicit dates win: this sprint window must NOT widen the epic.
            sprint: {
              startDate: new Date('2026-02-01T00:00:00.000Z'),
              endDate: new Date('2026-02-14T00:00:00.000Z'),
            },
          },
        ],
      },
    ]);
    prisma.sprint.findMany.mockResolvedValue([]);

    const [epic] = (await service.getRoadmap('user-1', PROJECT_ID)).epics;
    expect(epic.start).toBe('2026-09-01T00:00:00.000Z');
    expect(epic.end).toBe('2026-09-10T00:00:00.000Z');
  });

  it('reports how far children overrun an epic that states its own window', async () => {
    prisma.status.findMany.mockResolvedValue([]);
    prisma.issue.findMany.mockResolvedValue([
      {
        id: 'epic-overrun',
        number: 13,
        title: 'Committed to April, work runs into May',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        startDate: new Date('2026-04-01T00:00:00.000Z'),
        dueDate: new Date('2026-04-30T00:00:00.000Z'),
        status: { category: StatusCategory.IN_PROGRESS },
        children: [
          {
            statusId: 'todo-1',
            startDate: new Date('2026-04-02T00:00:00.000Z'),
            dueDate: new Date('2026-04-20T00:00:00.000Z'),
            sprint: null,
          },
          {
            statusId: 'todo-1',
            startDate: new Date('2026-04-20T00:00:00.000Z'),
            dueDate: new Date('2026-05-10T00:00:00.000Z'),
            sprint: null,
          },
        ],
      },
    ]);
    prisma.sprint.findMany.mockResolvedValue([]);

    const [epic] = (await service.getRoadmap('user-1', PROJECT_ID)).epics;

    // The BAR still shows the commitment — shrinking a deadline must not be
    // hidden by silently widening the bar to match reality.
    expect(epic.start).toBe('2026-04-01T00:00:00.000Z');
    expect(epic.end).toBe('2026-04-30T00:00:00.000Z');
    // ...but reality is reported alongside it.
    expect(epic.rollupEnd).toBe('2026-05-10T00:00:00.000Z');
    expect(epic.overrunDays).toBe(10);
    expect(epic.underrunDays).toBe(0);
    expect(epic.childrenOutside).toBe(1);
  });

  it('treats an epic with only a dueDate as having stated its own window', async () => {
    prisma.status.findMany.mockResolvedValue([]);
    prisma.issue.findMany.mockResolvedValue([
      {
        id: 'epic-due-only',
        number: 14,
        title: 'Deadline but no start',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        startDate: null,
        dueDate: new Date('2026-07-31T00:00:00.000Z'),
        status: { category: StatusCategory.TODO },
        children: [],
      },
    ]);
    prisma.sprint.findMany.mockResolvedValue([]);

    const [epic] = (await service.getRoadmap('user-1', PROJECT_ID)).epics;
    // Previously this fell through to the createdAt fallback and landed in the
    // "No dates" lane, despite carrying the single most important date on it.
    expect(epic.fromOwnDates).toBe(true);
    expect(epic.end).toBe('2026-07-31T00:00:00.000Z');
  });

  it('returns dated versions as milestones with their open-issue count', async () => {
    prisma.status.findMany.mockResolvedValue([{ id: 'done-1' }]);
    prisma.issue.findMany.mockResolvedValue([]);
    prisma.sprint.findMany.mockResolvedValue([]);
    prisma.version.findMany.mockResolvedValue([
      {
        id: 'ver-1',
        name: 'v1.0.0',
        releaseDate: new Date('2026-06-30T00:00:00.000Z'),
        state: 'UNRELEASED',
        issues: [
          { issue: { statusId: 'done-1' } },
          { issue: { statusId: 'todo-1' } },
          { issue: { statusId: 'todo-1' } },
        ],
      },
    ]);

    const result = await service.getRoadmap('user-1', PROJECT_ID);
    expect(result.milestones).toHaveLength(1);
    expect(result.milestones[0].name).toBe('v1.0.0');
    expect(result.milestones[0].openIssueCount).toBe(2);
    // Only dated versions belong on a time axis.
    expect(prisma.version.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT_ID, releaseDate: { not: null } },
      }),
    );
  });

  it('flags a BLOCKS dependency whose blocker finishes after the blocked epic starts', async () => {
    prisma.status.findMany.mockResolvedValue([]);
    prisma.issue.findMany.mockResolvedValue([
      {
        id: 'epic-a',
        number: 1,
        title: 'Blocker, runs late',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        startDate: new Date('2026-03-01T00:00:00.000Z'),
        dueDate: new Date('2026-04-30T00:00:00.000Z'),
        status: { category: StatusCategory.IN_PROGRESS },
        children: [],
      },
      {
        id: 'epic-b',
        number: 2,
        title: 'Blocked, starts early',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        startDate: new Date('2026-04-01T00:00:00.000Z'),
        dueDate: new Date('2026-05-31T00:00:00.000Z'),
        status: { category: StatusCategory.TODO },
        children: [],
      },
    ]);
    prisma.sprint.findMany.mockResolvedValue([]);
    prisma.issueLink.findMany.mockResolvedValue([
      { sourceId: 'epic-a', targetId: 'epic-b' },
    ]);

    const result = await service.getRoadmap('user-1', PROJECT_ID);
    expect(result.dependencies).toEqual([
      { fromEpicId: 'epic-a', toEpicId: 'epic-b', violated: true },
    ]);
  });

  it('does not flag a dependency that is scheduled in a possible order', async () => {
    prisma.status.findMany.mockResolvedValue([]);
    prisma.issue.findMany.mockResolvedValue([
      {
        id: 'epic-a',
        number: 1,
        title: 'Blocker finishes in time',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        startDate: new Date('2026-03-01T00:00:00.000Z'),
        dueDate: new Date('2026-03-31T00:00:00.000Z'),
        status: { category: StatusCategory.IN_PROGRESS },
        children: [],
      },
      {
        id: 'epic-b',
        number: 2,
        title: 'Blocked, starts after',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        startDate: new Date('2026-04-01T00:00:00.000Z'),
        dueDate: new Date('2026-05-31T00:00:00.000Z'),
        status: { category: StatusCategory.TODO },
        children: [],
      },
    ]);
    prisma.sprint.findMany.mockResolvedValue([]);
    prisma.issueLink.findMany.mockResolvedValue([
      { sourceId: 'epic-a', targetId: 'epic-b' },
    ]);

    const result = await service.getRoadmap('user-1', PROJECT_ID);
    expect(result.dependencies[0].violated).toBe(false);
  });

  describe('getEpicChildren', () => {
    it("marks a child whose window came from its sprint, so the UI can tell it apart from a draggable one", async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'epic-1' });
      prisma.issue.findMany.mockResolvedValue([
        {
          id: 'child-own',
          number: 21,
          title: 'Has its own dates',
          type: IssueType.STORY,
          startDate: new Date('2026-05-01T00:00:00.000Z'),
          dueDate: new Date('2026-05-10T00:00:00.000Z'),
          status: { category: StatusCategory.IN_PROGRESS },
          sprint: null,
        },
        {
          id: 'child-sprint',
          number: 22,
          title: 'Only a sprint',
          type: IssueType.TASK,
          startDate: null,
          dueDate: null,
          status: { category: StatusCategory.TODO },
          sprint: {
            name: 'Sprint 9',
            startDate: new Date('2026-06-01T00:00:00.000Z'),
            endDate: new Date('2026-06-14T00:00:00.000Z'),
          },
        },
      ]);

      const res = await service.getEpicChildren('user-1', PROJECT_ID, 'epic-1');

      expect(res.children[0].key).toBe('NL-21');
      expect(res.children[0].fromSprint).toBe(false);
      expect(res.children[1].fromSprint).toBe(true);
      expect(res.children[1].sprintName).toBe('Sprint 9');
      expect(res.children[1].start).toBe('2026-06-01T00:00:00.000Z');
      expect(res.truncated).toBe(false);
    });

    it('404s for an epic in another project rather than leaking its children', async () => {
      prisma.issue.findFirst.mockResolvedValue(null);
      await expect(
        service.getEpicChildren('user-1', PROJECT_ID, 'epic-elsewhere'),
      ).rejects.toThrow(/not found/i);
    });
  });
});

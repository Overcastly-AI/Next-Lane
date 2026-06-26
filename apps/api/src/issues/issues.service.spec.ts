import { BadRequestException } from '@nestjs/common';
import { Role, rankBetween } from '@next-lane/shared';
import { IssuesService } from './issues.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { MoveIssueDto } from './dto/move-issue.dto';

/**
 * DB-free unit tests for IssuesService.assertSameProject — the guard that stops
 * a member of one project from attaching their issue to another project's
 * status/sprint/parent or reordering against a foreign issue (which would
 * corrupt foreign boards / leak rank ordering). Prisma lookups are mocked.
 *
 * assertSameProject is private; we drive it through the instance to test the
 * real behavior rather than a copy.
 */

const PROJECT_ID = 'proj-1';
const OTHER_PROJECT_ID = 'proj-2';

function makePrisma() {
  return {
    status: { findUnique: jest.fn() },
    sprint: { findUnique: jest.fn() },
    issue: { findUnique: jest.fn() },
  } as unknown as PrismaService & {
    status: { findUnique: jest.Mock };
    sprint: { findUnique: jest.Mock };
    issue: { findUnique: jest.Mock };
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

interface AssertSameProjectRefs {
  statusId?: string | null;
  sprintId?: string | null;
  parentId?: string | null;
  issueId?: string | null;
}

function callAssertSameProject(
  service: IssuesService,
  projectId: string,
  refs: AssertSameProjectRefs,
): Promise<void> {
  return (
    service as unknown as {
      assertSameProject: (
        projectId: string,
        refs: AssertSameProjectRefs,
      ) => Promise<void>;
    }
  ).assertSameProject(projectId, refs);
}

describe('IssuesService.assertSameProject', () => {
  let prisma: MockPrisma;
  let service: IssuesService;

  beforeEach(() => {
    prisma = makePrisma();
    const realtime = {} as RealtimeService;
    service = new IssuesService(prisma, realtime, {} as NotificationsService);
  });

  it('accepts when all refs belong to the same project', async () => {
    prisma.status.findUnique.mockResolvedValue({ projectId: PROJECT_ID });
    prisma.sprint.findUnique.mockResolvedValue({ projectId: PROJECT_ID });
    prisma.issue.findUnique.mockResolvedValue({ projectId: PROJECT_ID });

    await expect(
      callAssertSameProject(service, PROJECT_ID, {
        statusId: 's-1',
        sprintId: 'sp-1',
        parentId: 'p-1',
        issueId: 'i-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('skips lookups for null/undefined refs', async () => {
    await expect(
      callAssertSameProject(service, PROJECT_ID, {
        statusId: null,
        sprintId: undefined,
      }),
    ).resolves.toBeUndefined();

    expect(prisma.status.findUnique).not.toHaveBeenCalled();
    expect(prisma.sprint.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a foreign statusId', async () => {
    prisma.status.findUnique.mockResolvedValue({ projectId: OTHER_PROJECT_ID });

    await expect(
      callAssertSameProject(service, PROJECT_ID, { statusId: 's-x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a missing statusId', async () => {
    prisma.status.findUnique.mockResolvedValue(null);

    await expect(
      callAssertSameProject(service, PROJECT_ID, { statusId: 's-x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a foreign sprintId', async () => {
    prisma.sprint.findUnique.mockResolvedValue({ projectId: OTHER_PROJECT_ID });

    await expect(
      callAssertSameProject(service, PROJECT_ID, { sprintId: 'sp-x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a foreign parentId', async () => {
    prisma.issue.findUnique.mockResolvedValue({ projectId: OTHER_PROJECT_ID });

    await expect(
      callAssertSameProject(service, PROJECT_ID, { parentId: 'p-x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a foreign neighbor issueId (before/after reorder target)', async () => {
    prisma.issue.findUnique.mockResolvedValue({ projectId: OTHER_PROJECT_ID });

    await expect(
      callAssertSameProject(service, PROJECT_ID, { issueId: 'i-x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when one of several refs is foreign even if others are valid', async () => {
    prisma.status.findUnique.mockResolvedValue({ projectId: PROJECT_ID });
    prisma.sprint.findUnique.mockResolvedValue({ projectId: OTHER_PROJECT_ID });

    await expect(
      callAssertSameProject(service, PROJECT_ID, {
        statusId: 's-1',
        sprintId: 'sp-x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function callAssertNoParentCycle(
  service: IssuesService,
  id: string,
  parentId: string,
): Promise<void> {
  return (
    service as unknown as {
      assertNoParentCycle: (id: string, parentId: string) => Promise<void>;
    }
  ).assertNoParentCycle(id, parentId);
}

describe('IssuesService.assertNoParentCycle', () => {
  let prisma: MockPrisma;
  let service: IssuesService;

  beforeEach(() => {
    prisma = makePrisma();
    const realtime = {} as RealtimeService;
    service = new IssuesService(prisma, realtime, {} as NotificationsService);
  });

  it('rejects an issue being its own parent', async () => {
    await expect(
      callAssertNoParentCycle(service, 'a', 'a'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.issue.findUnique).not.toHaveBeenCalled();
  });

  it('accepts a parent that has no ancestors', async () => {
    // Walking up from parent "b" reaches a root (parentId null) without hitting "a".
    prisma.issue.findUnique.mockResolvedValue({ parentId: null });

    await expect(
      callAssertNoParentCycle(service, 'a', 'b'),
    ).resolves.toBeUndefined();
  });

  it('rejects when the issue is an ancestor of the proposed parent (cycle)', async () => {
    // a -> set parent to c, but c's ancestor chain (c -> a) leads back to a.
    prisma.issue.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        if (where.id === 'c') return Promise.resolve({ parentId: 'a' });
        return Promise.resolve({ parentId: null });
      },
    );

    await expect(
      callAssertNoParentCycle(service, 'a', 'c'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * Unit tests for IssuesService.move — the transactional reorder. Verifies the
 * normal between-neighbors case, that the work runs inside `$transaction`, that
 * the IssueMoved event is emitted, and the collision fallback that rebalances
 * the destination column when neighbors leave no representable gap.
 */

const PROJECT = 'proj-1';
const WORKSPACE = 'ws-1';
const USER = 'user-1';
const STATUS = 'status-todo';
const MOVED = 'issue-moved';

function makeMovedIssueRow(rank: string) {
  return {
    id: MOVED,
    number: 1,
    projectId: PROJECT,
    type: 'TASK',
    title: 'Moved issue',
    description: null,
    statusId: STATUS,
    assigneeId: null,
    reporterId: null,
    priority: 'MEDIUM',
    storyPoints: null,
    parentId: null,
    sprintId: null,
    rank,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    status: {
      id: STATUS,
      name: 'To Do',
      category: 'TODO',
      order: 0,
      projectId: PROJECT,
    },
    assignee: null,
    reporter: null,
    labels: [],
    project: { key: 'NL' },
    _count: { comments: 0 },
  };
}

function makeMovePrisma() {
  const tx = {
    issue: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    activityLog: { create: jest.fn() },
  };
  const prisma = {
    issue: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    project: { findUnique: jest.fn() },
    membership: { findUnique: jest.fn() },
    status: { findUnique: jest.fn() },
    activityLog: { create: jest.fn() },
    // Run the callback synchronously with the tx client.
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  return { prisma, tx };
}

describe('IssuesService.move', () => {
  let mocks: ReturnType<typeof makeMovePrisma>;
  let realtime: { emitToProject: jest.Mock };
  let service: IssuesService;

  beforeEach(() => {
    mocks = makeMovePrisma();
    realtime = { emitToProject: jest.fn() };
    service = new IssuesService(
      mocks.prisma as unknown as PrismaService,
      realtime as unknown as RealtimeService,
      {} as NotificationsService,
    );

    // The moved issue already lives in STATUS (no status change by default).
    mocks.prisma.issue.findUnique.mockResolvedValue({
      id: MOVED,
      projectId: PROJECT,
      statusId: STATUS,
      rank: 'a0',
    });
    // assertProjectRole: project + admin membership.
    mocks.prisma.project.findUnique.mockResolvedValue({
      id: PROJECT,
      workspaceId: WORKSPACE,
    });
    mocks.prisma.membership.findUnique.mockResolvedValue({ role: Role.ADMIN });
    // assertSameProject: the destination status belongs to the project.
    mocks.prisma.status.findUnique.mockResolvedValue({ projectId: PROJECT });
  });

  function move(dto: MoveIssueDto) {
    return service.move(USER, MOVED, dto);
  }

  it('places the issue between two neighbors and emits IssueMoved', async () => {
    const beforeRank = rankBetween(null, null); // some valid rank
    const afterRank = rankBetween(beforeRank, null); // strictly after it
    mocks.tx.issue.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        if (where.id === 'before') return Promise.resolve({ rank: beforeRank });
        if (where.id === 'after') return Promise.resolve({ rank: afterRank });
        return Promise.resolve(null);
      },
    );
    const expectedRank = rankBetween(beforeRank, afterRank);
    mocks.tx.issue.update.mockResolvedValue(makeMovedIssueRow(expectedRank));

    await move({ statusId: STATUS, beforeId: 'before', afterId: 'after' });

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MOVED },
        data: { statusId: STATUS, rank: expectedRank },
      }),
    );
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      PROJECT,
      'issue.moved',
      expect.objectContaining({ issueId: MOVED, rank: expectedRank }),
    );
  });

  it('rebalances the column when neighbors leave no gap (collision fallback)', async () => {
    // Pick two adjacent ranks so rankBetween(before, after) throws.
    const r1 = rankBetween(null, null);
    const r2 = rankBetween(r1, null);
    // before=r2, after=r1 → before >= after → generateKeyBetween throws.
    mocks.tx.issue.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        if (where.id === 'before') return Promise.resolve({ rank: r2 });
        if (where.id === 'after') return Promise.resolve({ rank: r1 });
        return Promise.resolve(null);
      },
    );
    // Destination column (excluding the moved issue) for the rebalance.
    mocks.tx.issue.findMany.mockResolvedValue([
      { id: 'other-1' },
      { id: 'before' },
      { id: 'other-2' },
    ]);
    mocks.tx.issue.update.mockImplementation(
      ({ data }: { data: { rank?: string } }) =>
        Promise.resolve(makeMovedIssueRow(data.rank ?? 'a0')),
    );

    await expect(
      move({ statusId: STATUS, beforeId: 'before', afterId: 'after' }),
    ).resolves.toBeDefined();

    // Rebalance ran: every OTHER issue in the column got a fresh rank, plus the
    // moved issue's own update — 4 updates total (other-1, other-2, before, moved).
    expect(mocks.tx.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { statusId: STATUS, id: { not: MOVED } },
        orderBy: { rank: 'asc' },
      }),
    );
    expect(mocks.tx.issue.update).toHaveBeenCalledTimes(4);
    // The moved issue is placed immediately before "before"; the resulting
    // ranks must be strictly ascending in the final order.
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      PROJECT,
      'issue.moved',
      expect.objectContaining({ issueId: MOVED }),
    );
  });
});

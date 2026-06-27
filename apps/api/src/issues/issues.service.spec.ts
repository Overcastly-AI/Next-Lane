import { BadRequestException } from '@nestjs/common';
import { Role, rankBetween } from '@next-lane/shared';
import {
  IssuesService,
  DEFAULT_ISSUES_PAGE_SIZE,
} from './issues.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { WebhooksService } from '../webhooks/webhooks.service';

const webhooksMock = { dispatch: jest.fn() } as unknown as WebhooksService;
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
  const txClient = {
    $queryRaw: jest.fn(),
    issue: { findUnique: jest.fn(), update: jest.fn() },
    activityLog: { createMany: jest.fn() },
  };
  const prisma = {
    status: { findUnique: jest.fn() },
    sprint: { findUnique: jest.fn() },
    issue: { findUnique: jest.fn() },
    // By default run the transaction callback with the txClient.
    $transaction: jest.fn((cb: (tx: typeof txClient) => unknown) => cb(txClient)),
    _tx: txClient,
  };
  return prisma as typeof prisma & {
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
    service = new IssuesService(
      prisma as unknown as PrismaService,
      realtime,
      {} as NotificationsService,
      webhooksMock,
    );
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

/**
 * Helper to call the private `assertNoParentCycleCTE` method directly.
 * The new implementation uses a `WITH RECURSIVE` CTE via `tx.$queryRaw`, so we
 * supply a fake transaction client with `$queryRaw` mocked.
 */
function callAssertNoParentCycleCTE(
  service: IssuesService,
  tx: { $queryRaw: jest.Mock },
  id: string,
  parentId: string,
): Promise<void> {
  return (
    service as unknown as {
      assertNoParentCycleCTE: (
        tx: { $queryRaw: jest.Mock },
        id: string,
        parentId: string,
      ) => Promise<void>;
    }
  ).assertNoParentCycleCTE(tx as never, id, parentId);
}

describe('IssuesService.assertNoParentCycleCTE', () => {
  let prisma: MockPrisma;
  let service: IssuesService;
  let tx: { $queryRaw: jest.Mock };

  beforeEach(() => {
    prisma = makePrisma();
    tx = { $queryRaw: jest.fn() };
    const realtime = {} as RealtimeService;
    service = new IssuesService(
      prisma as unknown as PrismaService,
      realtime,
      {} as NotificationsService,
      webhooksMock,
    );
  });

  it('rejects an issue being its own parent (short-circuits before CTE)', async () => {
    await expect(
      callAssertNoParentCycleCTE(service, tx, 'a', 'a'),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Short-circuit: no DB round-trip needed.
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('accepts a valid parent when CTE reports no cycle', async () => {
    // CTE returns cycle_detected = false → valid hierarchy.
    tx.$queryRaw.mockResolvedValue([{ cycle_detected: false }]);

    await expect(
      callAssertNoParentCycleCTE(service, tx, 'a', 'b'),
    ).resolves.toBeUndefined();

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects a direct cycle (parentId is a child of id)', async () => {
    // CTE found that 'a' appears in the ancestor chain of 'c' → cycle.
    tx.$queryRaw.mockResolvedValue([{ cycle_detected: true }]);

    await expect(
      callAssertNoParentCycleCTE(service, tx, 'a', 'c'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a deep multi-level cycle', async () => {
    // Hierarchy: a → b → c → d → e; trying to set a's parent to e.
    // CTE would walk e.parent=d, d.parent=c, c.parent=b, b.parent=a → cycle.
    tx.$queryRaw.mockResolvedValue([{ cycle_detected: true }]);

    await expect(
      callAssertNoParentCycleCTE(service, tx, 'a', 'e'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a valid deep hierarchy (no cycle)', async () => {
    // Hierarchy: root → a → b → c. Setting c's parent to 'd' (an unrelated node)
    // is fine; walking d's ancestors never reaches 'c'.
    tx.$queryRaw.mockResolvedValue([{ cycle_detected: false }]);

    await expect(
      callAssertNoParentCycleCTE(service, tx, 'c', 'd'),
    ).resolves.toBeUndefined();
  });

  it('handles CTE returning an empty result set gracefully (no cycle)', async () => {
    // Defensive: if parentId has no parent itself the CTE anchor produces 0 rows;
    // the EXISTS sub-select returns false → no cycle.
    tx.$queryRaw.mockResolvedValue([{ cycle_detected: false }]);

    await expect(
      callAssertNoParentCycleCTE(service, tx, 'a', 'root'),
    ).resolves.toBeUndefined();
  });

  it('runs a single $queryRaw call (not N serial lookups)', async () => {
    tx.$queryRaw.mockResolvedValue([{ cycle_detected: false }]);

    await callAssertNoParentCycleCTE(service, tx, 'a', 'b');

    // Exactly one CTE query regardless of ancestor chain depth.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
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
      webhooksMock,
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

/**
 * Unit tests for IssuesService.findAll cursor pagination. Verifies the page
 * boundary: when exactly one more row than the requested page exists, the
 * service trims to the page size, emits a non-null nextCursor, and queries the
 * next page strictly after the last returned issue (keyset predicate). When the
 * page is not full, nextCursor is null.
 */
describe('IssuesService.findAll pagination', () => {
  const PROJECT = 'proj-1';
  const USER = 'user-1';

  function makeIssueRow(id: string, createdAt: string) {
    return {
      id,
      number: 1,
      projectId: PROJECT,
      type: 'TASK',
      title: id,
      description: null,
      statusId: 'status-1',
      assigneeId: null,
      reporterId: null,
      priority: 'MEDIUM',
      storyPoints: null,
      parentId: null,
      sprintId: null,
      rank: 'a0',
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
      status: {
        id: 'status-1',
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

  function makePaginationPrisma() {
    return {
      issue: { findMany: jest.fn() },
      project: { findUnique: jest.fn() },
      membership: { findUnique: jest.fn() },
    };
  }

  let prisma: ReturnType<typeof makePaginationPrisma>;
  let service: IssuesService;

  beforeEach(() => {
    prisma = makePaginationPrisma();
    // assertProjectMember: project + membership exist.
    prisma.project.findUnique.mockResolvedValue({
      id: PROJECT,
      workspaceId: 'ws-1',
    });
    prisma.membership.findUnique.mockResolvedValue({ role: Role.MEMBER });
    service = new IssuesService(
      prisma as unknown as PrismaService,
      {} as RealtimeService,
      {} as NotificationsService,
      {} as WebhooksService,
    );
  });

  it('requires projectId', async () => {
    await expect(service.findAll(USER, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('trims to the requested limit and returns a nextCursor when more exist', async () => {
    // Request limit=2; service fetches take+1=3 rows to detect a further page.
    const rows = [
      makeIssueRow('i1', '2026-01-01T00:00:00.000Z'),
      makeIssueRow('i2', '2026-01-02T00:00:00.000Z'),
      makeIssueRow('i3', '2026-01-03T00:00:00.000Z'),
    ];
    prisma.issue.findMany.mockResolvedValue(rows);

    const result = await service.findAll(USER, { projectId: PROJECT, limit: 2 });

    expect(prisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
    // Only the first 2 are returned; the sentinel 3rd row is dropped.
    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.id)).toEqual(['i1', 'i2']);
    // Cursor points at the last RETURNED item (i2), not the sentinel.
    expect(result.nextCursor).not.toBeNull();
    const decoded = Buffer.from(
      result.nextCursor as string,
      'base64url',
    ).toString('utf8');
    expect(decoded).toBe('2026-01-02T00:00:00.000Z|i2');
  });

  it('returns nextCursor=null when the page is not full', async () => {
    const rows = [
      makeIssueRow('i1', '2026-01-01T00:00:00.000Z'),
      makeIssueRow('i2', '2026-01-02T00:00:00.000Z'),
    ];
    prisma.issue.findMany.mockResolvedValue(rows);

    const result = await service.findAll(USER, { projectId: PROJECT, limit: 5 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it('applies a keyset predicate continuing after the cursor', async () => {
    prisma.issue.findMany.mockResolvedValue([]);
    const cursor = Buffer.from('2026-01-02T00:00:00.000Z|i2').toString(
      'base64url',
    );

    await service.findAll(USER, { projectId: PROJECT, cursor });

    const call = prisma.issue.findMany.mock.calls[0][0];
    expect(call.where.OR).toEqual([
      { createdAt: { gt: new Date('2026-01-02T00:00:00.000Z') } },
      { createdAt: new Date('2026-01-02T00:00:00.000Z'), id: { gt: 'i2' } },
    ]);
  });

  it('ignores a malformed cursor (starts from the beginning)', async () => {
    prisma.issue.findMany.mockResolvedValue([]);

    await service.findAll(USER, {
      projectId: PROJECT,
      cursor: 'not-a-valid-cursor!!!',
    });

    const call = prisma.issue.findMany.mock.calls[0][0];
    expect(call.where.OR).toBeUndefined();
    // Default page size applies when no limit is given.
    expect(call.take).toBe(DEFAULT_ISSUES_PAGE_SIZE + 1);
  });
});

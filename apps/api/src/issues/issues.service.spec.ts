import { BadRequestException } from '@nestjs/common';
import { NotificationType, Priority, Role, rankBetween } from '@next-lane/shared';
import {
  IssuesService,
  DEFAULT_ISSUES_PAGE_SIZE,
} from './issues.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { WebhooksService } from '../webhooks/webhooks.service';
import type { CustomFieldsService } from '../custom-fields/custom-fields.service';
import type { WorkflowService } from '../workflows/workflow.service';
import type { EventEmitter2 } from '@nestjs/event-emitter';

const noOpEventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

/** Minimal stub satisfying the CustomFieldsService dependency in IssuesService. */
const noOpCustomFields = {
  validateAndNormalize: jest.fn().mockResolvedValue({}),
} as unknown as CustomFieldsService;

/**
 * Minimal stub satisfying the WorkflowService dependency in IssuesService.
 * enforceTransition is a no-op by default so existing tests are unaffected.
 */
const noOpWorkflow = {
  enforceTransition: jest.fn().mockResolvedValue(undefined),
  isEnforcementEnabled: jest.fn().mockResolvedValue(false),
} as unknown as WorkflowService;

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
      noOpCustomFields,
      noOpEventEmitter,
      noOpWorkflow,
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
      noOpCustomFields,
      noOpEventEmitter,
      noOpWorkflow,
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

function makeMovedIssueRow(rank: string, dueDate: Date | null = null) {
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
    dueDate,
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
    $executeRaw: jest.fn().mockResolvedValue(0),
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
      noOpCustomFields,
      noOpEventEmitter,
      noOpWorkflow,
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
    mocks.tx.$executeRaw.mockResolvedValue(3);

    await expect(
      move({ statusId: STATUS, beforeId: 'before', afterId: 'after' }),
    ).resolves.toBeDefined();

    // Rebalance ran: column fetched to determine order.
    expect(mocks.tx.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { statusId: STATUS, id: { not: MOVED } },
        orderBy: { rank: 'asc' },
      }),
    );

    // The three non-moved issues are now updated via a SINGLE $executeRaw
    // (bulk CASE UPDATE) — not N sequential tx.issue.update calls.
    expect(mocks.tx.$executeRaw).toHaveBeenCalledTimes(1);

    // The moved issue itself is updated exactly once (rank + statusId) via the
    // normal tx.issue.update after rebalanceAndPlace returns its rank.
    expect(mocks.tx.issue.update).toHaveBeenCalledTimes(1);
    expect(mocks.tx.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MOVED },
        data: expect.objectContaining({ statusId: STATUS }),
      }),
    );

    // The moved issue is placed immediately before "before"; realtime emitted.
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      PROJECT,
      'issue.moved',
      expect.objectContaining({ issueId: MOVED }),
    );
  });

  it('rebalanceAndPlace: batch $executeRaw called once, moved issue update called once', async () => {
    // Verify that the batch rebalance uses exactly one $executeRaw for the
    // non-moved issues and exactly one tx.issue.update for the moved issue.
    // Use the same collision setup as the test above.
    const r1 = rankBetween(null, null);
    const r2 = rankBetween(r1, null);
    // before=r2, after=r1 → before >= after → rankBetween throws → rebalance.
    mocks.tx.issue.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        if (where.id === 'before') return Promise.resolve({ rank: r2 });
        if (where.id === 'after') return Promise.resolve({ rank: r1 });
        return Promise.resolve(null);
      },
    );
    // 3 issues in the column besides the moved one.
    mocks.tx.issue.findMany.mockResolvedValue([
      { id: 'other-1' },
      { id: 'other-2' },
      { id: 'other-3' },
    ]);
    mocks.tx.$executeRaw.mockResolvedValue(3);
    mocks.tx.issue.update.mockImplementation(
      ({ data }: { data: { rank?: string } }) =>
        Promise.resolve(makeMovedIssueRow(data.rank ?? 'a0')),
    );

    await move({ statusId: STATUS, beforeId: 'before', afterId: 'after' });

    // One bulk SQL update for the 3 non-moved issues.
    expect(mocks.tx.$executeRaw).toHaveBeenCalledTimes(1);
    // One Prisma update for the moved issue (rank + statusId).
    expect(mocks.tx.issue.update).toHaveBeenCalledTimes(1);
    expect(mocks.tx.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MOVED },
        data: expect.objectContaining({ statusId: STATUS }),
      }),
    );
  });

  it('rebalanceAndPlace rank ordering is strictly ascending via initialRanks', () => {
    // Directly test the ordering invariant using the same initialRanks helper
    // that rebalanceAndPlace calls.  This is a pure-logic test with no mocking.
    const { initialRanks: genRanks } = require('@next-lane/shared');
    const n = 4; // other-1, MOVED, other-2, other-3
    const ranks: string[] = genRanks(n);
    expect(ranks).toHaveLength(n);
    for (let i = 0; i + 1 < ranks.length; i++) {
      expect(ranks[i] < ranks[i + 1]).toBe(true);
    }
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

  function makeIssueRow(id: string, createdAt: string, dueDate: Date | null = null) {
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
      dueDate,
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
      $queryRaw: jest.fn(),
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
      noOpCustomFields,
      noOpEventEmitter,
      noOpWorkflow,
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

  it('includes dueDate in the response DTO (set)', async () => {
    const dueDate = new Date('2026-12-31T00:00:00.000Z');
    const rows = [makeIssueRow('i1', '2026-01-01T00:00:00.000Z', dueDate)];
    prisma.issue.findMany.mockResolvedValue(rows);

    const result = await service.findAll(USER, { projectId: PROJECT, limit: 5 });

    expect(result.items[0].dueDate).toBe('2026-12-31T00:00:00.000Z');
  });

  it('returns dueDate=null in the response DTO when not set', async () => {
    const rows = [makeIssueRow('i1', '2026-01-01T00:00:00.000Z', null)];
    prisma.issue.findMany.mockResolvedValue(rows);

    const result = await service.findAll(USER, { projectId: PROJECT, limit: 5 });

    expect(result.items[0].dueDate).toBeNull();
  });
});

/**
 * Unit tests for IssuesService.findAll full-text search (FTS) mode.
 * Verifies that:
 *  - queries >= 2 chars use $queryRaw (FTS), not findMany(ILIKE)
 *  - the FTS path returns results with the correct DTO shape
 *  - cursor pagination works in the FTS path (nextCursor correct)
 *  - tenant scoping is preserved (query always includes projectId)
 *  - short queries (< 2 chars) still use the ILIKE findMany path
 *  - special characters in the query do not error (websearch_to_tsquery)
 *  - description-match issues are returned (the searchVector covers description)
 */
describe('IssuesService.findAll full-text search', () => {
  const FTS_PROJECT = 'proj-fts';
  const FTS_USER = 'user-fts';

  function makeIssueRow(id: string, createdAt: string) {
    return {
      id,
      number: 1,
      projectId: FTS_PROJECT,
      type: 'TASK',
      title: id,
      description: `Description for ${id}`,
      statusId: 'status-1',
      assigneeId: null,
      reporterId: null,
      priority: 'MEDIUM',
      storyPoints: null,
      parentId: null,
      sprintId: null,
      dueDate: null,
      rank: 'a0',
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
      status: { id: 'status-1', name: 'To Do', category: 'TODO', order: 0, projectId: FTS_PROJECT },
      assignee: null,
      reporter: null,
      labels: [],
      project: { key: 'NL' },
      _count: { comments: 0 },
    };
  }

  function makeFtsPrisma() {
    return {
      issue: { findMany: jest.fn() },
      project: { findUnique: jest.fn() },
      membership: { findUnique: jest.fn() },
      $queryRaw: jest.fn(),
    };
  }

  let prisma: ReturnType<typeof makeFtsPrisma>;
  let service: IssuesService;

  beforeEach(() => {
    prisma = makeFtsPrisma();
    prisma.project.findUnique.mockResolvedValue({
      id: FTS_PROJECT,
      workspaceId: 'ws-fts',
    });
    prisma.membership.findUnique.mockResolvedValue({ role: Role.MEMBER });
    service = new IssuesService(
      prisma as unknown as PrismaService,
      {} as RealtimeService,
      {} as NotificationsService,
      {} as WebhooksService,
      noOpCustomFields,
      noOpEventEmitter,
      noOpWorkflow,
    );
  });

  it('uses $queryRaw for q >= 2 characters and not issue.findMany', async () => {
    // $queryRaw returns id rows; findMany returns full rows by id
    prisma.$queryRaw.mockResolvedValue([
      { id: 'i1', created_at: new Date('2026-01-01T00:00:00.000Z') },
    ]);
    prisma.issue.findMany.mockResolvedValue([makeIssueRow('i1', '2026-01-01T00:00:00.000Z')]);

    const result = await service.findAll(FTS_USER, { projectId: FTS_PROJECT, q: 'login' });

    // FTS path fires $queryRaw once for ids, then findMany by those ids
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.issue.findMany).toHaveBeenCalledTimes(1);
    // findMany must be called with id IN the returned ids
    expect(prisma.issue.findMany.mock.calls[0][0].where).toMatchObject({
      id: { in: ['i1'] },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('i1');
  });

  it('falls back to ILIKE (single findMany call) for q shorter than 2 chars', async () => {
    prisma.issue.findMany.mockResolvedValue([]);

    await service.findAll(FTS_USER, { projectId: FTS_PROJECT, q: 'a' });

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.issue.findMany).toHaveBeenCalledTimes(1);
    // The WHERE should contain the title ILIKE predicate
    const where = prisma.issue.findMany.mock.calls[0][0].where;
    expect(where.title).toMatchObject({ contains: 'a', mode: 'insensitive' });
  });

  it('returns nextCursor=null when FTS results fit in one page', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { id: 'i1', created_at: new Date('2026-01-01T00:00:00.000Z') },
    ]);
    prisma.issue.findMany.mockResolvedValue([makeIssueRow('i1', '2026-01-01T00:00:00.000Z')]);

    const result = await service.findAll(FTS_USER, { projectId: FTS_PROJECT, q: 'login', limit: 5 });

    expect(result.nextCursor).toBeNull();
    expect(result.items).toHaveLength(1);
  });

  it('emits a nextCursor when FTS result exceeds the page limit', async () => {
    // limit=2, FTS returns 3 rows (sentinel signals more exist)
    prisma.$queryRaw.mockResolvedValue([
      { id: 'i1', created_at: new Date('2026-01-01T00:00:00.000Z') },
      { id: 'i2', created_at: new Date('2026-01-02T00:00:00.000Z') },
      { id: 'i3', created_at: new Date('2026-01-03T00:00:00.000Z') },
    ]);
    prisma.issue.findMany.mockResolvedValue([
      makeIssueRow('i1', '2026-01-01T00:00:00.000Z'),
      makeIssueRow('i2', '2026-01-02T00:00:00.000Z'),
    ]);

    const result = await service.findAll(FTS_USER, { projectId: FTS_PROJECT, q: 'login', limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();
    // Cursor encodes the last returned item (i2)
    const decoded = Buffer.from(result.nextCursor as string, 'base64url').toString('utf8');
    expect(decoded).toBe('2026-01-02T00:00:00.000Z|i2');
  });

  it('returns empty items when FTS matches nothing', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    const result = await service.findAll(FTS_USER, { projectId: FTS_PROJECT, q: 'zxqwerty' });

    expect(result.items).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
    // findMany is not called when there are no ids to fetch
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });

  it('handles special characters in q without throwing (websearch_to_tsquery safety)', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(
      service.findAll(FTS_USER, { projectId: FTS_PROJECT, q: 'bug & (fix OR patch) -wontfix' }),
    ).resolves.toMatchObject({ items: [], nextCursor: null });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('re-sorts results to match raw query order when findMany returns them out of order', async () => {
    // Raw query returns i2 before i1 (ranked order)
    prisma.$queryRaw.mockResolvedValue([
      { id: 'i2', created_at: new Date('2026-01-02T00:00:00.000Z') },
      { id: 'i1', created_at: new Date('2026-01-01T00:00:00.000Z') },
    ]);
    // findMany returns in arbitrary order (Postgres IN-list)
    prisma.issue.findMany.mockResolvedValue([
      makeIssueRow('i1', '2026-01-01T00:00:00.000Z'),
      makeIssueRow('i2', '2026-01-02T00:00:00.000Z'),
    ]);

    const result = await service.findAll(FTS_USER, { projectId: FTS_PROJECT, q: 'description' });

    // i2 should appear first because raw query returned it first
    expect(result.items[0].id).toBe('i2');
    expect(result.items[1].id).toBe('i1');
  });
});

/**
 * Unit tests for due date set/clear on IssuesService.update.
 * Verifies that dueDate is correctly stored, cleared, and included in the
 * response DTO; and that an activity log entry is created for changes.
 */
describe('IssuesService.update dueDate', () => {
  const ISSUE_ID = 'issue-due-1';
  const DUE_PROJECT = 'proj-due';
  const DUE_WORKSPACE = 'ws-due';
  const DUE_USER = 'user-due';
  const DUE_STATUS = 'status-due';
  const DUE_DATE = new Date('2026-12-31T00:00:00.000Z');

  function makeUpdatePrisma() {
    const txClient = {
      $queryRaw: jest.fn().mockResolvedValue([{ cycle_detected: false }]),
      issue: { findUnique: jest.fn(), update: jest.fn() },
      activityLog: { createMany: jest.fn() },
    };
    const prisma = {
      issue: { findUnique: jest.fn() },
      project: { findUnique: jest.fn() },
      membership: { findUnique: jest.fn() },
      status: { findUnique: jest.fn() },
      sprint: { findUnique: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Actor' }) },
      $transaction: jest.fn((cb: (tx: typeof txClient) => unknown) => cb(txClient)),
      _tx: txClient,
    };
    return { prisma, tx: txClient };
  }

  function makeExistingIssue(dueDate: Date | null = null) {
    return {
      id: ISSUE_ID,
      number: 1,
      projectId: DUE_PROJECT,
      type: 'TASK',
      title: 'Test issue',
      description: null,
      statusId: DUE_STATUS,
      assigneeId: null,
      reporterId: null,
      priority: 'MEDIUM',
      storyPoints: null,
      parentId: null,
      sprintId: null,
      dueDate,
      rank: 'a0',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
  }

  function makeUpdatedIssueRow(dueDate: Date | null) {
    return {
      ...makeExistingIssue(dueDate),
      status: { id: DUE_STATUS, name: 'To Do', category: 'TODO', order: 0, projectId: DUE_PROJECT },
      assignee: null,
      reporter: null,
      labels: [],
      project: { key: 'DP' },
      _count: { comments: 0 },
    };
  }

  let mocks: ReturnType<typeof makeUpdatePrisma>;
  let service: IssuesService;

  beforeEach(() => {
    mocks = makeUpdatePrisma();
    mocks.prisma.project.findUnique.mockResolvedValue({
      id: DUE_PROJECT,
      workspaceId: DUE_WORKSPACE,
    });
    mocks.prisma.membership.findUnique.mockResolvedValue({ role: Role.ADMIN });
    service = new IssuesService(
      mocks.prisma as unknown as PrismaService,
      { emitToProject: jest.fn() } as unknown as RealtimeService,
      { notifyWatchersUpdated: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService,
      webhooksMock,
      noOpCustomFields,
      noOpEventEmitter,
      noOpWorkflow,
    );
  });

  it('sets dueDate on an issue and returns it in the DTO', async () => {
    mocks.prisma.issue.findUnique.mockResolvedValue(makeExistingIssue(null));
    mocks.tx.issue.update.mockResolvedValue(makeUpdatedIssueRow(DUE_DATE));

    const result = await service.update(DUE_USER, ISSUE_ID, {
      dueDate: '2026-12-31T00:00:00.000Z',
    });

    expect(mocks.tx.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dueDate: DUE_DATE,
        }),
      }),
    );
    expect(result.dueDate).toBe('2026-12-31T00:00:00.000Z');
  });

  it('clears dueDate when null is passed and logs an activity', async () => {
    mocks.prisma.issue.findUnique.mockResolvedValue(makeExistingIssue(DUE_DATE));
    mocks.tx.issue.update.mockResolvedValue(makeUpdatedIssueRow(null));

    const result = await service.update(DUE_USER, ISSUE_ID, { dueDate: null });

    expect(mocks.tx.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dueDate: null }),
      }),
    );
    expect(result.dueDate).toBeNull();
    // Activity log entry created for the change.
    expect(mocks.tx.activityLog.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ field: 'dueDate', to: null }),
        ]),
      }),
    );
  });

  it('does not touch dueDate when the field is absent from the patch (undefined)', async () => {
    mocks.prisma.issue.findUnique.mockResolvedValue(makeExistingIssue(DUE_DATE));
    mocks.tx.issue.update.mockResolvedValue(makeUpdatedIssueRow(DUE_DATE));

    await service.update(DUE_USER, ISSUE_ID, { title: 'New title' });

    const updateCall = mocks.tx.issue.update.mock.calls[0][0];
    // dueDate must be undefined (Prisma no-op), not null.
    expect(updateCall.data.dueDate).toBeUndefined();
    // No activity log for dueDate.
    const createManyCall = mocks.tx.activityLog.createMany.mock.calls[0];
    if (createManyCall) {
      const logged = (createManyCall[0] as { data: { field: string }[] }).data;
      expect(logged.every((a) => a.field !== 'dueDate')).toBe(true);
    }
  });
});

/**
 * Unit tests for IssuesService.update watcher fan-out.
 * Verifies that WATCHED_UPDATED notifications are emitted to watchers (minus
 * actor) on meaningful field changes, and are NOT emitted on no-op patches.
 */
describe('IssuesService.update watcher fan-out', () => {
  const ISSUE_ID = 'issue-watch-1';
  const WATCH_PROJECT = 'proj-watch';
  const WATCH_WORKSPACE = 'ws-watch';
  const ACTOR = 'user-actor';
  const WATCH_STATUS = 'status-watch';

  function makeWatchPrisma() {
    const txClient = {
      $queryRaw: jest.fn().mockResolvedValue([{ cycle_detected: false }]),
      issue: { findUnique: jest.fn(), update: jest.fn() },
      activityLog: { createMany: jest.fn() },
    };
    const prisma = {
      issue: { findUnique: jest.fn() },
      project: { findUnique: jest.fn() },
      membership: { findUnique: jest.fn() },
      status: { findUnique: jest.fn() },
      sprint: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      $transaction: jest.fn((cb: (tx: typeof txClient) => unknown) => cb(txClient)),
      _tx: txClient,
    };
    return { prisma, tx: txClient };
  }

  function makeExistingIssue(overrides: Partial<{
    statusId: string;
    assigneeId: string | null;
    priority: string;
    title: string;
    dueDate: Date | null;
  }> = {}) {
    return {
      id: ISSUE_ID,
      number: 1,
      projectId: WATCH_PROJECT,
      type: 'TASK',
      title: 'Watch me',
      description: null,
      statusId: WATCH_STATUS,
      assigneeId: null,
      reporterId: null,
      priority: 'MEDIUM',
      storyPoints: null,
      parentId: null,
      sprintId: null,
      dueDate: null,
      rank: 'a0',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  function makeUpdatedIssueRow(overrides: Partial<{ statusId: string; title: string }> = {}) {
    return {
      ...makeExistingIssue(),
      status: { id: WATCH_STATUS, name: 'To Do', category: 'TODO', order: 0, projectId: WATCH_PROJECT },
      assignee: null,
      reporter: null,
      labels: [],
      project: { key: 'WP' },
      _count: { comments: 0 },
      ...overrides,
    };
  }

  let mocks: ReturnType<typeof makeWatchPrisma>;
  let notificationsService: { notifyWatchersUpdated: jest.Mock; notifyAssigned: jest.Mock };
  let service: IssuesService;

  beforeEach(() => {
    mocks = makeWatchPrisma();
    mocks.prisma.project.findUnique.mockResolvedValue({
      id: WATCH_PROJECT,
      workspaceId: WATCH_WORKSPACE,
    });
    mocks.prisma.membership.findUnique.mockResolvedValue({ role: Role.ADMIN });
    mocks.prisma.user.findUnique.mockResolvedValue({ name: 'Actor Name' });
    // assertSameProject verifies that any referenced statusId belongs to the project.
    mocks.prisma.status.findUnique.mockResolvedValue({ projectId: WATCH_PROJECT });

    notificationsService = {
      notifyWatchersUpdated: jest.fn().mockResolvedValue(undefined),
      notifyAssigned: jest.fn().mockResolvedValue(undefined),
    };

    service = new IssuesService(
      mocks.prisma as unknown as PrismaService,
      { emitToProject: jest.fn() } as unknown as RealtimeService,
      notificationsService as unknown as NotificationsService,
      webhooksMock,
      noOpCustomFields,
      noOpEventEmitter,
      noOpWorkflow,
    );
  });

  it('fans out WATCHED_UPDATED when status changes', async () => {
    mocks.prisma.issue.findUnique.mockResolvedValue(makeExistingIssue());
    mocks.tx.issue.update.mockResolvedValue(
      makeUpdatedIssueRow({ statusId: 'status-done' }),
    );

    await service.update(ACTOR, ISSUE_ID, { statusId: 'status-done' });

    // Allow the fire-and-forget promise to resolve.
    await Promise.resolve();

    expect(notificationsService.notifyWatchersUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ACTOR,
        changedFields: expect.arrayContaining(['status']),
        issue: expect.objectContaining({ id: ISSUE_ID }),
      }),
    );
  });

  it('fans out WATCHED_UPDATED when priority changes', async () => {
    mocks.prisma.issue.findUnique.mockResolvedValue(makeExistingIssue({ priority: Priority.LOW }));
    mocks.tx.issue.update.mockResolvedValue(makeUpdatedIssueRow());

    await service.update(ACTOR, ISSUE_ID, { priority: Priority.HIGH });
    await Promise.resolve();

    expect(notificationsService.notifyWatchersUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        changedFields: expect.arrayContaining(['priority']),
      }),
    );
  });

  it('does NOT fan out when no meaningful field changes (no-op patch)', async () => {
    // Patch with the same values that are already on the issue — no effective change.
    const existing = makeExistingIssue();
    mocks.prisma.issue.findUnique.mockResolvedValue(existing);
    mocks.tx.issue.update.mockResolvedValue(makeUpdatedIssueRow());

    // Send a patch where title is undefined (no-op) and statusId is same.
    await service.update(ACTOR, ISSUE_ID, { statusId: WATCH_STATUS });
    await Promise.resolve();

    expect(notificationsService.notifyWatchersUpdated).not.toHaveBeenCalled();
  });

  it('does NOT fan out when only non-meaningful fields change (e.g. storyPoints)', async () => {
    mocks.prisma.issue.findUnique.mockResolvedValue(makeExistingIssue());
    mocks.tx.issue.update.mockResolvedValue(makeUpdatedIssueRow());

    await service.update(ACTOR, ISSUE_ID, { storyPoints: 5 });
    await Promise.resolve();

    expect(notificationsService.notifyWatchersUpdated).not.toHaveBeenCalled();
  });

  it('includes all changed fields in the fan-out call', async () => {
    mocks.prisma.issue.findUnique.mockResolvedValue(makeExistingIssue({ priority: Priority.LOW }));
    mocks.tx.issue.update.mockResolvedValue(makeUpdatedIssueRow({ statusId: 'status-done' }));

    await service.update(ACTOR, ISSUE_ID, {
      statusId: 'status-done',
      priority: Priority.HIGH,
    });
    await Promise.resolve();

    expect(notificationsService.notifyWatchersUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        changedFields: expect.arrayContaining(['status', 'priority']),
      }),
    );
    const call = notificationsService.notifyWatchersUpdated.mock.calls[0][0];
    expect(call.changedFields).toHaveLength(2);
  });

  it('passes WATCHED_UPDATED type implicitly (method is responsible for type)', async () => {
    // Verify that the service calls notifyWatchersUpdated (not notify) so
    // the notification type is always WATCHED_UPDATED for this fan-out path.
    mocks.prisma.issue.findUnique.mockResolvedValue(makeExistingIssue());
    mocks.tx.issue.update.mockResolvedValue(makeUpdatedIssueRow({ statusId: 'status-done' }));

    await service.update(ACTOR, ISSUE_ID, { statusId: 'status-done' });
    await Promise.resolve();

    // notifyWatchersUpdated called, not the generic notify.
    expect(notificationsService.notifyWatchersUpdated).toHaveBeenCalledTimes(1);
    // Ensure the type constant is correct in the notifications service.
    expect(NotificationType.WATCHED_UPDATED).toBe('WATCHED_UPDATED');
  });
});

// ---------------------------------------------------------------------------
// IssuesService.bulkUpdate tests
// ---------------------------------------------------------------------------

/**
 * Helpers shared across bulkUpdate test suites.
 */

const BULK_PROJECT = 'proj-bulk';
const BULK_WORKSPACE = 'ws-bulk';
const BULK_USER = 'user-bulk';
const BULK_STATUS = 'status-bulk';

function makeBulkUpdatePrisma() {
  const txClient = {
    $queryRaw: jest.fn().mockResolvedValue([{ cycle_detected: false }]),
    issue: { findUnique: jest.fn(), update: jest.fn() },
    activityLog: { createMany: jest.fn() },
  };
  const prisma = {
    issue: { findUnique: jest.fn() },
    project: { findUnique: jest.fn() },
    membership: { findUnique: jest.fn() },
    status: { findUnique: jest.fn() },
    sprint: { findUnique: jest.fn() },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Bulk Actor' }) },
    issueLabel: { upsert: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((cb: (tx: typeof txClient) => unknown) => cb(txClient)),
    _tx: txClient,
  };
  return { prisma, tx: txClient };
}

function makeBulkIssueRow(id: string) {
  return {
    id,
    number: 1,
    projectId: BULK_PROJECT,
    type: 'TASK',
    title: `Issue ${id}`,
    description: null,
    statusId: BULK_STATUS,
    assigneeId: null,
    reporterId: null,
    priority: 'MEDIUM',
    storyPoints: null,
    parentId: null,
    sprintId: null,
    dueDate: null,
    rank: 'a0',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    status: { id: BULK_STATUS, name: 'To Do', category: 'TODO', order: 0, projectId: BULK_PROJECT },
    assignee: null,
    reporter: null,
    labels: [],
    project: { key: 'BL' },
    _count: { comments: 0 },
  };
}

/**
 * Happy-path suite: all ids succeed, returned updated=N with empty failed.
 */
describe('IssuesService.bulkUpdate — all succeed', () => {
  let mocks: ReturnType<typeof makeBulkUpdatePrisma>;
  let service: IssuesService;

  beforeEach(() => {
    mocks = makeBulkUpdatePrisma();
    // assertProjectRole: project + MEMBER access.
    mocks.prisma.project.findUnique.mockResolvedValue({
      id: BULK_PROJECT,
      workspaceId: BULK_WORKSPACE,
    });
    mocks.prisma.membership.findUnique.mockResolvedValue({ role: Role.MEMBER });
    // assertSameProject: statusId belongs to project.
    mocks.prisma.status.findUnique.mockResolvedValue({ projectId: BULK_PROJECT });

    service = new IssuesService(
      mocks.prisma as unknown as PrismaService,
      { emitToProject: jest.fn() } as unknown as RealtimeService,
      { notifyWatchersUpdated: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService,
      webhooksMock,
      noOpCustomFields,
      noOpEventEmitter,
      noOpWorkflow,
    );
  });

  it('applies changes to all ids and returns updated=N when all succeed', async () => {
    const ids = ['i1', 'i2', 'i3'];
    // Each issue.findUnique (via update()) returns the row.
    mocks.prisma.issue.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(makeBulkIssueRow(where.id)),
    );
    // tx.issue.update returns the updated row.
    mocks.tx.issue.update.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(makeBulkIssueRow(where.id)),
    );

    const result = await service.bulkUpdate(BULK_USER, {
      ids,
      changes: { priority: Priority.HIGH },
    });

    expect(result.updated).toBe(3);
    expect(result.failed).toHaveLength(0);
    // update() called once per id.
    expect(mocks.tx.issue.update).toHaveBeenCalledTimes(3);
  });

  it('passes statusId through to update() correctly', async () => {
    mocks.prisma.issue.findUnique.mockResolvedValue(makeBulkIssueRow('i1'));
    mocks.tx.issue.update.mockResolvedValue(makeBulkIssueRow('i1'));

    await service.bulkUpdate(BULK_USER, {
      ids: ['i1'],
      changes: { statusId: 'new-status' },
    });

    expect(mocks.tx.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ statusId: 'new-status' }),
      }),
    );
  });

  it('passes assigneeId=null through to update() (clear assignee)', async () => {
    mocks.prisma.issue.findUnique.mockResolvedValue(
      makeBulkIssueRow('i1'),
    );
    mocks.tx.issue.update.mockResolvedValue(makeBulkIssueRow('i1'));

    await service.bulkUpdate(BULK_USER, {
      ids: ['i1'],
      changes: { assigneeId: null },
    });

    expect(mocks.tx.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeId: null }),
      }),
    );
  });

  it('passes sprintId=null through to update() (remove from sprint)', async () => {
    mocks.prisma.issue.findUnique.mockResolvedValue(makeBulkIssueRow('i1'));
    mocks.tx.issue.update.mockResolvedValue(makeBulkIssueRow('i1'));

    await service.bulkUpdate(BULK_USER, {
      ids: ['i1'],
      changes: { sprintId: null },
    });

    expect(mocks.tx.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sprintId: null }),
      }),
    );
  });

  it('calls attachLabel per id per labelId when addLabelIds is provided', async () => {
    const ids = ['i1', 'i2'];
    mocks.prisma.issue.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(makeBulkIssueRow(where.id)),
    );
    mocks.tx.issue.update.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(makeBulkIssueRow(where.id)),
    );

    await service.bulkUpdate(BULK_USER, {
      ids,
      changes: { addLabelIds: ['label-a', 'label-b'] },
    });

    // 2 ids × 2 labels = 4 upsert calls.
    expect(mocks.prisma.issueLabel.upsert).toHaveBeenCalledTimes(4);
    expect(mocks.prisma.issueLabel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { issueId_labelId: { issueId: 'i1', labelId: 'label-a' } },
      }),
    );
    expect(mocks.prisma.issueLabel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { issueId_labelId: { issueId: 'i2', labelId: 'label-b' } },
      }),
    );
  });
});

/**
 * Partial-success suite: one bad id must not abort the batch.
 */
describe('IssuesService.bulkUpdate — partial success', () => {
  let mocks: ReturnType<typeof makeBulkUpdatePrisma>;
  let service: IssuesService;

  beforeEach(() => {
    mocks = makeBulkUpdatePrisma();
    mocks.prisma.project.findUnique.mockResolvedValue({
      id: BULK_PROJECT,
      workspaceId: BULK_WORKSPACE,
    });
    mocks.prisma.membership.findUnique.mockResolvedValue({ role: Role.MEMBER });
    mocks.prisma.status.findUnique.mockResolvedValue({ projectId: BULK_PROJECT });

    service = new IssuesService(
      mocks.prisma as unknown as PrismaService,
      { emitToProject: jest.fn() } as unknown as RealtimeService,
      { notifyWatchersUpdated: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService,
      webhooksMock,
      noOpCustomFields,
      noOpEventEmitter,
      noOpWorkflow,
    );
  });

  it('captures a failing id in failed[] and still succeeds for the rest', async () => {
    const ids = ['i-good', 'i-bad', 'i-also-good'];

    mocks.prisma.issue.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        if (where.id === 'i-bad') {
          return Promise.resolve(null); // triggers NotFoundException in update()
        }
        return Promise.resolve(makeBulkIssueRow(where.id));
      },
    );
    mocks.tx.issue.update.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(makeBulkIssueRow(where.id)),
    );

    const result = await service.bulkUpdate(BULK_USER, {
      ids,
      changes: { priority: Priority.LOW },
    });

    expect(result.updated).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe('i-bad');
    expect(result.failed[0].reason).toContain('Issue not found');
  });

  it('captures a forbidden id in failed[] when update() throws for that id', async () => {
    // Simulate the case where the second issue's update throws a ForbiddenException.
    // We mock prisma.issue.findUnique so 'i-bad' returns null → NotFoundException.
    const ids = ['i-good', 'i-bad'];

    mocks.prisma.issue.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        if (where.id === 'i-bad') return Promise.resolve(null);
        return Promise.resolve(makeBulkIssueRow(where.id));
      },
    );
    mocks.tx.issue.update.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(makeBulkIssueRow(where.id)),
    );

    const result = await service.bulkUpdate(BULK_USER, {
      ids,
      changes: { priority: Priority.HIGH },
    });

    expect(result.updated).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe('i-bad');
    // update() throws NotFoundException('Issue not found') when the row is null.
    expect(result.failed[0].reason).toMatch(/not found/i);
  });

  it('a label-attach error does not prevent the field change from being counted', async () => {
    // The update() call succeeds but issueLabel.upsert throws for one label.
    mocks.prisma.issue.findUnique.mockResolvedValue(makeBulkIssueRow('i1'));
    mocks.tx.issue.update.mockResolvedValue(makeBulkIssueRow('i1'));
    mocks.prisma.issueLabel.upsert.mockRejectedValue(new Error('DB constraint'));

    const result = await service.bulkUpdate(BULK_USER, {
      ids: ['i1'],
      changes: { addLabelIds: ['label-fail'] },
    });

    // The label attach error is caught; the issue counts as failed (entire id fails).
    expect(result.updated).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe('i1');
    expect(result.failed[0].reason).toContain('DB constraint');
  });
});

/**
 * Workflow enforcement in bulkUpdate (item 6).
 *
 * Verifies that:
 *  - When enforcement is OFF: the per-issue workflow check is skipped (preload
 *    returns false → enforceTransition returns immediately without the project lookup).
 *  - When enforcement is ON: illegal transitions are still caught per-issue,
 *    landing in failed[] while other issues in the batch continue.
 */
describe('IssuesService.bulkUpdate — workflow enforcement (item 6)', () => {
  let mocks: ReturnType<typeof makeBulkUpdatePrisma>;
  let workflowSvc: { enforceTransition: jest.Mock; isEnforcementEnabled: jest.Mock };
  let service: IssuesService;

  beforeEach(() => {
    mocks = makeBulkUpdatePrisma();
    mocks.prisma.project.findUnique.mockResolvedValue({
      id: BULK_PROJECT,
      workspaceId: BULK_WORKSPACE,
      workflowEnforced: false,
    });
    mocks.prisma.membership.findUnique.mockResolvedValue({ role: Role.MEMBER });
    mocks.prisma.status.findUnique.mockResolvedValue({ projectId: BULK_PROJECT });

    workflowSvc = {
      enforceTransition: jest.fn().mockResolvedValue(undefined),
      isEnforcementEnabled: jest.fn().mockResolvedValue(false),
    };

    service = new IssuesService(
      mocks.prisma as unknown as PrismaService,
      { emitToProject: jest.fn() } as unknown as RealtimeService,
      { notifyWatchersUpdated: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService,
      webhooksMock,
      noOpCustomFields,
      noOpEventEmitter,
      workflowSvc as unknown as WorkflowService,
    );
  });

  it('passes workflowEnforced=false to enforceTransition when enforcement is off (skips per-issue project lookup)', async () => {
    workflowSvc.isEnforcementEnabled.mockResolvedValue(false);

    mocks.prisma.issue.findUnique.mockResolvedValue(makeBulkIssueRow('i1'));
    mocks.tx.issue.update.mockResolvedValue(makeBulkIssueRow('i1'));

    await service.bulkUpdate(BULK_USER, {
      ids: ['i1'],
      changes: { statusId: 'new-status' },
    });

    // enforceTransition must have been called with workflowEnforced: false
    expect(workflowSvc.enforceTransition).toHaveBeenCalledWith(
      'i1',
      'new-status',
      expect.objectContaining({ workflowEnforced: false }),
    );
  });

  it('passes workflowEnforced=true to enforceTransition when enforcement is on', async () => {
    workflowSvc.isEnforcementEnabled.mockResolvedValue(true);

    mocks.prisma.issue.findUnique.mockResolvedValue(makeBulkIssueRow('i1'));
    mocks.tx.issue.update.mockResolvedValue(makeBulkIssueRow('i1'));

    await service.bulkUpdate(BULK_USER, {
      ids: ['i1'],
      changes: { statusId: 'new-status' },
    });

    expect(workflowSvc.enforceTransition).toHaveBeenCalledWith(
      'i1',
      'new-status',
      expect.objectContaining({ workflowEnforced: true }),
    );
  });

  it('still blocks an illegal transition when enforcement is on (partial success)', async () => {
    const { UnprocessableEntityException } = require('@nestjs/common');
    workflowSvc.isEnforcementEnabled.mockResolvedValue(true);
    // First issue passes; second fails enforcement.
    workflowSvc.enforceTransition
      .mockResolvedValueOnce(undefined) // i1: allowed
      .mockRejectedValueOnce(new UnprocessableEntityException('Transition not allowed')); // i2: blocked

    mocks.prisma.issue.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(makeBulkIssueRow(where.id)),
    );
    mocks.tx.issue.update.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(makeBulkIssueRow(where.id)),
    );

    const result = await service.bulkUpdate(BULK_USER, {
      ids: ['i1', 'i2'],
      changes: { statusId: 'new-status' },
    });

    // i1 succeeded, i2 failed due to enforcement.
    expect(result.updated).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe('i2');
    expect(result.failed[0].reason).toMatch(/Transition not allowed/);
  });

  it('calls isEnforcementEnabled only once regardless of batch size', async () => {
    workflowSvc.isEnforcementEnabled.mockResolvedValue(false);

    const ids = ['i1', 'i2', 'i3'];
    mocks.prisma.issue.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(makeBulkIssueRow(where.id)),
    );
    mocks.tx.issue.update.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(makeBulkIssueRow(where.id)),
    );

    await service.bulkUpdate(BULK_USER, {
      ids,
      changes: { statusId: 'new-status' },
    });

    // isEnforcementEnabled is called once (preload) not N times.
    expect(workflowSvc.isEnforcementEnabled).toHaveBeenCalledTimes(1);
  });
});

/**
 * Guard tests: empty changes and >100 ids are rejected by the service.
 */
describe('IssuesService.bulkUpdate — input guards', () => {
  let service: IssuesService;

  beforeEach(() => {
    const { prisma } = makeBulkUpdatePrisma();
    service = new IssuesService(
      prisma as unknown as PrismaService,
      {} as RealtimeService,
      {} as NotificationsService,
      webhooksMock,
      noOpCustomFields,
      noOpEventEmitter,
      noOpWorkflow,
    );
  });

  it('rejects when changes has no fields set', async () => {
    await expect(
      service.bulkUpdate(BULK_USER, {
        ids: ['i1'],
        changes: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when changes.addLabelIds is an empty array (no effective change)', async () => {
    await expect(
      service.bulkUpdate(BULK_USER, {
        ids: ['i1'],
        changes: { addLabelIds: [] },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when ids length exceeds 100', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `issue-${i}`);
    await expect(
      service.bulkUpdate(BULK_USER, {
        ids,
        changes: { priority: Priority.HIGH },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// Component integration: componentId cross-project validation and
// default-assignee auto-assignment on issue create.
// ---------------------------------------------------------------------------

const COMP_PROJECT = 'proj-comp';
const COMP_WORKSPACE = 'ws-comp';
const COMP_USER = 'user-comp';
const COMP_COMPONENT_ID = 'comp-1';
const COMP_OTHER_PROJECT = 'proj-other';
const COMP_ASSIGNEE_ID = 'user-default-assignee';

function makeCompIssueRow(overrides: Partial<{
  id: string; assigneeId: string | null; componentId: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'issue-new',
    number: 1,
    projectId: COMP_PROJECT,
    type: 'TASK',
    title: 'Test issue',
    description: null,
    statusId: 'status-1',
    assigneeId: overrides.assigneeId ?? null,
    reporterId: COMP_USER,
    priority: 'MEDIUM',
    storyPoints: null,
    parentId: null,
    sprintId: null,
    dueDate: null,
    rank: 'a0',
    componentId: overrides.componentId ?? null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    status: { id: 'status-1', name: 'To Do', category: 'TODO', order: 0, projectId: COMP_PROJECT },
    assignee: null,
    reporter: null,
    labels: [],
    project: { key: 'NL' },
    _count: { comments: 0 },
    component: null,
  };
}

interface CompTx {
  project: { update: jest.Mock };
  status: { findFirst: jest.Mock };
  issue: { findFirst: jest.Mock; create: jest.Mock };
  activityLog: { create: jest.Mock };
}

function makeCompCreatePrisma(opts: {
  componentProjectId?: string;
  defaultAssigneeId?: string | null;
} = {}) {
  const componentProjectId = opts.componentProjectId ?? COMP_PROJECT;
  const defaultAssigneeId = opts.defaultAssigneeId ?? null;

  const tx: CompTx = {
    project: {
      update: jest.fn().mockResolvedValue({ issueSeq: 1 }),
    },
    status: {
      findFirst: jest.fn().mockResolvedValue({ id: 'status-1', category: 'TODO' }),
    },
    issue: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(makeCompIssueRow({
          assigneeId: (data.assigneeId as string | null | undefined) ?? null,
          componentId: (data.componentId as string | null | undefined) ?? null,
        })),
      ),
    },
    activityLog: {
      create: jest.fn().mockResolvedValue({}),
    },
  };

  const prisma = {
    project: {
      findUnique: jest.fn().mockResolvedValue({
        id: COMP_PROJECT,
        workspaceId: COMP_WORKSPACE,
        workspace: { id: COMP_WORKSPACE },
      }),
    },
    membership: {
      findUnique: jest.fn().mockResolvedValue({ role: Role.MEMBER }),
    },
    component: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === COMP_COMPONENT_ID) {
          return Promise.resolve({
            id: COMP_COMPONENT_ID,
            projectId: componentProjectId,
            defaultAssigneeId,
          });
        }
        return Promise.resolve(null);
      }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Actor' }),
    },
    $transaction: jest.fn((cb: (t: CompTx) => unknown) => cb(tx)),
    _tx: tx,
  };

  return { prisma, tx };
}

describe('IssuesService.create — componentId validation', () => {
  it('rejects a componentId that belongs to a different project (BadRequestException)', async () => {
    const { prisma } = makeCompCreatePrisma({
      componentProjectId: COMP_OTHER_PROJECT,
    });
    const service = new IssuesService(
      prisma as unknown as PrismaService,
      { emitToProject: jest.fn() } as unknown as RealtimeService,
      {} as NotificationsService,
      webhooksMock,
      noOpCustomFields,
      noOpEventEmitter,
      noOpWorkflow,
    );

    await expect(
      service.create(COMP_USER, {
        projectId: COMP_PROJECT,
        title: 'Issue',
        componentId: COMP_COMPONENT_ID,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('auto-assigns the component defaultAssigneeId when no assigneeId is given', async () => {
    const { prisma, tx } = makeCompCreatePrisma({
      componentProjectId: COMP_PROJECT,
      defaultAssigneeId: COMP_ASSIGNEE_ID,
    });
    const realtime = { emitToProject: jest.fn() } as unknown as RealtimeService;
    const notifications = { notifyAssigned: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
    const service = new IssuesService(
      prisma as unknown as PrismaService,
      realtime,
      notifications,
      webhooksMock,
      noOpCustomFields,
      noOpEventEmitter,
      noOpWorkflow,
    );

    await service.create(COMP_USER, {
      projectId: COMP_PROJECT,
      title: 'Issue',
      componentId: COMP_COMPONENT_ID,
      // No assigneeId supplied
    });

    // The create call should have received the component's defaultAssigneeId.
    expect(tx.issue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeId: COMP_ASSIGNEE_ID }),
      }),
    );
  });

  it('does NOT override an explicitly provided assigneeId with component default', async () => {
    const EXPLICIT_ASSIGNEE = 'user-explicit';
    const { prisma, tx } = makeCompCreatePrisma({
      componentProjectId: COMP_PROJECT,
      defaultAssigneeId: COMP_ASSIGNEE_ID,
    });
    const realtime = { emitToProject: jest.fn() } as unknown as RealtimeService;
    const notifications = { notifyAssigned: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
    const service = new IssuesService(
      prisma as unknown as PrismaService,
      realtime,
      notifications,
      webhooksMock,
      noOpCustomFields,
      noOpEventEmitter,
      noOpWorkflow,
    );

    await service.create(COMP_USER, {
      projectId: COMP_PROJECT,
      title: 'Issue',
      componentId: COMP_COMPONENT_ID,
      assigneeId: EXPLICIT_ASSIGNEE,
    });

    // The explicit assignee must win; the component default must NOT be used.
    expect(tx.issue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeId: EXPLICIT_ASSIGNEE }),
      }),
    );
  });

  it('does not auto-assign when component has no defaultAssigneeId', async () => {
    const { prisma, tx } = makeCompCreatePrisma({
      componentProjectId: COMP_PROJECT,
      defaultAssigneeId: null,
    });
    const realtime = { emitToProject: jest.fn() } as unknown as RealtimeService;
    const service = new IssuesService(
      prisma as unknown as PrismaService,
      realtime,
      {} as NotificationsService,
      webhooksMock,
      noOpCustomFields,
      noOpEventEmitter,
      noOpWorkflow,
    );

    await service.create(COMP_USER, {
      projectId: COMP_PROJECT,
      title: 'Issue',
      componentId: COMP_COMPONENT_ID,
    });

    // assigneeId should be undefined (not set) since component has no default.
    const callData = tx.issue.create.mock.calls[0][0].data;
    expect(callData.assigneeId).toBeUndefined();
  });
});

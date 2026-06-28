import { BadRequestException } from '@nestjs/common';
import { StatusCategory } from '@next-lane/shared';
import * as membership from '../common/membership.util';
import { StandupsService, toStandupEntryDto } from './standups.service';
import type { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const USER_A = 'user-a';
const USER_B = 'user-b';
const ENTRY_ID = 'entry-1';
const ISSUE_ID = 'issue-1';
const ISSUE2_ID = 'issue-2';
const LINK_ID = 'link-1';

const NOW = new Date('2026-06-28T10:00:00.000Z');
const TODAY_DATE = new Date('2026-06-28T00:00:00.000Z'); // midnight UTC for date "2026-06-28"

function makeUser(id = USER_A) {
  return {
    id,
    email: `${id}@example.com`,
    name: `User ${id}`,
    avatarColor: '#aabbcc',
    createdAt: NOW,
  };
}

function makeIssueRow(id = ISSUE_ID) {
  return {
    id,
    key: `NL-${id}`,
    type: 'TASK',
    title: `Issue ${id}`,
    statusId: 'status-1',
  };
}

function makeBlockerLink(issueId = ISSUE_ID) {
  return {
    id: LINK_ID,
    standupEntryId: ENTRY_ID,
    issueId,
    createdAt: NOW,
    issue: makeIssueRow(issueId),
  };
}

function makeEntryRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ENTRY_ID,
    userId: USER_A,
    teamId: null,
    projectId: PROJECT_ID,
    date: TODAY_DATE,
    yesterday: 'Worked on NL-1',
    today: 'Continue NL-1',
    blockers: null,
    createdAt: NOW,
    updatedAt: NOW,
    user: makeUser(USER_A),
    blockerLinks: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock Prisma builder
// ---------------------------------------------------------------------------

/**
 * Builds a minimal mock PrismaService that covers the operations
 * StandupsService calls. The $transaction mock runs interactive callbacks.
 */
function makeTx() {
  return {
    standupEntry: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    standupBlockerLink: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  };
}
type Tx = ReturnType<typeof makeTx>;

function makePrisma(): PrismaService & {
  standupEntry: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    upsert: jest.Mock;
  };
  standupBlockerLink: {
    deleteMany: jest.Mock;
    createMany: jest.Mock;
  };
  issue: { findMany: jest.Mock };
  activityLog: { findMany: jest.Mock };
  status: { findMany: jest.Mock };
  project: { findUnique: jest.Mock };
  membership: { findUnique: jest.Mock };
  $transaction: jest.Mock;
  __tx: Tx;
} {
  const tx = makeTx();

  const prisma = {
    standupEntry: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    standupBlockerLink: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    issue: { findMany: jest.fn() },
    activityLog: { findMany: jest.fn() },
    status: { findMany: jest.fn() },
    project: {
      findUnique: jest.fn().mockResolvedValue({
        id: PROJECT_ID,
        workspaceId: 'ws-1',
        workspace: { id: 'ws-1' },
      }),
    },
    membership: {
      findUnique: jest.fn().mockResolvedValue({ role: 'MEMBER' }),
    },
    $transaction: jest.fn((cb: (t: Tx) => unknown) => cb(tx)),
    __tx: tx,
  };

  return prisma as unknown as ReturnType<typeof makePrisma>;
}

type MockPrisma = ReturnType<typeof makePrisma>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StandupsService', () => {
  let prisma: MockPrisma;
  let service: StandupsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new StandupsService(prisma);

    // Allow membership checks to pass by default.
    jest
      .spyOn(membership, 'assertProjectMember')
      .mockResolvedValue({ id: PROJECT_ID, workspaceId: 'ws-1' } as never);
    jest
      .spyOn(membership, 'assertProjectRole')
      .mockResolvedValue({ id: PROJECT_ID, workspaceId: 'ws-1' } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  // ── toStandupEntryDto mapper ───────────────────────────────────────────────

  describe('toStandupEntryDto', () => {
    it('maps date (UTC midnight) to YYYY-MM-DD string', () => {
      const row = makeEntryRow();
      const dto = toStandupEntryDto(row as never);
      // TODAY_DATE is 2026-06-28T00:00:00.000Z → local date depends on TZ,
      // but the year-month-day is stable when the server is UTC (CI default).
      expect(dto.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(dto.id).toBe(ENTRY_ID);
      expect(dto.userId).toBe(USER_A);
      expect(dto.projectId).toBe(PROJECT_ID);
      expect(dto.teamId).toBeNull();
    });

    it('projects blockerIssueIds from blockerLinks', () => {
      const row = makeEntryRow({
        blockerLinks: [makeBlockerLink(ISSUE_ID), makeBlockerLink(ISSUE2_ID)],
      });
      const dto = toStandupEntryDto(row as never);
      expect(dto.blockerIssueIds).toEqual([ISSUE_ID, ISSUE2_ID]);
    });

    it('includes user DTO when user relation is present', () => {
      const row = makeEntryRow({ user: makeUser(USER_A) });
      const dto = toStandupEntryDto(row as never);
      expect(dto.user).toBeDefined();
      expect(dto.user?.id).toBe(USER_A);
    });

    it('omits user field when user relation is absent', () => {
      const row = makeEntryRow({ user: null });
      const dto = toStandupEntryDto(row as never);
      expect(dto.user).toBeUndefined();
    });
  });

  // ── findDigest ─────────────────────────────────────────────────────────────

  describe('findDigest', () => {
    it('returns all members entries for the date ordered by user name', async () => {
      const entryA = makeEntryRow({ id: 'e-a', userId: USER_A, user: makeUser(USER_A) });
      const entryB = makeEntryRow({ id: 'e-b', userId: USER_B, user: makeUser(USER_B) });
      prisma.standupEntry.findMany.mockResolvedValue([entryA, entryB]);

      const result = await service.findDigest(USER_A, PROJECT_ID, '2026-06-28');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('e-a');
      expect(result[1].id).toBe('e-b');

      expect(prisma.standupEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            projectId: PROJECT_ID,
            date: new Date('2026-06-28T00:00:00.000Z'),
          },
          orderBy: { user: { name: 'asc' } },
        }),
      );
    });

    it('defaults to today when date is omitted', async () => {
      prisma.standupEntry.findMany.mockResolvedValue([]);
      await service.findDigest(USER_A, PROJECT_ID);
      expect(prisma.standupEntry.findMany).toHaveBeenCalled();
    });

    it('returns empty array when no entries exist', async () => {
      prisma.standupEntry.findMany.mockResolvedValue([]);
      const result = await service.findDigest(USER_A, PROJECT_ID, '2026-06-28');
      expect(result).toEqual([]);
    });
  });

  // ── findMyEntry ────────────────────────────────────────────────────────────

  describe('findMyEntry', () => {
    it('returns the caller entry when it exists', async () => {
      prisma.standupEntry.findFirst.mockResolvedValue(makeEntryRow());

      const result = await service.findMyEntry(USER_A, PROJECT_ID, '2026-06-28');

      expect(result).not.toBeNull();
      expect(result?.userId).toBe(USER_A);
      // Service uses findFirst with explicit null filter (Prisma compound-unique
      // limitation with nullable fields).
      expect(prisma.standupEntry.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: USER_A,
            teamId: null,
            projectId: PROJECT_ID,
            date: new Date('2026-06-28T00:00:00.000Z'),
          },
        }),
      );
    });

    it('returns null when no entry exists for the caller on that day', async () => {
      prisma.standupEntry.findFirst.mockResolvedValue(null);
      const result = await service.findMyEntry(USER_A, PROJECT_ID, '2026-06-28');
      expect(result).toBeNull();
    });

    it('defaults to today when date is omitted', async () => {
      prisma.standupEntry.findFirst.mockResolvedValue(null);
      await service.findMyEntry(USER_A, PROJECT_ID);
      expect(prisma.standupEntry.findFirst).toHaveBeenCalled();
    });
  });

  // ── upsert ─────────────────────────────────────────────────────────────────

  describe('upsert', () => {
    // existingRow: the row findFirst returns (null → create path; {id,...} → update path).
    function setupUpsertTx(resultEntry = makeEntryRow(), existingRow: unknown = null) {
      prisma.__tx.standupEntry.findFirst.mockResolvedValue(existingRow);
      prisma.__tx.standupEntry.create.mockResolvedValue(resultEntry);
      prisma.__tx.standupEntry.update.mockResolvedValue(resultEntry);
      prisma.__tx.standupBlockerLink.deleteMany.mockResolvedValue({ count: 0 });
      prisma.__tx.standupBlockerLink.createMany.mockResolvedValue({ count: 0 });
      prisma.__tx.standupEntry.findUniqueOrThrow.mockResolvedValue(resultEntry);
    }

    it('creates a new entry when none exists for that day', async () => {
      setupUpsertTx(); // findFirst → null → create path

      const result = await service.upsert(USER_A, PROJECT_ID, {
        date: '2026-06-28',
        yesterday: 'Did stuff',
        today: 'Do more stuff',
      });

      expect(result.userId).toBe(USER_A);
      // Looks up the existing (user, null team, project, day) row first…
      expect(prisma.__tx.standupEntry.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: USER_A,
            teamId: null,
            projectId: PROJECT_ID,
            date: new Date('2026-06-28T00:00:00.000Z'),
          },
        }),
      );
      // …and creates since none exists.
      expect(prisma.__tx.standupEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: USER_A,
            projectId: PROJECT_ID,
            yesterday: 'Did stuff',
            today: 'Do more stuff',
          }),
        }),
      );
      expect(prisma.__tx.standupEntry.update).not.toHaveBeenCalled();
    });

    it('updates the same-day entry without creating a duplicate', async () => {
      // findFirst returns an existing row → update path, never create.
      setupUpsertTx(makeEntryRow({ yesterday: 'v2' }), { id: ENTRY_ID });

      const result = await service.upsert(USER_A, PROJECT_ID, {
        date: '2026-06-28',
        yesterday: 'v2',
      });

      expect(result.yesterday).toBe('v2');
      expect(prisma.__tx.standupEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ENTRY_ID },
          data: expect.objectContaining({ yesterday: 'v2' }),
        }),
      );
      expect(prisma.__tx.standupEntry.create).not.toHaveBeenCalled();
    });

    it('replaces blocker links on each upsert', async () => {
      const entryWithLink = makeEntryRow({
        blockerLinks: [makeBlockerLink(ISSUE_ID)],
      });
      setupUpsertTx(entryWithLink);
      prisma.issue.findMany.mockResolvedValue([{ id: ISSUE_ID }]);

      await service.upsert(USER_A, PROJECT_ID, {
        date: '2026-06-28',
        blockerIssueIds: [ISSUE_ID],
      });

      // Old links deleted first, new ones created.
      expect(prisma.__tx.standupBlockerLink.deleteMany).toHaveBeenCalledWith({
        where: { standupEntryId: ENTRY_ID },
      });
      expect(prisma.__tx.standupBlockerLink.createMany).toHaveBeenCalledWith({
        data: [{ standupEntryId: ENTRY_ID, issueId: ISSUE_ID }],
      });
    });

    it('validates that blocker issue IDs belong to the project', async () => {
      // Only ISSUE_ID exists in the project; ISSUE2_ID is foreign.
      prisma.issue.findMany.mockResolvedValue([{ id: ISSUE_ID }]);

      await expect(
        service.upsert(USER_A, PROJECT_ID, {
          date: '2026-06-28',
          blockerIssueIds: [ISSUE_ID, ISSUE2_ID],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      // Transaction must not have been entered.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not call issue.findMany when blockerIssueIds is empty', async () => {
      setupUpsertTx();

      await service.upsert(USER_A, PROJECT_ID, {
        date: '2026-06-28',
        blockerIssueIds: [],
      });

      expect(prisma.issue.findMany).not.toHaveBeenCalled();
    });

    it('clears all blocker links when blockerIssueIds is empty', async () => {
      setupUpsertTx();

      await service.upsert(USER_A, PROJECT_ID, {
        date: '2026-06-28',
        blockerIssueIds: [],
      });

      expect(prisma.__tx.standupBlockerLink.deleteMany).toHaveBeenCalled();
      expect(prisma.__tx.standupBlockerLink.createMany).not.toHaveBeenCalled();
    });

    it('defaults date to today when not provided', async () => {
      setupUpsertTx();

      await service.upsert(USER_A, PROJECT_ID, { yesterday: 'stuff' });

      // The create data date should be midnight UTC of today (create path,
      // since findFirst returns null).
      const callArg = prisma.__tx.standupEntry.create.mock.calls[0][0] as {
        data: { date: Date };
      };
      const dateUsed = callArg.data.date;
      expect(dateUsed).toBeInstanceOf(Date);
      // Must be midnight UTC (seconds + ms = 0).
      expect(dateUsed.getUTCHours()).toBe(0);
      expect(dateUsed.getUTCMinutes()).toBe(0);
      expect(dateUsed.getUTCSeconds()).toBe(0);
    });
  });

  // ── prefill ────────────────────────────────────────────────────────────────

  describe('prefill', () => {
    /**
     * Build a mock ActivityLog row.
     * The service accesses act.issueId (string) and act.issue.number +
     * act.issue.project.key for the display key (e.g. "NL-1").
     */
    function makeActivityRow(opts: {
      id: string;
      issueId: string;
      field: string;
      to?: string | null;
      issueNumber: number;
      projectKey: string;
      issueTitle: string;
    }) {
      return {
        id: opts.id,
        actorId: USER_A,
        issueId: opts.issueId,
        field: opts.field,
        from: null,
        to: opts.to ?? null,
        createdAt: NOW,
        issue: {
          id: opts.issueId,
          number: opts.issueNumber,
          title: opts.issueTitle,
          project: { key: opts.projectKey },
        },
      };
    }

    it('summarizes recent activity as yesterday text', async () => {
      prisma.activityLog.findMany.mockResolvedValue([
        makeActivityRow({
          id: 'act-1',
          issueId: ISSUE_ID,
          field: 'status',
          to: 'done-id',
          issueNumber: 1,
          projectKey: 'NL',
          issueTitle: 'Fix the bug',
        }),
      ]);
      prisma.status.findMany.mockResolvedValue([]);

      const result = await service.prefill(USER_A, PROJECT_ID);

      expect(result.yesterday).toContain('NL-1');
      expect(result.yesterday).toContain('Fix the bug');
    });

    it('returns fallback text when no recent activity', async () => {
      prisma.activityLog.findMany.mockResolvedValue([]);
      prisma.status.findMany.mockResolvedValue([]);

      const result = await service.prefill(USER_A, PROJECT_ID);

      expect(result.yesterday).toBe('No recent activity found.');
    });

    it('derives today text from assigned in-progress issues', async () => {
      prisma.activityLog.findMany.mockResolvedValue([]);
      prisma.status.findMany.mockResolvedValue([
        { id: 'st-inprogress' },
      ]);
      // The service selects { number, title, project: { key } } for issues.
      prisma.issue.findMany.mockResolvedValue([
        { number: 5, title: 'Ship the feature', project: { key: 'NL' } },
      ]);

      const result = await service.prefill(USER_A, PROJECT_ID);

      expect(result.today).toContain('NL-5');
      expect(result.today).toContain('Ship the feature');
    });

    it('returns fallback today text when no in-progress issues', async () => {
      prisma.activityLog.findMany.mockResolvedValue([]);
      prisma.status.findMany.mockResolvedValue([]); // No IN_PROGRESS statuses

      const result = await service.prefill(USER_A, PROJECT_ID);

      expect(result.today).toBe('No in-progress issues assigned.');
    });

    it('does not query issue.findMany when no in-progress statuses exist', async () => {
      prisma.activityLog.findMany.mockResolvedValue([]);
      prisma.status.findMany.mockResolvedValue([]);

      await service.prefill(USER_A, PROJECT_ID);

      expect(prisma.issue.findMany).not.toHaveBeenCalled();
    });

    it('groups multiple activity items for the same issue', async () => {
      prisma.activityLog.findMany.mockResolvedValue([
        makeActivityRow({
          id: 'act-1',
          issueId: ISSUE_ID,
          field: 'status',
          to: 'done-id',
          issueNumber: 1,
          projectKey: 'NL',
          issueTitle: 'Issue One',
        }),
        makeActivityRow({
          id: 'act-2',
          issueId: ISSUE_ID,
          field: 'assignee',
          to: USER_A,
          issueNumber: 1,
          projectKey: 'NL',
          issueTitle: 'Issue One',
        }),
      ]);
      prisma.status.findMany.mockResolvedValue([]);

      const result = await service.prefill(USER_A, PROJECT_ID);

      // Issue appears once in the summary (grouped by issueId).
      const lines = result.yesterday.split('\n');
      const issueLines = lines.filter((l) => l.includes('NL-1'));
      expect(issueLines).toHaveLength(1);
    });

    it('queries activityLog for the last 24 hours only', async () => {
      prisma.activityLog.findMany.mockResolvedValue([]);
      prisma.status.findMany.mockResolvedValue([]);

      await service.prefill(USER_A, PROJECT_ID);

      const [callArg] = (prisma.activityLog.findMany as jest.Mock).mock.calls as [
        [{ where: { actorId: string; createdAt: { gte: Date }; issue: { projectId: string } } }],
      ];
      expect(callArg[0].where.actorId).toBe(USER_A);
      expect(callArg[0].where.createdAt.gte).toBeInstanceOf(Date);
      // gte should be approximately 24 h ago.
      const diff = Date.now() - callArg[0].where.createdAt.gte.getTime();
      expect(diff).toBeGreaterThanOrEqual(23 * 60 * 60 * 1000);
      expect(diff).toBeLessThan(25 * 60 * 60 * 1000);
    });

    it('queries statuses with IN_PROGRESS category for the project', async () => {
      prisma.activityLog.findMany.mockResolvedValue([]);
      prisma.status.findMany.mockResolvedValue([{ id: 'st-1' }]);
      prisma.issue.findMany.mockResolvedValue([]);

      await service.prefill(USER_A, PROJECT_ID);

      expect(prisma.status.findMany).toHaveBeenCalledWith({
        where: { projectId: PROJECT_ID, category: StatusCategory.IN_PROGRESS },
        select: { id: true },
      });
    });
  });
});

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as membershipUtil from '../common/membership.util';
import { PersonalBoardsService } from './personal-boards.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { IssuesService } from '../issues/issues.service';
import type { IssueDto } from '@next-lane/shared';

// ── Helpers ───────────────────────────────────────────────────────────────────

const USER_A = 'user-a';
const USER_B = 'user-b';
const COL_A = 'col-a';
const COL_B = 'col-b';
const CARD_1 = 'card-1';
const CARD_2 = 'card-2';
const CARD_3 = 'card-3';
const PROJ_ID = 'proj-1';
const ISSUE_ID = 'issue-new';

function makeColumn(overrides: Partial<{
  id: string; userId: string; name: string; order: number; color: string | null;
}> = {}) {
  return {
    id: overrides.id ?? COL_A,
    userId: overrides.userId ?? USER_A,
    name: overrides.name ?? 'To Do',
    order: overrides.order ?? 0,
    color: overrides.color ?? null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

function makeCard(overrides: Partial<{
  id: string; userId: string; columnId: string;
  title: string; notes: string | null; color: string | null;
  dueDate: Date | null; rank: string; promotedIssueId: string | null;
}> = {}) {
  return {
    id: overrides.id ?? CARD_1,
    userId: overrides.userId ?? USER_A,
    columnId: overrides.columnId ?? COL_A,
    title: overrides.title ?? 'My card',
    notes: overrides.notes ?? null,
    color: overrides.color ?? null,
    dueDate: overrides.dueDate ?? null,
    rank: overrides.rank ?? 'a0',
    promotedIssueId: overrides.promotedIssueId ?? null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

/**
 * Minimal Prisma mock. Only the methods PersonalBoardsService uses are
 * declared; everything else is omitted so TS is happy through `unknown`.
 */
function makePrisma() {
  const tx = {
    personalColumn: { create: jest.fn() },
  };
  return {
    personalColumn: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    personalCard: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn((arg: ((t: typeof tx) => unknown) | unknown[]) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(tx),
    ),
    __tx: tx,
  } as unknown as PrismaService & {
    personalColumn: {
      count: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    personalCard: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
    __tx: typeof tx;
  };
}

function makeIssuesService() {
  return {
    create: jest.fn(),
  } as unknown as IssuesService & { create: jest.Mock };
}

type MockPrisma = ReturnType<typeof makePrisma>;
type MockIssues = ReturnType<typeof makeIssuesService>;

// ── Test suite ────────────────────────────────────────────────────────────────

describe('PersonalBoardsService', () => {
  let prisma: MockPrisma;
  let issuesSvc: MockIssues;
  let service: PersonalBoardsService;

  beforeEach(() => {
    prisma = makePrisma();
    issuesSvc = makeIssuesService();
    service = new PersonalBoardsService(
      prisma,
      issuesSvc as unknown as IssuesService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  // ── getBoard: lazy-init ────────────────────────────────────────────────────

  describe('getBoard — lazy-init on first visit', () => {
    it('creates three default columns when the user has none and returns them', async () => {
      prisma.personalColumn.count.mockResolvedValue(0);

      // After creation the findMany returns the three defaults with empty cards.
      const defaultCols = [
        { ...makeColumn({ name: 'To Do', order: 0 }), cards: [] },
        { ...makeColumn({ id: 'col-b2', name: 'Doing', order: 1 }), cards: [] },
        { ...makeColumn({ id: 'col-c3', name: 'Done', order: 2 }), cards: [] },
      ];
      prisma.personalColumn.findMany.mockResolvedValue(defaultCols);

      const result = await service.getBoard(USER_A);

      // The $transaction was called (lazy-init path).
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      // Three columns returned, each with an empty cards array.
      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('To Do');
      expect(result[1].name).toBe('Doing');
      expect(result[2].name).toBe('Done');
      expect(result[0].cards).toEqual([]);
    });

    it('skips init when the user already has columns', async () => {
      prisma.personalColumn.count.mockResolvedValue(2);
      const existing = [
        { ...makeColumn({ name: 'Col1', order: 0 }), cards: [] },
        { ...makeColumn({ id: COL_B, name: 'Col2', order: 1 }), cards: [] },
      ];
      prisma.personalColumn.findMany.mockResolvedValue(existing);

      const result = await service.getBoard(USER_A);

      // No transaction (no init needed).
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(result).toHaveLength(2);
    });

    it('returns cards ordered within each column', async () => {
      prisma.personalColumn.count.mockResolvedValue(1);
      const col = {
        ...makeColumn(),
        cards: [
          makeCard({ id: CARD_1, rank: 'a0' }),
          makeCard({ id: CARD_2, rank: 'a1' }),
        ],
      };
      prisma.personalColumn.findMany.mockResolvedValue([col]);

      const result = await service.getBoard(USER_A);

      expect(result[0].cards).toHaveLength(2);
      expect(result[0].cards![0].id).toBe(CARD_1);
      expect(result[0].cards![1].id).toBe(CARD_2);
    });
  });

  // ── Column ownership ──────────────────────────────────────────────────────

  describe('column ownership enforcement', () => {
    it('updateColumn throws 404 when the column belongs to a different user', async () => {
      // Column exists but belongs to USER_B.
      prisma.personalColumn.findUnique.mockResolvedValue(
        makeColumn({ userId: USER_B }),
      );

      await expect(
        service.updateColumn(USER_A, COL_A, { name: 'Renamed' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      // No DB write should happen.
      expect(prisma.personalColumn.update).not.toHaveBeenCalled();
    });

    it('deleteColumn throws 404 when the column belongs to a different user', async () => {
      prisma.personalColumn.findUnique.mockResolvedValue(
        makeColumn({ userId: USER_B }),
      );

      await expect(
        service.deleteColumn(USER_A, COL_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.personalColumn.delete).not.toHaveBeenCalled();
    });

    it('deleteColumn throws 404 when the column does not exist', async () => {
      prisma.personalColumn.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteColumn(USER_A, 'nonexistent'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── Card ownership ────────────────────────────────────────────────────────

  describe('card ownership enforcement', () => {
    it('updateCard throws 404 when the card belongs to a different user', async () => {
      prisma.personalCard.findUnique.mockResolvedValue(
        makeCard({ userId: USER_B }),
      );

      await expect(
        service.updateCard(USER_A, CARD_1, { title: 'New title' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.personalCard.update).not.toHaveBeenCalled();
    });

    it('deleteCard throws 404 when the card belongs to a different user', async () => {
      prisma.personalCard.findUnique.mockResolvedValue(
        makeCard({ userId: USER_B }),
      );

      await expect(
        service.deleteCard(USER_A, CARD_1),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.personalCard.delete).not.toHaveBeenCalled();
    });

    it('deleteCard throws 404 when the card does not exist', async () => {
      prisma.personalCard.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteCard(USER_A, 'nonexistent'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── createCard: rank ordering ─────────────────────────────────────────────

  describe('createCard — rank ordering', () => {
    beforeEach(() => {
      // Column belongs to user A.
      prisma.personalColumn.findUnique.mockResolvedValue(makeColumn());
    });

    it('creates the first card with a rank after null (beginning of list)', async () => {
      prisma.personalCard.findFirst.mockResolvedValue(null); // no existing cards
      prisma.personalCard.create.mockResolvedValue(
        makeCard({ rank: 'a0' }),
      );

      await service.createCard(USER_A, {
        columnId: COL_A,
        title: 'First card',
      });

      const createCall = prisma.personalCard.create.mock.calls[0][0];
      // rank should be a non-empty string (fractional-index after null).
      expect(typeof createCall.data.rank).toBe('string');
      expect(createCall.data.rank.length).toBeGreaterThan(0);
    });

    it('creates subsequent cards with ranks that sort after the last card', async () => {
      // Simulate an existing card with rank 'a0'.
      prisma.personalCard.findFirst.mockResolvedValue(
        makeCard({ rank: 'a0' }),
      );
      prisma.personalCard.create.mockResolvedValue(
        makeCard({ id: CARD_2, rank: 'a1' }),
      );

      await service.createCard(USER_A, {
        columnId: COL_A,
        title: 'Second card',
      });

      const createCall = prisma.personalCard.create.mock.calls[0][0];
      // The new rank must be lexicographically greater than the previous last.
      expect(createCall.data.rank > 'a0').toBe(true);
    });

    it('rejects card creation when the column belongs to a different user', async () => {
      prisma.personalColumn.findUnique.mockResolvedValue(
        makeColumn({ userId: USER_B }),
      );

      await expect(
        service.createCard(USER_A, { columnId: COL_A, title: 'Card' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.personalCard.create).not.toHaveBeenCalled();
    });

    it('persists color and dueDate on create (dueDate coerced to Date)', async () => {
      prisma.personalCard.findFirst.mockResolvedValue(null);
      prisma.personalCard.create.mockResolvedValue(
        makeCard({ rank: 'a0', color: '#dc2626' }),
      );

      await service.createCard(USER_A, {
        columnId: COL_A,
        title: 'Colored',
        color: '#dc2626',
        dueDate: '2026-12-31T00:00:00.000Z',
      });

      const data = prisma.personalCard.create.mock.calls[0][0].data;
      expect(data.color).toBe('#dc2626');
      expect(data.dueDate).toBeInstanceOf(Date);
      expect((data.dueDate as Date).toISOString()).toBe(
        '2026-12-31T00:00:00.000Z',
      );
    });

    it('defaults color and dueDate to null when omitted', async () => {
      prisma.personalCard.findFirst.mockResolvedValue(null);
      prisma.personalCard.create.mockResolvedValue(makeCard({ rank: 'a0' }));

      await service.createCard(USER_A, { columnId: COL_A, title: 'Plain' });

      const data = prisma.personalCard.create.mock.calls[0][0].data;
      expect(data.color).toBeNull();
      expect(data.dueDate).toBeNull();
    });
  });

  // ── updateCard: move / re-rank ────────────────────────────────────────────

  describe('updateCard — move and re-rank', () => {
    it('computes a rank between the two neighbor cards on move', async () => {
      const card = makeCard({ id: CARD_2, rank: 'a0' });
      prisma.personalCard.findUnique
        .mockResolvedValueOnce(card) // the card being moved
        .mockResolvedValueOnce(makeCard({ id: CARD_1, rank: 'Za', columnId: COL_A, userId: USER_A })) // beforeId
        .mockResolvedValueOnce(makeCard({ id: CARD_3, rank: 'a1', columnId: COL_A, userId: USER_A })); // afterId

      prisma.personalCard.update.mockResolvedValue({
        ...card,
        rank: 'Zm',
      });

      await service.updateCard(USER_A, CARD_2, {
        beforeId: CARD_1,
        afterId: CARD_3,
      });

      const updateCall = prisma.personalCard.update.mock.calls[0][0];
      // A rank was computed (between 'Za' and 'a1').
      expect(typeof updateCall.data.rank).toBe('string');
      expect(updateCall.data.rank > 'Za').toBe(true);
      expect(updateCall.data.rank < 'a1').toBe(true);
    });

    it('places card at end of column when moving with no explicit neighbors', async () => {
      const card = makeCard({ id: CARD_1, columnId: COL_A });
      prisma.personalCard.findUnique.mockResolvedValue(card);
      // Verify target column belongs to user.
      prisma.personalColumn.findUnique.mockResolvedValue(makeColumn({ id: COL_B }));
      // Last card in the target column — use a valid fractional-index rank.
      const lastRank = 'a0';
      prisma.personalCard.findFirst.mockResolvedValue(
        makeCard({ id: 'existing', rank: lastRank, columnId: COL_B }),
      );
      prisma.personalCard.update.mockResolvedValue({
        ...card,
        columnId: COL_B,
        rank: 'a1',
      });

      await service.updateCard(USER_A, CARD_1, { columnId: COL_B });

      const updateCall = prisma.personalCard.update.mock.calls[0][0];
      // Rank is after the last card in the target column ('a0').
      expect(updateCall.data.rank > lastRank).toBe(true);
      expect(updateCall.data.columnId).toBe(COL_B);
    });

    it('throws 404 when beforeId belongs to a different user', async () => {
      const card = makeCard({ id: CARD_2, columnId: COL_A });
      prisma.personalCard.findUnique
        .mockResolvedValueOnce(card) // the card being moved
        .mockResolvedValueOnce(
          makeCard({ id: CARD_1, userId: USER_B, columnId: COL_A }), // beforeId owned by USER_B
        );

      await expect(
        service.updateCard(USER_A, CARD_2, { beforeId: CARD_1 }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.personalCard.update).not.toHaveBeenCalled();
    });
  });

  // ── promoteCard ───────────────────────────────────────────────────────────

  describe('promoteCard', () => {
    const mockIssue: IssueDto = {
      id: ISSUE_ID,
      key: 'PROJ-1',
      number: 1,
      projectId: PROJ_ID,
      type: 'TASK' as never,
      title: 'My card',
      description: null,
      statusId: 'status-1',
      assigneeId: null,
      reporterId: USER_A,
      priority: 'MEDIUM' as never,
      storyPoints: null,
      parentId: null,
      sprintId: null,
      dueDate: null,
      rank: 'a0',
      componentId: null,
      originalEstimateMinutes: null,
      createdAt: new Date('2026-01-01').toISOString(),
      updatedAt: new Date('2026-01-01').toISOString(),
    };

    beforeEach(() => {
      // Allow project membership.
      jest
        .spyOn(membershipUtil, 'assertProjectMember')
        .mockResolvedValue({} as never);
    });

    it('creates a real issue and sets promotedIssueId on the card', async () => {
      const card = makeCard({ title: 'My card', notes: 'some notes' });
      prisma.personalCard.findUnique.mockResolvedValue(card);
      issuesSvc.create.mockResolvedValue(mockIssue);
      prisma.personalCard.update.mockResolvedValue({
        ...card,
        promotedIssueId: ISSUE_ID,
      });

      const result = await service.promoteCard(USER_A, CARD_1, {
        projectId: PROJ_ID,
      });

      // assertProjectMember was called with the right args.
      expect(membershipUtil.assertProjectMember).toHaveBeenCalledWith(
        expect.anything(),
        USER_A,
        PROJ_ID,
      );

      // IssuesService.create was called with the card's content + TASK type.
      expect(issuesSvc.create).toHaveBeenCalledWith(
        USER_A,
        expect.objectContaining({
          projectId: PROJ_ID,
          type: 'TASK',
          title: 'My card',
          description: 'some notes',
        }),
      );

      // The card's promotedIssueId was updated.
      expect(prisma.personalCard.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CARD_1 },
          data: { promotedIssueId: ISSUE_ID },
        }),
      );

      // Result shape is { card, issue }.
      expect(result.card.promotedIssueId).toBe(ISSUE_ID);
      expect(result.issue.id).toBe(ISSUE_ID);
    });

    it('throws 404 when the card does not belong to the caller', async () => {
      prisma.personalCard.findUnique.mockResolvedValue(
        makeCard({ userId: USER_B }),
      );

      await expect(
        service.promoteCard(USER_A, CARD_1, { projectId: PROJ_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(issuesSvc.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the caller is not a project member', async () => {
      prisma.personalCard.findUnique.mockResolvedValue(makeCard());
      jest
        .spyOn(membershipUtil, 'assertProjectMember')
        .mockRejectedValue(new ForbiddenException('Not a member'));

      await expect(
        service.promoteCard(USER_A, CARD_1, { projectId: PROJ_ID }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(issuesSvc.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException (Card already promoted) on double-promote', async () => {
      // Simulate a card that already has a promotedIssueId set (already promoted).
      const alreadyPromoted = makeCard({ promotedIssueId: ISSUE_ID });
      prisma.personalCard.findUnique.mockResolvedValue(alreadyPromoted);

      // A second promote call must be rejected before any issue is created.
      await expect(
        service.promoteCard(USER_A, CARD_1, { projectId: PROJ_ID }),
      ).rejects.toBeInstanceOf(BadRequestException);

      // No issue should be created on a duplicate promote.
      expect(issuesSvc.create).not.toHaveBeenCalled();
      // The card record must not be updated (promotedIssueId stays unchanged).
      expect(prisma.personalCard.update).not.toHaveBeenCalled();
    });

    it('passes null notes as undefined description so the issue field is unset', async () => {
      const card = makeCard({ title: 'No notes card', notes: null });
      prisma.personalCard.findUnique.mockResolvedValue(card);
      issuesSvc.create.mockResolvedValue(mockIssue);
      prisma.personalCard.update.mockResolvedValue({
        ...card,
        promotedIssueId: ISSUE_ID,
      });

      await service.promoteCard(USER_A, CARD_1, { projectId: PROJ_ID });

      expect(issuesSvc.create).toHaveBeenCalledWith(
        USER_A,
        expect.objectContaining({ description: undefined }),
      );
    });
  });

  // ── createColumn: order assignment ───────────────────────────────────────

  describe('createColumn', () => {
    it('assigns order = max+1 when columns already exist', async () => {
      prisma.personalColumn.findFirst.mockResolvedValue(
        makeColumn({ order: 2 }),
      );
      prisma.personalColumn.create.mockResolvedValue(makeColumn({ order: 3 }));

      await service.createColumn(USER_A, { name: 'New Column' });

      const createCall = prisma.personalColumn.create.mock.calls[0][0];
      expect(createCall.data.order).toBe(3);
    });

    it('assigns order = 0 when the user has no existing columns', async () => {
      prisma.personalColumn.findFirst.mockResolvedValue(null);
      prisma.personalColumn.create.mockResolvedValue(makeColumn({ order: 0 }));

      await service.createColumn(USER_A, { name: 'First Column' });

      const createCall = prisma.personalColumn.create.mock.calls[0][0];
      expect(createCall.data.order).toBe(0);
    });
  });

  // ── reorderColumns ───────────────────────────────────────────────────────

  describe('reorderColumns', () => {
    it('rewrites order to the array index and returns the board', async () => {
      prisma.personalColumn.findMany
        .mockResolvedValueOnce([{ id: COL_A }, { id: COL_B }]) // ownership check
        .mockResolvedValueOnce([
          { ...makeColumn({ id: COL_B, order: 0 }), cards: [] },
          { ...makeColumn({ id: COL_A, order: 1 }), cards: [] },
        ]); // getBoard reload
      prisma.personalColumn.count.mockResolvedValue(2);
      prisma.personalColumn.update.mockResolvedValue(makeColumn());

      const result = await service.reorderColumns(USER_A, [COL_B, COL_A]);

      expect(prisma.personalColumn.update).toHaveBeenCalledWith({
        where: { id: COL_B },
        data: { order: 0 },
      });
      expect(prisma.personalColumn.update).toHaveBeenCalledWith({
        where: { id: COL_A },
        data: { order: 1 },
      });
      expect(result).toHaveLength(2);
    });

    it('rejects a partial/foreign id set without touching the DB', async () => {
      prisma.personalColumn.findMany.mockResolvedValueOnce([
        { id: COL_A },
        { id: COL_B },
      ]);

      await expect(
        service.reorderColumns(USER_A, [COL_A]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.personalColumn.update).not.toHaveBeenCalled();
    });

    it('rejects duplicate ids', async () => {
      prisma.personalColumn.findMany.mockResolvedValueOnce([
        { id: COL_A },
        { id: COL_B },
      ]);

      await expect(
        service.reorderColumns(USER_A, [COL_A, COL_A]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

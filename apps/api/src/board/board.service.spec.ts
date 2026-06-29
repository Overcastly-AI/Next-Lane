import {
  SprintState,
  IssueType,
  Priority,
  StatusCategory,
  BoardType,
  Role,
} from '@next-lane/shared';
import * as shared from '@next-lane/shared';
import * as membership from '../common/membership.util';
import { BoardService, BOARD_ISSUES_CAP, toBoardSummaryDto } from './board.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

const PROJECT_ID = 'proj-1';
const PROJECT_KEY = 'NL';
const BOARD_ID = 'board-1';

function makePrisma() {
  return {
    status: { findMany: jest.fn() },
    issue: { findMany: jest.fn() },
    customFieldDefinition: { findMany: jest.fn().mockResolvedValue([]) },
    board: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    workflow: {
      findUnique: jest.fn(),
    },
  } as unknown as PrismaService & {
    status: { findMany: jest.Mock };
    issue: { findMany: jest.Mock };
    customFieldDefinition: { findMany: jest.Mock };
    board: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    workflow: {
      findUnique: jest.Mock;
    };
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

/** Minimal issue row that satisfies toIssueDto mapping requirements. */
function makeIssueRow(i: number) {
  return {
    id: `issue-${i}`,
    number: i,
    projectId: PROJECT_ID,
    type: IssueType.TASK,
    title: `Issue ${i}`,
    description: null,
    statusId: 'status-1',
    assigneeId: null,
    reporterId: null,
    priority: Priority.MEDIUM,
    storyPoints: null,
    parentId: null,
    sprintId: null,
    dueDate: null,
    rank: `a${i}`,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    project: { key: PROJECT_KEY },
    status: {
      id: 'status-1',
      name: 'To Do',
      category: StatusCategory.TODO,
      order: 0,
      projectId: PROJECT_ID,
    },
    assignee: null,
    reporter: null,
    labels: [],
    _count: { comments: 0 },
  };
}

function makeProjectRow() {
  return {
    key: PROJECT_KEY,
    id: PROJECT_ID,
    name: 'Test Project',
    description: null,
    leadId: null,
    workspaceId: 'ws-1',
    archived: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function makeBoardRow(overrides: Partial<{
  id: string;
  type: BoardType;
  isDefault: boolean;
  order: number;
  filterQuery: string | null;
  colorRules: unknown;
}> = {}) {
  return {
    id: overrides.id ?? BOARD_ID,
    projectId: PROJECT_ID,
    name: 'Main Board',
    type: overrides.type ?? BoardType.KANBAN,
    isDefault: overrides.isDefault ?? true,
    order: overrides.order ?? 0,
    filterQuery: overrides.filterQuery ?? null,
    colorRules: overrides.colorRules ?? null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('BoardService', () => {
  let prisma: MockPrisma;
  let service: BoardService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new BoardService(prisma);
    jest
      .spyOn(membership, 'assertProjectMember')
      .mockResolvedValue(makeProjectRow() as never);
    jest
      .spyOn(membership, 'assertProjectRole')
      .mockResolvedValue(makeProjectRow() as never);
  });

  afterEach(() => jest.restoreAllMocks());

  // ── Legacy getBoard ────────────────────────────────────────────────────────

  describe('getBoard (legacy endpoint)', () => {
    it('returns issuesTruncated: false when under the cap', async () => {
      const rows = Array.from({ length: 10 }, (_, i) => makeIssueRow(i));
      const board = makeBoardRow();
      prisma.board.findFirst.mockResolvedValue(board);
      prisma.status.findMany.mockResolvedValue([
        { id: 'status-1', name: 'To Do', category: StatusCategory.TODO, order: 0, projectId: PROJECT_ID },
      ]);
      prisma.issue.findMany.mockResolvedValue(rows);

      const result = await service.getBoard('user-1', PROJECT_ID);

      expect(result.issuesTruncated).toBe(false);
      expect(result.issues).toHaveLength(10);
    });

    it('applies take: BOARD_ISSUES_CAP + 1 to the Prisma query', async () => {
      prisma.board.findFirst.mockResolvedValue(makeBoardRow());
      prisma.status.findMany.mockResolvedValue([]);
      prisma.issue.findMany.mockResolvedValue([]);

      await service.getBoard('user-1', PROJECT_ID);

      expect(prisma.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: BOARD_ISSUES_CAP + 1 }),
      );
    });

    it('sets issuesTruncated: true and slices to CAP when result exceeds cap', async () => {
      const rows = Array.from({ length: BOARD_ISSUES_CAP + 1 }, (_, i) =>
        makeIssueRow(i),
      );
      prisma.board.findFirst.mockResolvedValue(makeBoardRow());
      prisma.status.findMany.mockResolvedValue([
        { id: 'status-1', name: 'To Do', category: StatusCategory.TODO, order: 0, projectId: PROJECT_ID },
      ]);
      prisma.issue.findMany.mockResolvedValue(rows);

      const result = await service.getBoard('user-1', PROJECT_ID);

      expect(result.issuesTruncated).toBe(true);
      expect(result.issues).toHaveLength(BOARD_ISSUES_CAP);
    });

    it('preserves ordering (rank asc) when truncating', async () => {
      const rows = Array.from({ length: BOARD_ISSUES_CAP + 1 }, (_, i) =>
        makeIssueRow(i),
      );
      prisma.board.findFirst.mockResolvedValue(makeBoardRow());
      prisma.status.findMany.mockResolvedValue([
        { id: 'status-1', name: 'To Do', category: StatusCategory.TODO, order: 0, projectId: PROJECT_ID },
      ]);
      prisma.issue.findMany.mockResolvedValue(rows);

      const result = await service.getBoard('user-1', PROJECT_ID);

      expect(result.issues[0].id).toBe('issue-0');
      expect(result.issues[BOARD_ISSUES_CAP - 1].id).toBe(`issue-${BOARD_ISSUES_CAP - 1}`);

      expect(prisma.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ status: { order: 'asc' } }, { rank: 'asc' }],
        }),
      );
    });

    it('lazily creates a default KANBAN board when none exists', async () => {
      // findFirst for isDefault returns null (no default board)
      prisma.board.findFirst.mockResolvedValue(null);
      const createdBoard = makeBoardRow({ type: BoardType.KANBAN });
      prisma.board.create.mockResolvedValue(createdBoard);
      prisma.status.findMany.mockResolvedValue([]);
      prisma.issue.findMany.mockResolvedValue([]);

      const result = await service.getBoard('user-1', PROJECT_ID);

      expect(prisma.board.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Main Board',
            type: BoardType.KANBAN,
            isDefault: true,
            projectId: PROJECT_ID,
          }),
        }),
      );
      expect(result.board.type).toBe(BoardType.KANBAN);
    });

    it('includes the board field in the response', async () => {
      prisma.board.findFirst.mockResolvedValue(makeBoardRow());
      prisma.status.findMany.mockResolvedValue([]);
      prisma.issue.findMany.mockResolvedValue([]);

      const result = await service.getBoard('user-1', PROJECT_ID);

      expect(result.board).toBeDefined();
      expect(result.board.id).toBe(BOARD_ID);
      expect(result.board.type).toBe(BoardType.KANBAN);
    });
  });

  // ── KANBAN vs SCRUM issue scoping ─────────────────────────────────────────

  describe('KANBAN vs SCRUM issue scoping', () => {
    it('KANBAN: filters for active sprint OR backlog via OR clause', async () => {
      prisma.board.findFirst.mockResolvedValue(makeBoardRow({ type: BoardType.KANBAN }));
      prisma.status.findMany.mockResolvedValue([]);
      prisma.issue.findMany.mockResolvedValue([]);

      await service.getBoard('user-1', PROJECT_ID);

      expect(prisma.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { sprintId: null },
              { sprint: { state: SprintState.ACTIVE } },
            ],
          }),
        }),
      );
    });

    it('SCRUM: filters for active sprint only (no OR clause)', async () => {
      prisma.board.findUnique.mockResolvedValue(makeBoardRow({ type: BoardType.SCRUM }));
      prisma.status.findMany.mockResolvedValue([]);
      prisma.issue.findMany.mockResolvedValue([]);

      await service.getBoardById('user-1', BOARD_ID);

      const call = prisma.issue.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(call.where).not.toHaveProperty('OR');
      expect(call.where).toMatchObject({
        sprint: { state: SprintState.ACTIVE },
      });
    });

    it('KANBAN getBoardById also uses OR clause', async () => {
      prisma.board.findUnique.mockResolvedValue(makeBoardRow({ type: BoardType.KANBAN }));
      prisma.status.findMany.mockResolvedValue([]);
      prisma.issue.findMany.mockResolvedValue([]);

      await service.getBoardById('user-1', BOARD_ID);

      expect(prisma.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { sprintId: null },
              { sprint: { state: SprintState.ACTIVE } },
            ],
          }),
        }),
      );
    });
  });

  // ── listBoards ─────────────────────────────────────────────────────────────

  describe('listBoards', () => {
    it('returns boards ordered by order asc, createdAt asc', async () => {
      const boards = [
        makeBoardRow({ id: 'b1', order: 0 }),
        makeBoardRow({ id: 'b2', order: 1 }),
      ];
      prisma.board.findMany.mockResolvedValue(boards);

      const result = await service.listBoards('user-1', PROJECT_ID);

      expect(prisma.board.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: PROJECT_ID },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        }),
      );
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('b1');
    });
  });

  // ── createBoard ────────────────────────────────────────────────────────────

  describe('createBoard', () => {
    it('sets order to (max order) + 1', async () => {
      prisma.board.findFirst.mockResolvedValue({ order: 3 });
      const newBoard = makeBoardRow({ id: 'b-new', order: 4, isDefault: false });
      prisma.board.create.mockResolvedValue(newBoard);

      const result = await service.createBoard('user-1', PROJECT_ID, {
        name: 'Sprint Board',
        type: BoardType.SCRUM,
      });

      expect(prisma.board.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            order: 4,
            isDefault: false,
          }),
        }),
      );
      expect(result.id).toBe('b-new');
    });

    it('sets order to 0 when no boards exist', async () => {
      prisma.board.findFirst.mockResolvedValue(null);
      const newBoard = makeBoardRow({ id: 'b-first', order: 0, isDefault: false });
      prisma.board.create.mockResolvedValue(newBoard);

      await service.createBoard('user-1', PROJECT_ID, {
        name: 'First Board',
        type: BoardType.KANBAN,
      });

      expect(prisma.board.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ order: 0 }),
        }),
      );
    });
  });

  // ── deleteBoard ────────────────────────────────────────────────────────────

  describe('deleteBoard', () => {
    it('throws BadRequestException when deleting the default board', async () => {
      prisma.board.findUnique.mockResolvedValue(makeBoardRow({ isDefault: true }));

      await expect(service.deleteBoard('user-1', BOARD_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.board.delete).not.toHaveBeenCalled();
    });

    it('throws ConflictException when deleting the only board', async () => {
      prisma.board.findUnique.mockResolvedValue(makeBoardRow({ isDefault: false }));
      prisma.board.count.mockResolvedValue(1);

      await expect(service.deleteBoard('user-1', BOARD_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.board.delete).not.toHaveBeenCalled();
    });

    it('succeeds when there are multiple non-default boards', async () => {
      prisma.board.findUnique.mockResolvedValue(makeBoardRow({ isDefault: false }));
      prisma.board.count.mockResolvedValue(3);
      prisma.board.delete.mockResolvedValue(makeBoardRow({ isDefault: false }));

      const result = await service.deleteBoard('user-1', BOARD_ID);

      expect(prisma.board.delete).toHaveBeenCalledWith({ where: { id: BOARD_ID } });
      expect(result).toEqual({ id: BOARD_ID });
    });

    it('throws NotFoundException when board does not exist', async () => {
      prisma.board.findUnique.mockResolvedValue(null);

      await expect(service.deleteBoard('user-1', BOARD_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── updateBoard ────────────────────────────────────────────────────────────

  describe('updateBoard', () => {
    it('persists partial updates', async () => {
      const existing = makeBoardRow({ isDefault: false });
      prisma.board.findUnique.mockResolvedValue(existing);
      const updated = makeBoardRow({ isDefault: false });
      updated.name = 'Renamed';
      prisma.board.update.mockResolvedValue(updated);

      await service.updateBoard('user-1', BOARD_ID, { name: 'Renamed' });

      expect(prisma.board.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: BOARD_ID },
          data: expect.objectContaining({ name: 'Renamed' }),
        }),
      );
    });

    it('throws NotFoundException when board does not exist', async () => {
      prisma.board.findUnique.mockResolvedValue(null);

      await expect(
        service.updateBoard('user-1', BOARD_ID, { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── colorRules round-trip ──────────────────────────────────────────────────

  describe('toBoardSummaryDto colorRules coercion', () => {
    it('returns empty array when colorRules is null', () => {
      const board = makeBoardRow({ colorRules: null });
      const dto = toBoardSummaryDto(board);
      expect(dto.colorRules).toEqual([]);
    });

    it('returns empty array when colorRules is not an array', () => {
      const board = makeBoardRow({ colorRules: { unexpected: true } });
      const dto = toBoardSummaryDto(board);
      expect(dto.colorRules).toEqual([]);
    });

    it('maps valid colorRules entries faithfully', () => {
      const rules = [
        { id: 'r1', query: 'priority = HIGH', color: '#ef4444', label: 'High' },
        { id: 'r2', query: 'type = BUG', color: '#f97316' },
      ];
      const board = makeBoardRow({ colorRules: rules });
      const dto = toBoardSummaryDto(board);
      expect(dto.colorRules).toHaveLength(2);
      expect(dto.colorRules[0]).toMatchObject({ id: 'r1', color: '#ef4444', label: 'High' });
      expect(dto.colorRules[1]).toMatchObject({ id: 'r2', color: '#f97316' });
      expect(dto.colorRules[1]).not.toHaveProperty('label');
    });

    it('skips non-object entries in the colorRules array', () => {
      const rules = [
        null,
        { id: 'r1', query: 'q', color: '#fff' },
        'string-entry',
        42,
      ];
      const board = makeBoardRow({ colorRules: rules });
      const dto = toBoardSummaryDto(board);
      expect(dto.colorRules).toHaveLength(1);
      expect(dto.colorRules[0].id).toBe('r1');
    });

    it('serializes dates as ISO strings', () => {
      const board = makeBoardRow();
      const dto = toBoardSummaryDto(board);
      expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(dto.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  // ── getBoardById ──────────────────────────────────────────────────────────

  describe('getBoardById', () => {
    it('throws NotFoundException when board does not exist', async () => {
      prisma.board.findUnique.mockResolvedValue(null);

      await expect(service.getBoardById('user-1', 'bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the board summary in the board field', async () => {
      prisma.board.findUnique.mockResolvedValue(makeBoardRow());
      prisma.status.findMany.mockResolvedValue([]);
      prisma.issue.findMany.mockResolvedValue([]);

      const result = await service.getBoardById('user-1', BOARD_ID);

      expect(result.board).toBeDefined();
      expect(result.board.id).toBe(BOARD_ID);
    });

    it('checks project membership via assertProjectMember', async () => {
      prisma.board.findUnique.mockResolvedValue(makeBoardRow());
      prisma.status.findMany.mockResolvedValue([]);
      prisma.issue.findMany.mockResolvedValue([]);

      await service.getBoardById('user-1', BOARD_ID);

      expect(membership.assertProjectMember).toHaveBeenCalledWith(
        prisma,
        'user-1',
        PROJECT_ID,
      );
    });
  });

  // ── createBoard role check ─────────────────────────────────────────────────

  describe('createBoard role enforcement', () => {
    it('calls assertProjectRole with MEMBER minimum', async () => {
      prisma.board.findFirst.mockResolvedValue(null);
      prisma.board.create.mockResolvedValue(makeBoardRow({ isDefault: false }));

      await service.createBoard('user-1', PROJECT_ID, {
        name: 'B',
        type: BoardType.KANBAN,
      });

      expect(membership.assertProjectRole).toHaveBeenCalledWith(
        prisma,
        'user-1',
        PROJECT_ID,
        Role.MEMBER,
      );
    });
  });

  // ── updateBoard NLQL validation ─────────────────────────────────────────────

  describe('updateBoard NLQL validation', () => {
    it('rejects an invalid filterQuery with BadRequestException', async () => {
      const existing = makeBoardRow({ isDefault: false });
      prisma.board.findUnique.mockResolvedValue(existing);
      jest.spyOn(shared, 'validateQuery').mockReturnValue({
        ok: false,
        error: { message: 'Unknown field', position: 0 },
      });

      await expect(
        service.updateBoard('user-1', BOARD_ID, {
          filterQuery: 'notafield = foo',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.board.update).not.toHaveBeenCalled();
    });

    it('accepts a valid filterQuery and persists it', async () => {
      const existing = makeBoardRow({ isDefault: false });
      prisma.board.findUnique.mockResolvedValue(existing);
      prisma.board.update.mockResolvedValue(
        makeBoardRow({ isDefault: false, filterQuery: 'priority = HIGH' }),
      );
      jest.spyOn(shared, 'validateQuery').mockReturnValue({ ok: true });

      await service.updateBoard('user-1', BOARD_ID, {
        filterQuery: 'priority = HIGH',
      });

      expect(prisma.board.update).toHaveBeenCalled();
    });

    it('does NOT call validateQuery when filterQuery is null (clear)', async () => {
      const existing = makeBoardRow({ isDefault: false });
      prisma.board.findUnique.mockResolvedValue(existing);
      prisma.board.update.mockResolvedValue(makeBoardRow({ isDefault: false }));
      const validateSpy = jest.spyOn(shared, 'validateQuery');

      await service.updateBoard('user-1', BOARD_ID, { filterQuery: null });

      // null means "clear" — no validation needed
      expect(validateSpy).not.toHaveBeenCalled();
    });

    it('does NOT call validateQuery when filterQuery is omitted', async () => {
      const existing = makeBoardRow({ isDefault: false });
      prisma.board.findUnique.mockResolvedValue(existing);
      prisma.board.update.mockResolvedValue(makeBoardRow({ isDefault: false }));
      const validateSpy = jest.spyOn(shared, 'validateQuery');

      await service.updateBoard('user-1', BOARD_ID, { name: 'Renamed' });

      expect(validateSpy).not.toHaveBeenCalled();
    });

    it('rejects a color rule with invalid query with BadRequestException', async () => {
      const existing = makeBoardRow({ isDefault: false });
      prisma.board.findUnique.mockResolvedValue(existing);
      jest.spyOn(shared, 'validateQuery').mockReturnValue({
        ok: false,
        error: { message: 'bad field', position: 0 },
      });

      await expect(
        service.updateBoard('user-1', BOARD_ID, {
          colorRules: [
            { id: 'r1', query: 'badfield = foo', color: '#ef4444' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.board.update).not.toHaveBeenCalled();
    });

    it('accepts valid color rules and persists them', async () => {
      const existing = makeBoardRow({ isDefault: false });
      prisma.board.findUnique.mockResolvedValue(existing);
      prisma.board.update.mockResolvedValue(makeBoardRow({ isDefault: false }));
      jest.spyOn(shared, 'validateQuery').mockReturnValue({ ok: true });

      await service.updateBoard('user-1', BOARD_ID, {
        colorRules: [
          { id: 'r1', query: 'priority = HIGH', color: '#ef4444' },
        ],
      });

      expect(prisma.board.update).toHaveBeenCalled();
    });

    it('loads custom field defs and passes them to validateQuery', async () => {
      const existing = makeBoardRow({ isDefault: false });
      prisma.board.findUnique.mockResolvedValue(existing);
      prisma.board.update.mockResolvedValue(makeBoardRow({ isDefault: false }));
      prisma.customFieldDefinition.findMany.mockResolvedValue([
        { id: 'cf-1', key: 'severity', name: 'Severity', type: 'SELECT' },
      ]);
      const validateSpy = jest.spyOn(shared, 'validateQuery').mockReturnValue({ ok: true });

      await service.updateBoard('user-1', BOARD_ID, {
        filterQuery: 'severity = High',
      });

      expect(validateSpy).toHaveBeenCalledWith(
        'severity = High',
        expect.objectContaining({
          customFieldDefs: expect.arrayContaining([
            expect.objectContaining({ key: 'severity' }),
          ]),
        }),
      );
    });
  });
});

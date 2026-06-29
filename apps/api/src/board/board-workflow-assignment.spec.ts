/**
 * Unit tests for board workflow assignment: PATCH /boards/:boardId with workflowId.
 *
 * Exercises:
 *  - Setting workflowId to a valid workflow that belongs to the board's project
 *  - Setting workflowId to null (clears the assignment)
 *  - Rejecting a workflow that belongs to a different project (tenant isolation)
 *  - surfacing workflowId in the BoardSummaryDto via toBoardSummaryDto
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BoardService, toBoardSummaryDto } from './board.service';
import type { PrismaService } from '../prisma/prisma.service';
import * as membership from '../common/membership.util';
import { BoardType } from '@next-lane/shared';

const PROJECT_ID = 'proj-1';
const BOARD_ID = 'board-1';
const WORKFLOW_ID = 'wf-1';

function makeProjectRow() {
  return {
    id: PROJECT_ID,
    key: 'NL',
    name: 'Test Project',
    description: null,
    leadId: null,
    workspaceId: 'ws-1',
    archived: false,
    createdAt: new Date('2026-01-01'),
  };
}

function makeBoardRow(overrides: Partial<{
  workflowId: string | null;
  isDefault: boolean;
}> = {}) {
  return {
    id: BOARD_ID,
    projectId: PROJECT_ID,
    name: 'Main Board',
    type: BoardType.KANBAN,
    isDefault: overrides.isDefault ?? true,
    order: 0,
    filterQuery: null,
    colorRules: null,
    workflowId: overrides.workflowId ?? null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

function makePrisma() {
  return {
    board: {
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    workflow: {
      findUnique: jest.fn(),
    },
    customFieldDefinition: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    status: { findMany: jest.fn() },
    issue: { findMany: jest.fn() },
  } as unknown as PrismaService & {
    board: {
      findUnique: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    workflow: { findUnique: jest.Mock };
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

describe('BoardService — workflow assignment', () => {
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

  describe('updateBoard with workflowId', () => {
    it('assigns a workflow that belongs to the same project', async () => {
      prisma.board.findUnique.mockResolvedValue(makeBoardRow());
      (prisma.workflow.findUnique as jest.Mock).mockResolvedValue({
        projectId: PROJECT_ID,
      });
      const updatedBoard = makeBoardRow({ workflowId: WORKFLOW_ID });
      prisma.board.update.mockResolvedValue(updatedBoard);

      const result = await service.updateBoard('user-1', BOARD_ID, {
        workflowId: WORKFLOW_ID,
      });

      expect(prisma.workflow.findUnique).toHaveBeenCalledWith({
        where: { id: WORKFLOW_ID },
        select: { projectId: true },
      });
      expect(prisma.board.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workflow: { connect: { id: WORKFLOW_ID } },
          }),
        }),
      );
      expect(result.workflowId).toBe(WORKFLOW_ID);
    });

    it('clears workflow assignment when workflowId is null', async () => {
      prisma.board.findUnique.mockResolvedValue(makeBoardRow({ workflowId: WORKFLOW_ID }));
      const updatedBoard = makeBoardRow({ workflowId: null });
      prisma.board.update.mockResolvedValue(updatedBoard);

      const result = await service.updateBoard('user-1', BOARD_ID, {
        workflowId: null,
      });

      expect(prisma.board.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workflow: { disconnect: true },
          }),
        }),
      );
      expect(result.workflowId).toBeNull();
      // workflow.findUnique should NOT be called for null (no validation needed)
      expect(prisma.workflow.findUnique).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when workflow belongs to a different project', async () => {
      prisma.board.findUnique.mockResolvedValue(makeBoardRow());
      (prisma.workflow.findUnique as jest.Mock).mockResolvedValue({
        projectId: 'other-project',
      });

      await expect(
        service.updateBoard('user-1', BOARD_ID, { workflowId: WORKFLOW_ID }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.board.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when workflowId does not exist', async () => {
      prisma.board.findUnique.mockResolvedValue(makeBoardRow());
      (prisma.workflow.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateBoard('user-1', BOARD_ID, { workflowId: WORKFLOW_ID }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not query workflow when workflowId is not in the payload', async () => {
      prisma.board.findUnique.mockResolvedValue(makeBoardRow());
      prisma.board.update.mockResolvedValue(makeBoardRow());

      await service.updateBoard('user-1', BOARD_ID, { name: 'Renamed' });

      expect(prisma.workflow.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when board does not exist', async () => {
      prisma.board.findUnique.mockResolvedValue(null);

      await expect(
        service.updateBoard('user-1', BOARD_ID, { workflowId: WORKFLOW_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('toBoardSummaryDto — workflowId serialization', () => {
    it('includes workflowId in the DTO when set', () => {
      const board = makeBoardRow({ workflowId: WORKFLOW_ID });
      const dto = toBoardSummaryDto(board);
      expect(dto.workflowId).toBe(WORKFLOW_ID);
    });

    it('includes workflowId as null when not set', () => {
      const board = makeBoardRow({ workflowId: null });
      const dto = toBoardSummaryDto(board);
      expect(dto.workflowId).toBeNull();
    });

    it('coerces undefined workflowId to null', () => {
      // Simulates older board rows that predate the workflowId column
      const board = {
        id: BOARD_ID,
        projectId: PROJECT_ID,
        name: 'Board',
        type: BoardType.KANBAN,
        isDefault: false,
        order: 0,
        filterQuery: null,
        colorRules: null,
        // workflowId intentionally absent
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const dto = toBoardSummaryDto(board);
      expect(dto.workflowId).toBeNull();
    });
  });
});

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as membership from '../common/membership.util';
import { WorkflowService } from './workflow.service';
import type { PrismaService } from '../prisma/prisma.service';
import { Role } from '@next-lane/shared';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const USER_ID = 'user-1';
const STATUS_A = 'status-a';
const STATUS_B = 'status-b';
const STATUS_C = 'status-c';
const TRANSITION_ID = 'trans-1';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeTransitionRow(overrides: Partial<{
  id: string;
  projectId: string;
  fromStatusId: string | null;
  toStatusId: string;
  issueType: string | null;
  name: string | null;
  gates: unknown[];
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: TRANSITION_ID,
    projectId: PROJECT_ID,
    fromStatusId: STATUS_A,
    toStatusId: STATUS_B,
    issueType: null,
    name: null,
    gates: [],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function makePrisma() {
  return {
    project: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    status: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    workflowTransition: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    membership: {
      findUnique: jest.fn(),
    },
  } as unknown as PrismaService;
}

type MockPrisma = ReturnType<typeof makePrisma>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowService', () => {
  let prisma: MockPrisma;
  let service: WorkflowService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new WorkflowService(prisma);
    jest
      .spyOn(membership, 'assertProjectMember')
      .mockResolvedValue({ workflowEnforced: false } as never);
    jest
      .spyOn(membership, 'assertProjectRole')
      .mockResolvedValue({ workflowEnforced: false } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  // ── getWorkflow ────────────────────────────────────────────────────────────

  describe('getWorkflow', () => {
    it('returns workflow with enforced flag and transitions', async () => {
      jest
        .spyOn(membership, 'assertProjectMember')
        .mockResolvedValue({ workflowEnforced: true } as never);

      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([
        makeTransitionRow(),
      ]);

      const result = await service.getWorkflow(USER_ID, PROJECT_ID);

      expect(result.projectId).toBe(PROJECT_ID);
      expect(result.enforced).toBe(true);
      expect(result.transitions).toHaveLength(1);
      expect(result.transitions[0].id).toBe(TRANSITION_ID);
    });

    it('returns empty transitions when none exist', async () => {
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getWorkflow(USER_ID, PROJECT_ID);

      expect(result.transitions).toHaveLength(0);
    });

    it('maps gates array from JSON', async () => {
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([
        makeTransitionRow({ gates: [{ type: 'REQUIRE_ASSIGNEE' }] }),
      ]);

      const result = await service.getWorkflow(USER_ID, PROJECT_ID);

      expect(result.transitions[0].gates).toEqual([{ type: 'REQUIRE_ASSIGNEE' }]);
    });
  });

  // ── patchEnforced ──────────────────────────────────────────────────────────

  describe('patchEnforced', () => {
    it('enables enforcement and returns updated workflow', async () => {
      (prisma.project.update as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.count as jest.Mock).mockResolvedValue(2);
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([
        makeTransitionRow(),
      ]);

      const result = await service.patchEnforced(USER_ID, PROJECT_ID, { enforced: true });

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: PROJECT_ID },
        data: { workflowEnforced: true },
      });
      expect(result.enforced).toBe(true);
      // count > 0, so no seed
      expect(prisma.status.findMany).not.toHaveBeenCalled();
    });

    it('disables enforcement without seeding', async () => {
      (prisma.project.update as jest.Mock).mockResolvedValue({ workflowEnforced: false });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.patchEnforced(USER_ID, PROJECT_ID, { enforced: false });

      expect(result.enforced).toBe(false);
      // Not enabling, so never checks count or seeds
      expect(prisma.workflowTransition.count).not.toHaveBeenCalled();
    });

    it('auto-seeds permissive transitions when enabling with zero transitions', async () => {
      (prisma.project.update as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.count as jest.Mock).mockResolvedValue(0);
      (prisma.status.findMany as jest.Mock).mockResolvedValue([
        { id: STATUS_A },
        { id: STATUS_B },
        { id: STATUS_C },
      ]);
      (prisma.workflowTransition.createMany as jest.Mock).mockResolvedValue({ count: 6 });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([]);

      await service.patchEnforced(USER_ID, PROJECT_ID, { enforced: true });

      // 3 statuses → 3*2 = 6 ordered pairs
      expect(prisma.workflowTransition.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ fromStatusId: STATUS_A, toStatusId: STATUS_B }),
            expect.objectContaining({ fromStatusId: STATUS_A, toStatusId: STATUS_C }),
            expect.objectContaining({ fromStatusId: STATUS_B, toStatusId: STATUS_A }),
            expect.objectContaining({ fromStatusId: STATUS_B, toStatusId: STATUS_C }),
            expect.objectContaining({ fromStatusId: STATUS_C, toStatusId: STATUS_A }),
            expect.objectContaining({ fromStatusId: STATUS_C, toStatusId: STATUS_B }),
          ]),
          skipDuplicates: true,
        }),
      );
    });

    it('does not seed when enabling with existing transitions', async () => {
      (prisma.project.update as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.count as jest.Mock).mockResolvedValue(3);
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([]);

      await service.patchEnforced(USER_ID, PROJECT_ID, { enforced: true });

      expect(prisma.workflowTransition.createMany).not.toHaveBeenCalled();
    });

    it('requires ADMIN role', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockRejectedValue(new ForbiddenException('Requires ADMIN role in this project'));

      await expect(
        service.patchEnforced(USER_ID, PROJECT_ID, { enforced: true }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ── createTransition ───────────────────────────────────────────────────────

  describe('createTransition', () => {
    it('creates a transition with valid status ids', async () => {
      (prisma.status.findUnique as jest.Mock).mockResolvedValue({ projectId: PROJECT_ID });
      (prisma.workflowTransition.create as jest.Mock).mockResolvedValue(makeTransitionRow());

      const result = await service.createTransition(USER_ID, PROJECT_ID, {
        fromStatusId: STATUS_A,
        toStatusId: STATUS_B,
      });

      expect(result.id).toBe(TRANSITION_ID);
    });

    it('throws NotFoundException when toStatusId does not belong to project', async () => {
      (prisma.status.findUnique as jest.Mock).mockResolvedValue({ projectId: 'other-project' });

      await expect(
        service.createTransition(USER_ID, PROJECT_ID, { toStatusId: 'bad-status' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when fromStatusId does not belong to project', async () => {
      (prisma.status.findUnique as jest.Mock)
        .mockResolvedValueOnce({ projectId: PROJECT_ID }) // toStatusId ok
        .mockResolvedValueOnce({ projectId: 'other-project' }); // fromStatusId bad

      await expect(
        service.createTransition(USER_ID, PROJECT_ID, {
          fromStatusId: 'bad-status',
          toStatusId: STATUS_B,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException (409) on duplicate transition (P2002)', async () => {
      (prisma.status.findUnique as jest.Mock).mockResolvedValue({ projectId: PROJECT_ID });
      (prisma.workflowTransition.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.createTransition(USER_ID, PROJECT_ID, {
          fromStatusId: STATUS_A,
          toStatusId: STATUS_B,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('accepts null fromStatusId (wildcard from any status)', async () => {
      (prisma.status.findUnique as jest.Mock).mockResolvedValue({ projectId: PROJECT_ID });
      (prisma.workflowTransition.create as jest.Mock).mockResolvedValue(
        makeTransitionRow({ fromStatusId: null }),
      );

      const result = await service.createTransition(USER_ID, PROJECT_ID, {
        fromStatusId: null,
        toStatusId: STATUS_B,
      });

      expect(result.fromStatusId).toBeNull();
    });

    it('accepts gates with type and required params', async () => {
      (prisma.status.findUnique as jest.Mock).mockResolvedValue({ projectId: PROJECT_ID });
      const gates = [{ type: 'REQUIRE_FIELD' as const, field: 'storyPoints' }];
      (prisma.workflowTransition.create as jest.Mock).mockResolvedValue(
        makeTransitionRow({ gates }),
      );

      const result = await service.createTransition(USER_ID, PROJECT_ID, {
        toStatusId: STATUS_B,
        gates: gates as never,
      });

      expect(result.gates).toEqual(gates);
    });
  });

  // ── updateTransition ───────────────────────────────────────────────────────

  describe('updateTransition', () => {
    it('updates a transition with new gates', async () => {
      (prisma.workflowTransition.findUnique as jest.Mock).mockResolvedValue(
        makeTransitionRow(),
      );
      const newGates = [{ type: 'REQUIRE_ASSIGNEE' }];
      (prisma.workflowTransition.update as jest.Mock).mockResolvedValue(
        makeTransitionRow({ gates: newGates }),
      );

      const result = await service.updateTransition(USER_ID, TRANSITION_ID, {
        gates: newGates as never,
      });

      expect(result.gates).toEqual(newGates);
    });

    it('throws NotFoundException for unknown transition', async () => {
      (prisma.workflowTransition.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateTransition(USER_ID, 'bad-id', { name: 'Test' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('re-validates toStatusId if changed', async () => {
      (prisma.workflowTransition.findUnique as jest.Mock).mockResolvedValue(
        makeTransitionRow(),
      );
      (prisma.status.findUnique as jest.Mock).mockResolvedValue({ projectId: 'wrong-project' });

      await expect(
        service.updateTransition(USER_ID, TRANSITION_ID, { toStatusId: 'bad-status' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException (409) on duplicate (P2002)', async () => {
      (prisma.workflowTransition.findUnique as jest.Mock).mockResolvedValue(
        makeTransitionRow(),
      );
      (prisma.workflowTransition.update as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.updateTransition(USER_ID, TRANSITION_ID, {}),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── deleteTransition ───────────────────────────────────────────────────────

  describe('deleteTransition', () => {
    it('deletes a transition successfully', async () => {
      (prisma.workflowTransition.findUnique as jest.Mock).mockResolvedValue(
        makeTransitionRow(),
      );
      (prisma.workflowTransition.delete as jest.Mock).mockResolvedValue({});

      await expect(service.deleteTransition(USER_ID, TRANSITION_ID)).resolves.toBeUndefined();
      expect(prisma.workflowTransition.delete).toHaveBeenCalledWith({
        where: { id: TRANSITION_ID },
      });
    });

    it('throws NotFoundException for unknown transition', async () => {
      (prisma.workflowTransition.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.deleteTransition(USER_ID, 'bad-id'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('requires ADMIN role', async () => {
      (prisma.workflowTransition.findUnique as jest.Mock).mockResolvedValue(
        makeTransitionRow(),
      );
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockRejectedValue(
          new ForbiddenException(`Requires ${Role.ADMIN} role in this project`),
        );

      await expect(
        service.deleteTransition(USER_ID, TRANSITION_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});

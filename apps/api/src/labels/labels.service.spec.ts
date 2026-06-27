import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@next-lane/shared';
import { LabelsService } from './labels.service';
import type { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// DB-free unit tests for LabelsService.update (rename / recolor).
// Prisma + membership utils are mocked; the goal is to verify the business
// rules without a running DB: auth / role / cross-project / validation.
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const OTHER_PROJECT_ID = 'proj-2';
const LABEL_ID = 'label-abc';
const USER_ID = 'user-owner';
const VIEWER_ID = 'user-viewer';
const FOREIGN_USER_ID = 'user-foreign';

/** Build a minimal Prisma mock that satisfies LabelsService's usage. */
function makePrisma(opts: {
  labelProjectId?: string;
  userRole?: Role | null;
} = {}) {
  const labelProjectId = opts.labelProjectId ?? PROJECT_ID;
  const userRole = opts.userRole !== undefined ? opts.userRole : Role.MEMBER;

  const prisma = {
    label: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === LABEL_ID) {
          return Promise.resolve({
            id: LABEL_ID,
            name: 'original',
            color: '#3b82f6',
            projectId: labelProjectId,
          });
        }
        return Promise.resolve(null);
      }),
      update: jest.fn().mockImplementation(
        ({ where, data }: { where: { id: string }; data: { name?: string; color?: string } }) =>
          Promise.resolve({
            id: where.id,
            name: data.name ?? 'original',
            color: data.color ?? '#3b82f6',
            projectId: labelProjectId,
          }),
      ),
    },
    project: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === PROJECT_ID) {
          return Promise.resolve({ id: PROJECT_ID, workspaceId: 'ws-1', workspace: { id: 'ws-1' } });
        }
        if (where.id === OTHER_PROJECT_ID) {
          return Promise.resolve({ id: OTHER_PROJECT_ID, workspaceId: 'ws-2', workspace: { id: 'ws-2' } });
        }
        return Promise.resolve(null);
      }),
    },
    membership: {
      findUnique: jest.fn().mockImplementation(
        ({ where }: { where: { userId_workspaceId: { userId: string; workspaceId: string } } }) => {
          const { userId } = where.userId_workspaceId;
          if (userId === FOREIGN_USER_ID) return Promise.resolve(null);
          if (userId === VIEWER_ID) {
            return Promise.resolve({ role: Role.VIEWER });
          }
          if (userRole === null) return Promise.resolve(null);
          return Promise.resolve({ role: userRole });
        },
      ),
    },
  };
  return prisma as unknown as PrismaService;
}

describe('LabelsService.update', () => {
  let service: LabelsService;

  describe('rename succeeds for MEMBER', () => {
    beforeEach(() => {
      service = new LabelsService(makePrisma({ userRole: Role.MEMBER }));
    });

    it('returns the updated label with the new name', async () => {
      const result = await service.update(USER_ID, LABEL_ID, { name: 'renamed' });
      expect(result.name).toBe('renamed');
      expect(result.id).toBe(LABEL_ID);
      expect(result.projectId).toBe(PROJECT_ID);
    });
  });

  describe('color update succeeds for ADMIN', () => {
    beforeEach(() => {
      service = new LabelsService(makePrisma({ userRole: Role.ADMIN }));
    });

    it('returns the updated label with the new color', async () => {
      const result = await service.update(USER_ID, LABEL_ID, { color: '#ef4444' });
      expect(result.color).toBe('#ef4444');
    });
  });

  describe('rename + recolor together succeeds', () => {
    beforeEach(() => {
      service = new LabelsService(makePrisma({ userRole: Role.MEMBER }));
    });

    it('passes both fields through to prisma.update', async () => {
      const result = await service.update(USER_ID, LABEL_ID, {
        name: 'fixed-name',
        color: '#22c55e',
      });
      expect(result.name).toBe('fixed-name');
      expect(result.color).toBe('#22c55e');
    });
  });

  describe('VIEWER is rejected', () => {
    beforeEach(() => {
      service = new LabelsService(makePrisma({ userRole: Role.VIEWER }));
    });

    it('throws ForbiddenException when caller is VIEWER', async () => {
      await expect(
        service.update(VIEWER_ID, LABEL_ID, { name: 'renamed' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('cross-project / foreign label rejected', () => {
    beforeEach(() => {
      // The label belongs to OTHER_PROJECT_ID; the caller is a MEMBER of
      // PROJECT_ID but has no membership in ws-2 (the workspace owning
      // OTHER_PROJECT_ID). The membership mock returns null for non-member.
      service = new LabelsService(
        makePrisma({ labelProjectId: OTHER_PROJECT_ID, userRole: null }),
      );
    });

    it('throws ForbiddenException for a label in a project the caller does not belong to', async () => {
      await expect(
        service.update(USER_ID, LABEL_ID, { name: 'hack' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('non-existent label rejected', () => {
    beforeEach(() => {
      service = new LabelsService(makePrisma());
    });

    it('throws NotFoundException for an unknown label id', async () => {
      await expect(
        service.update(USER_ID, 'does-not-exist', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

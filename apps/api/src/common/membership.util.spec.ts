import { ForbiddenException } from '@nestjs/common';
import { Role } from '@next-lane/shared';
import type { PrismaService } from '../prisma/prisma.service';
import {
  assertWorkspaceMember,
  assertWorkspaceRole,
  assertProjectMember,
  assertProjectRole,
} from './membership.util';

/**
 * DB-free unit tests for the workspace/project authorization helpers. These are
 * the core tenant-isolation guards, so we exercise: missing membership =>
 * Forbidden, insufficient role => Forbidden, sufficient role => passes, and the
 * full ROLE_RANK ordering (VIEWER < MEMBER < ADMIN).
 */

const WORKSPACE_ID = 'ws-1';
const PROJECT_ID = 'proj-1';
const USER_ID = 'user-1';

const workspace = { id: WORKSPACE_ID, name: 'Acme' };
const project = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  workspace,
};

function makePrisma() {
  return {
    membership: { findUnique: jest.fn() },
    project: { findUnique: jest.fn() },
  } as unknown as PrismaService & {
    membership: { findUnique: jest.Mock };
    project: { findUnique: jest.Mock };
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

describe('membership.util', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = makePrisma();
  });

  describe('assertWorkspaceMember', () => {
    it('returns the workspace when the user is a member', async () => {
      prisma.membership.findUnique.mockResolvedValue({
        role: Role.VIEWER,
        workspace,
      });

      const result = await assertWorkspaceMember(prisma, USER_ID, WORKSPACE_ID);

      expect(result).toBe(workspace);
      expect(prisma.membership.findUnique).toHaveBeenCalledWith({
        where: { userId_workspaceId: { userId: USER_ID, workspaceId: WORKSPACE_ID } },
        include: { workspace: true },
      });
    });

    it('throws ForbiddenException when the user is not a member', async () => {
      prisma.membership.findUnique.mockResolvedValue(null);

      await expect(
        assertWorkspaceMember(prisma, USER_ID, WORKSPACE_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('assertWorkspaceRole', () => {
    it('throws ForbiddenException when not a member', async () => {
      prisma.membership.findUnique.mockResolvedValue(null);

      await expect(
        assertWorkspaceRole(prisma, USER_ID, WORKSPACE_ID, Role.VIEWER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ForbiddenException when role is below the required role', async () => {
      prisma.membership.findUnique.mockResolvedValue({
        role: Role.VIEWER,
        workspace,
      });

      await expect(
        assertWorkspaceRole(prisma, USER_ID, WORKSPACE_ID, Role.MEMBER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('passes and returns workspace when role equals the required role', async () => {
      prisma.membership.findUnique.mockResolvedValue({
        role: Role.MEMBER,
        workspace,
      });

      await expect(
        assertWorkspaceRole(prisma, USER_ID, WORKSPACE_ID, Role.MEMBER),
      ).resolves.toBe(workspace);
    });

    it('passes when role exceeds the required role (ADMIN >= MEMBER)', async () => {
      prisma.membership.findUnique.mockResolvedValue({
        role: Role.ADMIN,
        workspace,
      });

      await expect(
        assertWorkspaceRole(prisma, USER_ID, WORKSPACE_ID, Role.MEMBER),
      ).resolves.toBe(workspace);
    });
  });

  describe('assertProjectMember', () => {
    it('returns the project when the user belongs to its workspace', async () => {
      prisma.project.findUnique.mockResolvedValue(project);
      prisma.membership.findUnique.mockResolvedValue({ role: Role.VIEWER });

      const result = await assertProjectMember(prisma, USER_ID, PROJECT_ID);

      expect(result).toBe(project);
      expect(prisma.membership.findUnique).toHaveBeenCalledWith({
        where: {
          userId_workspaceId: { userId: USER_ID, workspaceId: WORKSPACE_ID },
        },
      });
    });

    it('throws ForbiddenException when the project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(
        assertProjectMember(prisma, USER_ID, PROJECT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.membership.findUnique).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the user is not in the project workspace', async () => {
      prisma.project.findUnique.mockResolvedValue(project);
      prisma.membership.findUnique.mockResolvedValue(null);

      await expect(
        assertProjectMember(prisma, USER_ID, PROJECT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('assertProjectRole', () => {
    it('throws ForbiddenException when the project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(
        assertProjectRole(prisma, USER_ID, PROJECT_ID, Role.VIEWER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ForbiddenException when not a member of the workspace', async () => {
      prisma.project.findUnique.mockResolvedValue(project);
      prisma.membership.findUnique.mockResolvedValue(null);

      await expect(
        assertProjectRole(prisma, USER_ID, PROJECT_ID, Role.VIEWER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ForbiddenException when role is insufficient (MEMBER < ADMIN)', async () => {
      prisma.project.findUnique.mockResolvedValue(project);
      prisma.membership.findUnique.mockResolvedValue({ role: Role.MEMBER });

      await expect(
        assertProjectRole(prisma, USER_ID, PROJECT_ID, Role.ADMIN),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('passes when role is sufficient (ADMIN satisfies ADMIN)', async () => {
      prisma.project.findUnique.mockResolvedValue(project);
      prisma.membership.findUnique.mockResolvedValue({ role: Role.ADMIN });

      await expect(
        assertProjectRole(prisma, USER_ID, PROJECT_ID, Role.ADMIN),
      ).resolves.toBe(project);
    });
  });

  describe('ROLE_RANK ordering (VIEWER < MEMBER < ADMIN)', () => {
    const rolesAtOrAbove: Array<[Role, Role[]]> = [
      [Role.VIEWER, [Role.VIEWER, Role.MEMBER, Role.ADMIN]],
      [Role.MEMBER, [Role.MEMBER, Role.ADMIN]],
      [Role.ADMIN, [Role.ADMIN]],
    ];

    it.each(rolesAtOrAbove)(
      'a %s requirement is satisfied only by sufficient roles',
      async (required, satisfyingRoles) => {
        for (const role of [Role.VIEWER, Role.MEMBER, Role.ADMIN]) {
          prisma.membership.findUnique.mockResolvedValue({ role, workspace });
          const call = assertWorkspaceRole(
            prisma,
            USER_ID,
            WORKSPACE_ID,
            required,
          );
          if (satisfyingRoles.includes(role)) {
            await expect(call).resolves.toBe(workspace);
          } else {
            await expect(call).rejects.toBeInstanceOf(ForbiddenException);
          }
        }
      },
    );
  });
});

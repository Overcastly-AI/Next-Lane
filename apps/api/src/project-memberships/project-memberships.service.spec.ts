/**
 * DB-free unit tests for ProjectMembershipsService — the per-project role
 * override REST surface layered above the workspace-wide Membership.
 *
 * Covers:
 *  - listMembers(): merges workspace memberships with ProjectMembership
 *    overrides into effective-role rows; requires any workspace membership.
 *  - setOverride(): requires effective project ADMIN; 404 when the target
 *    isn't a workspace member; 400 refusing to override a workspace ADMIN;
 *    upserts the override row; can both ELEVATE and RESTRICT.
 *  - clearOverride(): requires effective project ADMIN; 404 when no override
 *    row exists; deletes the row and returns the reverted (inherited) role.
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@next-lane/shared';
import { ProjectMembershipsService } from './project-memberships.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

const PROJECT_ID = 'proj-1';
const WORKSPACE_ID = 'ws-1';
const ADMIN_ID = 'user-admin';
const MEMBER_ID = 'user-member';
const OTHER_MEMBER_ID = 'user-other-member';
const FOREIGN_ID = 'user-foreign';

function makeUser(id: string) {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    avatarColor: '#6366f1',
    emailNotifications: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

interface Membership {
  userId: string;
  role: Role;
  user: ReturnType<typeof makeUser>;
}

function makePrisma(opts: {
  memberships?: Membership[];
  overrides?: Array<{ id: string; userId: string; projectId: string; role: Role }>;
} = {}) {
  const memberships: Membership[] =
    opts.memberships ??
    [
      { userId: ADMIN_ID, role: Role.ADMIN, user: makeUser(ADMIN_ID) },
      { userId: MEMBER_ID, role: Role.MEMBER, user: makeUser(MEMBER_ID) },
      { userId: OTHER_MEMBER_ID, role: Role.MEMBER, user: makeUser(OTHER_MEMBER_ID) },
    ];
  const overrides = opts.overrides ?? [];

  const membershipByUser = new Map(memberships.map((m) => [m.userId, m]));

  const prisma = {
    project: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id !== PROJECT_ID) return Promise.resolve(null);
        return Promise.resolve({
          id: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          workspace: { id: WORKSPACE_ID },
        });
      }),
    },
    membership: {
      findUnique: jest.fn().mockImplementation(
        ({
          where,
        }: {
          where: { userId_workspaceId: { userId: string; workspaceId: string } };
        }) => {
          const { userId } = where.userId_workspaceId;
          const m = membershipByUser.get(userId);
          if (!m) return Promise.resolve(null);
          return Promise.resolve({ role: m.role, user: m.user });
        },
      ),
      findMany: jest.fn().mockResolvedValue(memberships),
    },
    projectMembership: {
      findUnique: jest.fn().mockImplementation(
        ({
          where,
        }: {
          where: { projectId_userId: { projectId: string; userId: string } };
        }) => {
          const { userId } = where.projectId_userId;
          const row = overrides.find((o) => o.userId === userId);
          return Promise.resolve(row ?? null);
        },
      ),
      findMany: jest.fn().mockResolvedValue(overrides),
      upsert: jest.fn().mockImplementation(
        ({
          create,
          update,
        }: {
          create: { projectId: string; userId: string; role: Role };
          update: { role: Role };
        }) => Promise.resolve({ id: 'pm-1', ...create, ...update }),
      ),
      delete: jest.fn().mockResolvedValue({ id: 'pm-1' }),
    },
  };
  return prisma as unknown as PrismaService & {
    project: { findUnique: jest.Mock };
    membership: { findUnique: jest.Mock; findMany: jest.Mock };
    projectMembership: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      upsert: jest.Mock;
      delete: jest.Mock;
    };
  };
}

function makeAudit(): AuditService {
  return { record: jest.fn() } as unknown as AuditService;
}

describe('ProjectMembershipsService.listMembers', () => {
  it('returns every workspace member with effectiveRole = workspaceRole when no override exists', async () => {
    const prisma = makePrisma();
    const service = new ProjectMembershipsService(prisma, makeAudit());

    const result = await service.listMembers(ADMIN_ID, PROJECT_ID);

    expect(result).toHaveLength(3);
    const member = result.find((r) => r.userId === MEMBER_ID);
    expect(member).toEqual(
      expect.objectContaining({ workspaceRole: Role.MEMBER, effectiveRole: Role.MEMBER, isOverride: false }),
    );
  });

  it('marks a member with a ProjectMembership override with the override role + isOverride: true', async () => {
    const prisma = makePrisma({
      overrides: [{ id: 'pm-1', projectId: PROJECT_ID, userId: MEMBER_ID, role: Role.ADMIN }],
    });
    const service = new ProjectMembershipsService(prisma, makeAudit());

    const result = await service.listMembers(ADMIN_ID, PROJECT_ID);

    const member = result.find((r) => r.userId === MEMBER_ID);
    expect(member).toEqual(
      expect.objectContaining({ workspaceRole: Role.MEMBER, effectiveRole: Role.ADMIN, isOverride: true }),
    );
  });

  it('ignores a stray override row for a workspace ADMIN', async () => {
    const prisma = makePrisma({
      overrides: [{ id: 'pm-2', projectId: PROJECT_ID, userId: ADMIN_ID, role: Role.VIEWER }],
    });
    const service = new ProjectMembershipsService(prisma, makeAudit());

    const result = await service.listMembers(ADMIN_ID, PROJECT_ID);

    const admin = result.find((r) => r.userId === ADMIN_ID);
    expect(admin).toEqual(
      expect.objectContaining({ workspaceRole: Role.ADMIN, effectiveRole: Role.ADMIN, isOverride: false }),
    );
  });

  it('rejects a caller who is not a member of the project’s workspace', async () => {
    const prisma = makePrisma();
    const service = new ProjectMembershipsService(prisma, makeAudit());

    await expect(service.listMembers(FOREIGN_ID, PROJECT_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('ProjectMembershipsService.setOverride', () => {
  it('requires effective project ADMIN — a plain MEMBER is rejected', async () => {
    const prisma = makePrisma();
    const service = new ProjectMembershipsService(prisma, makeAudit());

    await expect(
      service.setOverride(MEMBER_ID, PROJECT_ID, OTHER_MEMBER_ID, { role: Role.ADMIN }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a project-level ADMIN override itself grants permission to set further overrides', async () => {
    const prisma = makePrisma({
      overrides: [{ id: 'pm-1', projectId: PROJECT_ID, userId: MEMBER_ID, role: Role.ADMIN }],
    });
    const service = new ProjectMembershipsService(prisma, makeAudit());

    const result = await service.setOverride(MEMBER_ID, PROJECT_ID, OTHER_MEMBER_ID, {
      role: Role.VIEWER,
    });

    expect(result.effectiveRole).toBe(Role.VIEWER);
    expect(result.isOverride).toBe(true);
  });

  it('ELEVATES a workspace MEMBER to project ADMIN', async () => {
    const prisma = makePrisma();
    const audit = makeAudit();
    const service = new ProjectMembershipsService(prisma, audit);

    const result = await service.setOverride(ADMIN_ID, PROJECT_ID, MEMBER_ID, {
      role: Role.ADMIN,
    });

    expect(result.effectiveRole).toBe(Role.ADMIN);
    expect(result.isOverride).toBe(true);
    expect(prisma.projectMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_userId: { projectId: PROJECT_ID, userId: MEMBER_ID } },
        create: { projectId: PROJECT_ID, userId: MEMBER_ID, role: Role.ADMIN },
        update: { role: Role.ADMIN },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project_membership.override_set' }),
    );
  });

  it('RESTRICTS a workspace MEMBER to project VIEWER', async () => {
    const prisma = makePrisma();
    const service = new ProjectMembershipsService(prisma, makeAudit());

    const result = await service.setOverride(ADMIN_ID, PROJECT_ID, MEMBER_ID, {
      role: Role.VIEWER,
    });

    expect(result.effectiveRole).toBe(Role.VIEWER);
    expect(result.isOverride).toBe(true);
  });

  it('refuses (400) to set an override for a workspace ADMIN', async () => {
    const prisma = makePrisma();
    const service = new ProjectMembershipsService(prisma, makeAudit());

    await expect(
      service.setOverride(ADMIN_ID, PROJECT_ID, ADMIN_ID, { role: Role.VIEWER }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.projectMembership.upsert).not.toHaveBeenCalled();
  });

  it('404s when the target user is not a member of the project’s workspace', async () => {
    const prisma = makePrisma();
    const service = new ProjectMembershipsService(prisma, makeAudit());

    await expect(
      service.setOverride(ADMIN_ID, PROJECT_ID, FOREIGN_ID, { role: Role.VIEWER }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProjectMembershipsService.clearOverride', () => {
  it('requires effective project ADMIN', async () => {
    const prisma = makePrisma({
      overrides: [{ id: 'pm-1', projectId: PROJECT_ID, userId: MEMBER_ID, role: Role.VIEWER }],
    });
    const service = new ProjectMembershipsService(prisma, makeAudit());

    await expect(
      service.clearOverride(OTHER_MEMBER_ID, PROJECT_ID, MEMBER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s when no override row exists for the target user', async () => {
    const prisma = makePrisma();
    const service = new ProjectMembershipsService(prisma, makeAudit());

    await expect(
      service.clearOverride(ADMIN_ID, PROJECT_ID, MEMBER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes the override and returns the reverted (inherited) effective role', async () => {
    const prisma = makePrisma({
      overrides: [{ id: 'pm-1', projectId: PROJECT_ID, userId: MEMBER_ID, role: Role.ADMIN }],
    });
    const audit = makeAudit();
    const service = new ProjectMembershipsService(prisma, audit);

    const result = await service.clearOverride(ADMIN_ID, PROJECT_ID, MEMBER_ID);

    expect(prisma.projectMembership.delete).toHaveBeenCalledWith({ where: { id: 'pm-1' } });
    expect(result.effectiveRole).toBe(Role.MEMBER);
    expect(result.isOverride).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project_membership.override_clear' }),
    );
  });
});

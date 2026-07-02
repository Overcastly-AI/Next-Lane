import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@next-lane/shared';
import { ComponentsService } from './components.service';
import type { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// DB-free unit tests for ComponentsService.
// Prisma and membership utils are mocked; no real DB needed.
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'ws-1';
const PROJECT_ID = 'proj-1';
const OTHER_PROJECT_ID = 'proj-2';
const COMPONENT_ID = 'comp-abc';
const USER_ADMIN = 'user-admin';
const USER_MEMBER = 'user-member';
const USER_VIEWER = 'user-viewer';
const USER_FOREIGN = 'user-foreign';
const ASSIGNEE_ID = 'user-assignee';

const baseComponent = {
  id: COMPONENT_ID,
  projectId: PROJECT_ID,
  name: 'Frontend',
  description: null,
  defaultAssigneeId: null,
  defaultAssignee: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const baseProject = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  workspace: { id: WORKSPACE_ID },
};

/**
 * Build a minimal Prisma mock that satisfies ComponentsService's usage.
 */
function makePrisma(opts: {
  componentProjectId?: string;
  userRole?: Role | null;
  assigneeMember?: boolean;
  prismaErrorCode?: string;
} = {}) {
  const componentProjectId = opts.componentProjectId ?? PROJECT_ID;
  const userRole = opts.userRole !== undefined ? opts.userRole : Role.ADMIN;
  const assigneeMember = opts.assigneeMember !== false;
  const prismaErrorCode = opts.prismaErrorCode;

  const prisma = {
    component: {
      findMany: jest.fn().mockResolvedValue([
        { ...baseComponent, projectId: componentProjectId },
      ]),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === COMPONENT_ID) {
          return Promise.resolve({ ...baseComponent, projectId: componentProjectId });
        }
        return Promise.resolve(null);
      }),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        if (prismaErrorCode) {
          const err = Object.assign(new Error('unique violation'), { code: prismaErrorCode });
          return Promise.reject(err);
        }
        return Promise.resolve({
          ...baseComponent,
          name: data.name ?? baseComponent.name,
          description: data.description ?? null,
          defaultAssigneeId: data.defaultAssigneeId ?? null,
          defaultAssignee: null,
        });
      }),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        if (prismaErrorCode) {
          const err = Object.assign(new Error('unique violation'), { code: prismaErrorCode });
          return Promise.reject(err);
        }
        return Promise.resolve({
          ...baseComponent,
          name: data.name ?? baseComponent.name,
          description: data.description ?? null,
          defaultAssigneeId: data.defaultAssigneeId ?? null,
          defaultAssignee: null,
        });
      }),
      delete: jest.fn().mockResolvedValue(baseComponent),
    },
    project: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === PROJECT_ID) {
          return Promise.resolve(baseProject);
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
          const { userId, workspaceId } = where.userId_workspaceId;
          // Assignee membership check
          if (userId === ASSIGNEE_ID) {
            return assigneeMember
              ? Promise.resolve({ role: Role.MEMBER })
              : Promise.resolve(null);
          }
          // Foreign user has no membership in any workspace
          if (userId === USER_FOREIGN) return Promise.resolve(null);
          // Other project's workspace
          if (workspaceId === 'ws-2') return Promise.resolve(null);

          if (userRole === null) return Promise.resolve(null);
          if (userId === USER_VIEWER) return Promise.resolve({ role: Role.VIEWER });
          if (userId === USER_MEMBER) return Promise.resolve({ role: Role.MEMBER });
          return Promise.resolve({ role: userRole });
        },
      ),
    },
    projectMembership: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };

  return prisma as unknown as PrismaService;
}

// ---------------------------------------------------------------------------
// findAll
// ---------------------------------------------------------------------------
describe('ComponentsService.findAll', () => {
  it('returns components for a project member', async () => {
    const service = new ComponentsService(makePrisma({ userRole: Role.MEMBER }));
    const result = await service.findAll(USER_MEMBER, PROJECT_ID);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(COMPONENT_ID);
    expect(result[0].name).toBe('Frontend');
  });

  it('returns components for a VIEWER', async () => {
    const service = new ComponentsService(makePrisma({ userRole: Role.VIEWER }));
    const result = await service.findAll(USER_VIEWER, PROJECT_ID);
    expect(result).toHaveLength(1);
  });

  it('rejects a non-member (ForbiddenException)', async () => {
    const service = new ComponentsService(makePrisma({ userRole: null }));
    await expect(service.findAll(USER_FOREIGN, PROJECT_ID)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------
describe('ComponentsService.create', () => {
  it('creates a component as ADMIN', async () => {
    const service = new ComponentsService(makePrisma({ userRole: Role.ADMIN }));
    const result = await service.create(USER_ADMIN, PROJECT_ID, { name: 'Backend' });
    expect(result.name).toBe('Backend');
    expect(result.projectId).toBe(PROJECT_ID);
    expect(result.defaultAssignee).toBeNull();
  });

  it('rejects MEMBER with ForbiddenException', async () => {
    const service = new ComponentsService(makePrisma({ userRole: Role.MEMBER }));
    await expect(
      service.create(USER_MEMBER, PROJECT_ID, { name: 'Backend' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects VIEWER with ForbiddenException', async () => {
    const service = new ComponentsService(makePrisma({ userRole: Role.VIEWER }));
    await expect(
      service.create(USER_VIEWER, PROJECT_ID, { name: 'Backend' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects duplicate name with ConflictException (P2002)', async () => {
    const service = new ComponentsService(
      makePrisma({ userRole: Role.ADMIN, prismaErrorCode: 'P2002' }),
    );
    await expect(
      service.create(USER_ADMIN, PROJECT_ID, { name: 'Frontend' }),
    ).rejects.toThrow(ConflictException);
  });

  it('accepts a valid defaultAssigneeId (workspace member)', async () => {
    const service = new ComponentsService(
      makePrisma({ userRole: Role.ADMIN, assigneeMember: true }),
    );
    const result = await service.create(USER_ADMIN, PROJECT_ID, {
      name: 'API',
      defaultAssigneeId: ASSIGNEE_ID,
    });
    expect(result).toBeDefined();
  });

  it('rejects defaultAssigneeId that is not in the workspace (BadRequestException)', async () => {
    const service = new ComponentsService(
      makePrisma({ userRole: Role.ADMIN, assigneeMember: false }),
    );
    await expect(
      service.create(USER_ADMIN, PROJECT_ID, {
        name: 'API',
        defaultAssigneeId: ASSIGNEE_ID,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts null defaultAssigneeId (clears the default)', async () => {
    const service = new ComponentsService(makePrisma({ userRole: Role.ADMIN }));
    const result = await service.create(USER_ADMIN, PROJECT_ID, {
      name: 'API',
      defaultAssigneeId: null,
    });
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------
describe('ComponentsService.update', () => {
  it('renames a component as ADMIN', async () => {
    const service = new ComponentsService(makePrisma({ userRole: Role.ADMIN }));
    const result = await service.update(USER_ADMIN, COMPONENT_ID, { name: 'Renamed' });
    expect(result.name).toBe('Renamed');
  });

  it('rejects MEMBER with ForbiddenException', async () => {
    const service = new ComponentsService(makePrisma({ userRole: Role.MEMBER }));
    await expect(
      service.update(USER_MEMBER, COMPONENT_ID, { name: 'X' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException for unknown component id', async () => {
    const service = new ComponentsService(makePrisma({ userRole: Role.ADMIN }));
    await expect(
      service.update(USER_ADMIN, 'does-not-exist', { name: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects duplicate name with ConflictException (P2002)', async () => {
    const service = new ComponentsService(
      makePrisma({ userRole: Role.ADMIN, prismaErrorCode: 'P2002' }),
    );
    await expect(
      service.update(USER_ADMIN, COMPONENT_ID, { name: 'Duplicate' }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects defaultAssigneeId not in workspace (BadRequestException)', async () => {
    const service = new ComponentsService(
      makePrisma({ userRole: Role.ADMIN, assigneeMember: false }),
    );
    await expect(
      service.update(USER_ADMIN, COMPONENT_ID, { defaultAssigneeId: ASSIGNEE_ID }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a foreign-project component (ForbiddenException) — tenant isolation', async () => {
    // Component belongs to OTHER_PROJECT_ID which is in ws-2; caller has no membership there.
    const service = new ComponentsService(
      makePrisma({ componentProjectId: OTHER_PROJECT_ID, userRole: Role.ADMIN }),
    );
    await expect(
      service.update(USER_ADMIN, COMPONENT_ID, { name: 'Hack' }),
    ).rejects.toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------
describe('ComponentsService.remove', () => {
  it('deletes a component as ADMIN', async () => {
    const service = new ComponentsService(makePrisma({ userRole: Role.ADMIN }));
    await expect(service.remove(USER_ADMIN, COMPONENT_ID)).resolves.toBeUndefined();
  });

  it('rejects MEMBER with ForbiddenException', async () => {
    const service = new ComponentsService(makePrisma({ userRole: Role.MEMBER }));
    await expect(service.remove(USER_MEMBER, COMPONENT_ID)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws NotFoundException for unknown component id', async () => {
    const service = new ComponentsService(makePrisma({ userRole: Role.ADMIN }));
    await expect(service.remove(USER_ADMIN, 'does-not-exist')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a foreign-project delete (ForbiddenException) — tenant isolation', async () => {
    const service = new ComponentsService(
      makePrisma({ componentProjectId: OTHER_PROJECT_ID, userRole: Role.ADMIN }),
    );
    await expect(service.remove(USER_ADMIN, COMPONENT_ID)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

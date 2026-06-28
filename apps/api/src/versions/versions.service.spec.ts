import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role, VersionState } from '@next-lane/shared';
import { VersionsService } from './versions.service';
import type { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// DB-free unit tests for VersionsService.
// Prisma and membership utils are mocked; no real DB needed.
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'ws-1';
const PROJECT_ID = 'proj-1';
const OTHER_PROJECT_ID = 'proj-2';
const VERSION_ID = 'ver-abc';
const ISSUE_ID = 'issue-1';
const USER_ADMIN = 'user-admin';
const USER_MEMBER = 'user-member';
const USER_VIEWER = 'user-viewer';
const USER_FOREIGN = 'user-foreign';

const baseVersion = {
  id: VERSION_ID,
  projectId: PROJECT_ID,
  name: 'v1.0.0',
  description: null,
  state: VersionState.UNRELEASED,
  releaseDate: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  _count: { issues: 0 },
};

const baseProject = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  workspace: { id: WORKSPACE_ID },
};

/**
 * Build a minimal Prisma mock that satisfies VersionsService's usage.
 */
function makePrisma(
  opts: {
    versionProjectId?: string;
    userRole?: Role | null;
    prismaErrorCode?: string;
    issueProjectId?: string;
    versionIds?: string[];
    versionProjectIds?: string[];
    issueExists?: boolean;
  } = {},
) {
  const versionProjectId = opts.versionProjectId ?? PROJECT_ID;
  const userRole = opts.userRole !== undefined ? opts.userRole : Role.ADMIN;
  const prismaErrorCode = opts.prismaErrorCode;
  const issueProjectId = opts.issueProjectId ?? PROJECT_ID;
  const issueExists = opts.issueExists !== false;
  // For setIssueVersions: IDs and matching projectIds
  const versionIds = opts.versionIds ?? [];
  const versionProjectIds = opts.versionProjectIds ?? [];

  const prisma = {
    version: {
      findMany: jest.fn().mockImplementation(
        (args: { where?: { id?: { in?: string[] }; projectId?: string } }) => {
          // Used by setIssueVersions cross-project validation
          if (args?.where?.id?.in) {
            const requestedIds = args.where.id.in;
            return Promise.resolve(
              requestedIds.map((id: string, idx: number) => ({
                id,
                projectId: versionProjectIds[idx] ?? PROJECT_ID,
              })),
            );
          }
          // Used by findAll
          return Promise.resolve([
            { ...baseVersion, projectId: versionProjectId },
          ]);
        },
      ),
      findUnique: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) => {
          if (where.id === VERSION_ID) {
            return Promise.resolve({
              ...baseVersion,
              projectId: versionProjectId,
            });
          }
          return Promise.resolve(null);
        }),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          if (prismaErrorCode) {
            const err = Object.assign(new Error('unique violation'), {
              code: prismaErrorCode,
            });
            return Promise.reject(err);
          }
          return Promise.resolve({
            ...baseVersion,
            name: data.name ?? baseVersion.name,
            description: data.description ?? null,
            releaseDate: data.releaseDate ?? null,
            _count: { issues: 0 },
          });
        }),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          if (prismaErrorCode) {
            const err = Object.assign(new Error('unique violation'), {
              code: prismaErrorCode,
            });
            return Promise.reject(err);
          }
          return Promise.resolve({
            ...baseVersion,
            name: data.name ?? baseVersion.name,
            description: data.description ?? null,
            state: data.state ?? baseVersion.state,
            releaseDate: data.releaseDate ?? null,
            _count: { issues: 0 },
          });
        }),
      delete: jest.fn().mockResolvedValue(baseVersion),
    },
    issue: {
      findUnique: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) => {
          if (!issueExists) return Promise.resolve(null);
          if (where.id === ISSUE_ID) {
            return Promise.resolve({
              id: ISSUE_ID,
              projectId: issueProjectId,
            });
          }
          return Promise.resolve(null);
        }),
    },
    issueVersion: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue(
        versionIds.map((id, idx) => ({
          version: {
            id,
            name: `v${idx + 1}.0.0`,
            state: VersionState.UNRELEASED,
          },
        })),
      ),
    },
    project: {
      findUnique: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) => {
          if (where.id === PROJECT_ID) {
            return Promise.resolve(baseProject);
          }
          if (where.id === OTHER_PROJECT_ID) {
            return Promise.resolve({
              id: OTHER_PROJECT_ID,
              workspaceId: 'ws-2',
              workspace: { id: 'ws-2' },
            });
          }
          return Promise.resolve(null);
        }),
    },
    membership: {
      findUnique: jest.fn().mockImplementation(
        ({
          where,
        }: {
          where: {
            userId_workspaceId: { userId: string; workspaceId: string };
          };
        }) => {
          const { userId, workspaceId } = where.userId_workspaceId;
          if (userId === USER_FOREIGN) return Promise.resolve(null);
          if (workspaceId === 'ws-2') return Promise.resolve(null);
          if (userRole === null) return Promise.resolve(null);
          if (userId === USER_VIEWER) return Promise.resolve({ role: Role.VIEWER });
          if (userId === USER_MEMBER) return Promise.resolve({ role: Role.MEMBER });
          return Promise.resolve({ role: userRole });
        },
      ),
    },
    $transaction: jest.fn().mockImplementation(async (ops: unknown[]) => {
      // Execute each operation in sequence (they are already promises or
      // functions returning promises). Return an array of results.
      const results: unknown[] = [];
      for (const op of ops) {
        results.push(typeof op === 'function' ? await op() : await op);
      }
      return results;
    }),
  };

  return prisma as unknown as PrismaService;
}

// ---------------------------------------------------------------------------
// findAll
// ---------------------------------------------------------------------------
describe('VersionsService.findAll', () => {
  it('returns versions for a project member', async () => {
    const service = new VersionsService(makePrisma({ userRole: Role.MEMBER }));
    const result = await service.findAll(USER_MEMBER, PROJECT_ID);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(VERSION_ID);
    expect(result[0].name).toBe('v1.0.0');
    expect(result[0].issueCount).toBe(0);
  });

  it('returns versions for a VIEWER', async () => {
    const service = new VersionsService(makePrisma({ userRole: Role.VIEWER }));
    const result = await service.findAll(USER_VIEWER, PROJECT_ID);
    expect(result).toHaveLength(1);
  });

  it('rejects a non-member (ForbiddenException)', async () => {
    const service = new VersionsService(makePrisma({ userRole: null }));
    await expect(service.findAll(USER_FOREIGN, PROJECT_ID)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------
describe('VersionsService.create', () => {
  it('creates a version as ADMIN', async () => {
    const service = new VersionsService(makePrisma({ userRole: Role.ADMIN }));
    const result = await service.create(USER_ADMIN, PROJECT_ID, {
      name: 'v2.0.0',
    });
    expect(result.name).toBe('v2.0.0');
    expect(result.projectId).toBe(PROJECT_ID);
    expect(result.state).toBe(VersionState.UNRELEASED);
    expect(result.releaseDate).toBeNull();
  });

  it('creates a version with description and releaseDate', async () => {
    const prisma = makePrisma({ userRole: Role.ADMIN });
    (prisma.version.create as jest.Mock).mockResolvedValueOnce({
      ...baseVersion,
      name: 'v1.1.0',
      description: 'Patch release',
      releaseDate: new Date('2026-09-01T00:00:00.000Z'),
      _count: { issues: 0 },
    });
    const service = new VersionsService(prisma);
    const result = await service.create(USER_ADMIN, PROJECT_ID, {
      name: 'v1.1.0',
      description: 'Patch release',
      releaseDate: '2026-09-01T00:00:00.000Z',
    });
    expect(result.description).toBe('Patch release');
    expect(result.releaseDate).toBe('2026-09-01T00:00:00.000Z');
  });

  it('rejects MEMBER with ForbiddenException', async () => {
    const service = new VersionsService(makePrisma({ userRole: Role.MEMBER }));
    await expect(
      service.create(USER_MEMBER, PROJECT_ID, { name: 'v2.0.0' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects VIEWER with ForbiddenException', async () => {
    const service = new VersionsService(makePrisma({ userRole: Role.VIEWER }));
    await expect(
      service.create(USER_VIEWER, PROJECT_ID, { name: 'v2.0.0' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects duplicate name with ConflictException (P2002)', async () => {
    const service = new VersionsService(
      makePrisma({ userRole: Role.ADMIN, prismaErrorCode: 'P2002' }),
    );
    await expect(
      service.create(USER_ADMIN, PROJECT_ID, { name: 'v1.0.0' }),
    ).rejects.toThrow(ConflictException);
  });

  it('re-throws non-P2002 Prisma errors', async () => {
    const service = new VersionsService(
      makePrisma({ userRole: Role.ADMIN, prismaErrorCode: 'P9999' }),
    );
    await expect(
      service.create(USER_ADMIN, PROJECT_ID, { name: 'v1.0.0' }),
    ).rejects.toThrow(Error);
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------
describe('VersionsService.update', () => {
  it('renames a version as ADMIN', async () => {
    const service = new VersionsService(makePrisma({ userRole: Role.ADMIN }));
    const result = await service.update(USER_ADMIN, VERSION_ID, {
      name: 'v1.0.1',
    });
    expect(result.name).toBe('v1.0.1');
  });

  it('rejects MEMBER with ForbiddenException', async () => {
    const service = new VersionsService(makePrisma({ userRole: Role.MEMBER }));
    await expect(
      service.update(USER_MEMBER, VERSION_ID, { name: 'v1.0.1' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException for unknown version id', async () => {
    const service = new VersionsService(makePrisma({ userRole: Role.ADMIN }));
    await expect(
      service.update(USER_ADMIN, 'does-not-exist', { name: 'v9.9.9' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects duplicate name with ConflictException (P2002)', async () => {
    const service = new VersionsService(
      makePrisma({ userRole: Role.ADMIN, prismaErrorCode: 'P2002' }),
    );
    await expect(
      service.update(USER_ADMIN, VERSION_ID, { name: 'v1.0.0-duplicate' }),
    ).rejects.toThrow(ConflictException);
  });

  it('transitions state to RELEASED', async () => {
    const prisma = makePrisma({ userRole: Role.ADMIN });
    (prisma.version.update as jest.Mock).mockResolvedValueOnce({
      ...baseVersion,
      state: VersionState.RELEASED,
      releaseDate: new Date('2026-06-28T00:00:00.000Z'),
      _count: { issues: 0 },
    });
    const service = new VersionsService(prisma);
    const result = await service.update(USER_ADMIN, VERSION_ID, {
      state: VersionState.RELEASED,
    });
    expect(result.state).toBe(VersionState.RELEASED);
  });

  it('auto-sets releaseDate to now when transitioning to RELEASED with no existing date', async () => {
    const prisma = makePrisma({ userRole: Role.ADMIN });
    const nowBefore = Date.now();
    const service = new VersionsService(prisma);
    await service.update(USER_ADMIN, VERSION_ID, {
      state: VersionState.RELEASED,
    });
    const nowAfter = Date.now();
    const call = (prisma.version.update as jest.Mock).mock.calls[0][0];
    const effectiveDate: Date = call.data.releaseDate;
    expect(effectiveDate).toBeInstanceOf(Date);
    expect(effectiveDate.getTime()).toBeGreaterThanOrEqual(nowBefore);
    expect(effectiveDate.getTime()).toBeLessThanOrEqual(nowAfter);
  });

  it('does NOT overwrite an existing releaseDate when transitioning to RELEASED', async () => {
    const prisma = makePrisma({ userRole: Role.ADMIN });
    const existingDate = new Date('2026-05-01T00:00:00.000Z');
    // Simulate an already-released version with a date set
    (prisma.version.findUnique as jest.Mock).mockResolvedValueOnce({
      ...baseVersion,
      state: VersionState.UNRELEASED,
      releaseDate: existingDate,
    });
    const service = new VersionsService(prisma);
    await service.update(USER_ADMIN, VERSION_ID, {
      state: VersionState.RELEASED,
    });
    const call = (prisma.version.update as jest.Mock).mock.calls[0][0];
    // effectiveReleaseDate should be undefined (no override) because existing
    // releaseDate is not null
    expect(call.data.releaseDate).toBeUndefined();
  });

  it('transitions state to ARCHIVED', async () => {
    const prisma = makePrisma({ userRole: Role.ADMIN });
    (prisma.version.update as jest.Mock).mockResolvedValueOnce({
      ...baseVersion,
      state: VersionState.ARCHIVED,
      _count: { issues: 0 },
    });
    const service = new VersionsService(prisma);
    const result = await service.update(USER_ADMIN, VERSION_ID, {
      state: VersionState.ARCHIVED,
    });
    expect(result.state).toBe(VersionState.ARCHIVED);
  });

  it('rejects a foreign-project version (ForbiddenException) — tenant isolation', async () => {
    const service = new VersionsService(
      makePrisma({ versionProjectId: OTHER_PROJECT_ID, userRole: Role.ADMIN }),
    );
    await expect(
      service.update(USER_ADMIN, VERSION_ID, { name: 'Hack' }),
    ).rejects.toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------
describe('VersionsService.remove', () => {
  it('deletes a version as ADMIN', async () => {
    const service = new VersionsService(makePrisma({ userRole: Role.ADMIN }));
    await expect(
      service.remove(USER_ADMIN, VERSION_ID),
    ).resolves.toBeUndefined();
  });

  it('rejects MEMBER with ForbiddenException', async () => {
    const service = new VersionsService(makePrisma({ userRole: Role.MEMBER }));
    await expect(service.remove(USER_MEMBER, VERSION_ID)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws NotFoundException for unknown version id', async () => {
    const service = new VersionsService(makePrisma({ userRole: Role.ADMIN }));
    await expect(service.remove(USER_ADMIN, 'does-not-exist')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a foreign-project delete (ForbiddenException) — tenant isolation', async () => {
    const service = new VersionsService(
      makePrisma({ versionProjectId: OTHER_PROJECT_ID, userRole: Role.ADMIN }),
    );
    await expect(service.remove(USER_ADMIN, VERSION_ID)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

// ---------------------------------------------------------------------------
// setIssueVersions
// ---------------------------------------------------------------------------
describe('VersionsService.setIssueVersions', () => {
  it('sets an empty version list (removes all versions)', async () => {
    const service = new VersionsService(makePrisma({ userRole: Role.MEMBER }));
    const result = await service.setIssueVersions(USER_MEMBER, ISSUE_ID, []);
    expect(result).toEqual([]);
  });

  it('sets a list of valid version IDs belonging to the same project', async () => {
    const prisma = makePrisma({
      userRole: Role.MEMBER,
      versionIds: [VERSION_ID],
      versionProjectIds: [PROJECT_ID],
    });
    const service = new VersionsService(prisma);
    const result = await service.setIssueVersions(USER_MEMBER, ISSUE_ID, [
      VERSION_ID,
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(VERSION_ID);
  });

  it('rejects version IDs that belong to a different project (400)', async () => {
    const prisma = makePrisma({
      userRole: Role.MEMBER,
      versionIds: [VERSION_ID],
      versionProjectIds: [OTHER_PROJECT_ID], // wrong project
    });
    const service = new VersionsService(prisma);
    await expect(
      service.setIssueVersions(USER_MEMBER, ISSUE_ID, [VERSION_ID]),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects non-existent version IDs (400)', async () => {
    const prisma = makePrisma({
      userRole: Role.MEMBER,
      versionIds: [],
      versionProjectIds: [],
    });
    // Override findMany to return 0 rows regardless of input (version doesn't exist)
    (prisma.version.findMany as jest.Mock).mockResolvedValueOnce([]);
    const service = new VersionsService(prisma);
    await expect(
      service.setIssueVersions(USER_MEMBER, ISSUE_ID, ['non-existent-ver']),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when issue does not exist', async () => {
    const service = new VersionsService(
      makePrisma({ userRole: Role.MEMBER, issueExists: false }),
    );
    await expect(
      service.setIssueVersions(USER_MEMBER, 'missing-issue', []),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a VIEWER caller with ForbiddenException', async () => {
    const service = new VersionsService(makePrisma({ userRole: Role.VIEWER }));
    await expect(
      service.setIssueVersions(USER_VIEWER, ISSUE_ID, []),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a foreign user with ForbiddenException', async () => {
    const service = new VersionsService(makePrisma({ userRole: null }));
    await expect(
      service.setIssueVersions(USER_FOREIGN, ISSUE_ID, []),
    ).rejects.toThrow(ForbiddenException);
  });
});

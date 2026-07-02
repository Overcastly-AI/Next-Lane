import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { StatusCategory, Role } from '@next-lane/shared';
import { StatusesService } from './statuses.service';
import type { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// DB-free unit tests for StatusesService — focusing on create/update/remove
// and the new wipLimit field. Prisma and membership helpers are mocked.
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const STATUS_ID = 'status-abc';
const USER_ID = 'user-owner';

/** Build a minimal Prisma mock that satisfies StatusesService usage. */
type StatusRow = {
  id: string;
  name: string;
  category: string;
  order: number;
  wipLimit: number | null;
  projectId: string;
  createdAt: Date;
  updatedAt: Date;
};

function makePrisma(opts: {
  existingStatus?: StatusRow | null;
  userRole?: Role;
  issueCount?: number;
  /**
   * Sibling statuses already in the project, used to answer the
   * duplicate-name `findFirst` check (SETTINGS-3). Defaults to just
   * `existingStatus` (its "To Do" name) when omitted, matching every
   * pre-existing test's expectation of no collision.
   */
  siblingStatuses?: StatusRow[];
} = {}) {
  const role = opts.userRole !== undefined ? opts.userRole : Role.MEMBER;
  const issueCount = opts.issueCount ?? 0;

  const defaultStatus = {
    id: STATUS_ID,
    name: 'To Do',
    category: 'TODO',
    order: 0,
    wipLimit: null,
    projectId: PROJECT_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const existingStatus =
    opts.existingStatus !== undefined ? opts.existingStatus : defaultStatus;

  const siblingStatuses =
    opts.siblingStatuses ?? (existingStatus ? [existingStatus] : []);

  const prisma = {
    status: {
      findMany: jest.fn().mockResolvedValue(existingStatus ? [existingStatus] : []),
      findFirst: jest.fn().mockImplementation(
        ({
          where,
        }: {
          where: {
            projectId: string;
            name?: { equals: string; mode: string };
            id?: { not: string };
          };
        }) => {
          if (where.name) {
            // Duplicate-name check (SETTINGS-3): case-insensitive match
            // against sibling statuses, excluding the row being updated.
            const match = siblingStatuses.find(
              (s) =>
                s.projectId === where.projectId &&
                s.name.toLowerCase() === where.name!.equals.toLowerCase() &&
                s.id !== where.id?.not,
            );
            return Promise.resolve(match ?? null);
          }
          // Order-lookup: "last" status in the project (order desc).
          return Promise.resolve(existingStatus);
        },
      ),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === STATUS_ID ? existingStatus : null),
      ),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'status-new',
          name: data['name'],
          category: data['category'],
          order: data['order'] ?? 0,
          wipLimit: data['wipLimit'] ?? null,
          projectId: data['projectId'],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      update: jest.fn().mockImplementation(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const base = existingStatus ?? defaultStatus;
          return Promise.resolve({
            ...base,
            id: where.id,
            ...(data['name'] !== undefined ? { name: data['name'] } : {}),
            ...(data['category'] !== undefined ? { category: data['category'] } : {}),
            ...(data['order'] !== undefined ? { order: data['order'] } : {}),
            ...(data['wipLimit'] !== undefined ? { wipLimit: data['wipLimit'] } : {}),
          });
        },
      ),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    issue: {
      count: jest.fn().mockResolvedValue(issueCount),
    },
    project: {
      findUnique: jest.fn().mockResolvedValue({
        id: PROJECT_ID,
        workspaceId: 'ws-1',
        workspace: { id: 'ws-1' },
      }),
    },
    membership: {
      findUnique: jest.fn().mockResolvedValue({ role }),
    },
  };

  return prisma as unknown as PrismaService;
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('StatusesService.create', () => {
  it('creates a status with no wipLimit (null by default)', async () => {
    const service = new StatusesService(makePrisma());
    const result = await service.create(USER_ID, PROJECT_ID, {
      name: 'In Progress',
      category: StatusCategory.IN_PROGRESS,
    });
    expect(result.wipLimit).toBeNull();
    expect(result.name).toBe('In Progress');
  });

  it('creates a status with a positive wipLimit', async () => {
    const service = new StatusesService(makePrisma());
    const result = await service.create(USER_ID, PROJECT_ID, {
      name: 'Review',
      category: StatusCategory.IN_PROGRESS,
      wipLimit: 3,
    });
    expect(result.wipLimit).toBe(3);
  });

  it('creates a status with wipLimit explicitly null (no limit)', async () => {
    const service = new StatusesService(makePrisma());
    const result = await service.create(USER_ID, PROJECT_ID, {
      name: 'Done',
      category: StatusCategory.DONE,
      wipLimit: null,
    });
    expect(result.wipLimit).toBeNull();
  });

  it('passes wipLimit to prisma.status.create', async () => {
    const prisma = makePrisma();
    const service = new StatusesService(prisma);
    await service.create(USER_ID, PROJECT_ID, {
      name: 'QA',
      category: StatusCategory.IN_PROGRESS,
      wipLimit: 5,
    });
    const createCall = (prisma.status.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.wipLimit).toBe(5);
  });

  // -- SETTINGS-3: case-insensitive duplicate column name guard -------------

  it('rejects (409) creating a column whose name already exists in the project (exact case)', async () => {
    const service = new StatusesService(makePrisma());
    await expect(
      service.create(USER_ID, PROJECT_ID, {
        name: 'To Do',
        category: StatusCategory.TODO,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects (409) creating a column whose name matches an existing one case-insensitively', async () => {
    const service = new StatusesService(makePrisma());
    await expect(
      service.create(USER_ID, PROJECT_ID, {
        name: 'to do',
        category: StatusCategory.TODO,
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it('does not create the column when the name is a duplicate', async () => {
    const prisma = makePrisma();
    const service = new StatusesService(prisma);
    await expect(
      service.create(USER_ID, PROJECT_ID, {
        name: 'TO DO',
        category: StatusCategory.TODO,
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.status.create).not.toHaveBeenCalled();
  });

  it('allows creating a column with a distinct name', async () => {
    const service = new StatusesService(makePrisma());
    const result = await service.create(USER_ID, PROJECT_ID, {
      name: 'Blocked',
      category: StatusCategory.IN_PROGRESS,
    });
    expect(result.name).toBe('Blocked');
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('StatusesService.update', () => {
  it('updates wipLimit to a new positive value', async () => {
    const service = new StatusesService(makePrisma());
    const result = await service.update(USER_ID, STATUS_ID, { wipLimit: 10 });
    expect(result.wipLimit).toBe(10);
  });

  it('clears wipLimit by passing null', async () => {
    const prisma = makePrisma({
      existingStatus: {
        id: STATUS_ID,
        name: 'To Do',
        category: 'TODO',
        order: 0,
        wipLimit: 5,
        projectId: PROJECT_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const service = new StatusesService(prisma);
    const result = await service.update(USER_ID, STATUS_ID, { wipLimit: null });
    expect(result.wipLimit).toBeNull();
  });

  it('does not touch wipLimit when not supplied in the patch', async () => {
    const prisma = makePrisma({
      existingStatus: {
        id: STATUS_ID,
        name: 'To Do',
        category: 'TODO',
        order: 0,
        wipLimit: 7,
        projectId: PROJECT_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const service = new StatusesService(prisma);
    // Patch only the name, leave wipLimit unset in dto.
    const result = await service.update(USER_ID, STATUS_ID, { name: 'New Name' });
    // wipLimit should be unchanged (mock returns existing value).
    expect(result.wipLimit).toBe(7);
    // Confirm wipLimit was NOT included in the prisma.update call data.
    const updateCall = (prisma.status.update as jest.Mock).mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty('wipLimit');
  });

  it('throws NotFoundException for an unknown status id', async () => {
    const service = new StatusesService(makePrisma());
    await expect(
      service.update(USER_ID, 'does-not-exist', { name: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });

  // -- SETTINGS-3: duplicate-name guard on rename ----------------------------

  it('rejects (409) renaming a column to match a DIFFERENT sibling column (case-insensitive)', async () => {
    const inProgress = {
      id: STATUS_ID,
      name: 'In Progress',
      category: 'IN_PROGRESS',
      order: 1,
      wipLimit: null,
      projectId: PROJECT_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const toDo = {
      id: 'status-todo',
      name: 'To Do',
      category: 'TODO',
      order: 0,
      wipLimit: null,
      projectId: PROJECT_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const service = new StatusesService(
      makePrisma({ existingStatus: inProgress, siblingStatuses: [inProgress, toDo] }),
    );
    await expect(
      service.update(USER_ID, STATUS_ID, { name: 'to do' }),
    ).rejects.toThrow(ConflictException);
  });

  it('allows renaming a column to its OWN existing name (excludes itself from the duplicate check)', async () => {
    const service = new StatusesService(makePrisma());
    const result = await service.update(USER_ID, STATUS_ID, { name: 'To Do' });
    expect(result.name).toBe('To Do');
  });

  it('allows renaming a column to an unused name', async () => {
    const service = new StatusesService(makePrisma());
    const result = await service.update(USER_ID, STATUS_ID, { name: 'Blocked' });
    expect(result.name).toBe('Blocked');
  });
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

describe('StatusesService.remove', () => {
  it('removes a status that has no issues', async () => {
    const service = new StatusesService(makePrisma({ userRole: Role.ADMIN, issueCount: 0 }));
    const result = await service.remove(USER_ID, STATUS_ID);
    expect(result.id).toBe(STATUS_ID);
  });

  it('rejects removal of a status that still has issues', async () => {
    const service = new StatusesService(makePrisma({ userRole: Role.ADMIN, issueCount: 2 }));
    await expect(service.remove(USER_ID, STATUS_ID)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws NotFoundException for an unknown status id', async () => {
    const service = new StatusesService(makePrisma({ userRole: Role.ADMIN, existingStatus: null }));
    await expect(service.remove(USER_ID, 'does-not-exist')).rejects.toThrow(
      NotFoundException,
    );
  });
});

// ---------------------------------------------------------------------------
// toStatusDto (unit — wipLimit mapping)
// ---------------------------------------------------------------------------

describe('toStatusDto', () => {
  // Import the exported helper directly.
  const { toStatusDto } = require('./statuses.service');

  it('maps wipLimit when present', () => {
    const row = {
      id: 's1',
      name: 'Doing',
      category: 'IN_PROGRESS',
      order: 1,
      wipLimit: 4,
      projectId: 'p1',
    };
    expect(toStatusDto(row).wipLimit).toBe(4);
  });

  it('maps wipLimit null when null', () => {
    const row = {
      id: 's1',
      name: 'Doing',
      category: 'IN_PROGRESS',
      order: 1,
      wipLimit: null,
      projectId: 'p1',
    };
    expect(toStatusDto(row).wipLimit).toBeNull();
  });

  it('defaults wipLimit to null when field absent from row', () => {
    const row = {
      id: 's1',
      name: 'Doing',
      category: 'IN_PROGRESS',
      order: 1,
      projectId: 'p1',
    };
    expect(toStatusDto(row).wipLimit).toBeNull();
  });
});

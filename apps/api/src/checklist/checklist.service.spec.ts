import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@next-lane/shared';
import { ChecklistService } from './checklist.service';
import type { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// DB-free unit tests for ChecklistService.
// Prisma and membership utils are fully mocked — no real DB needed.
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'ws-1';
const PROJECT_ID = 'proj-1';
const OTHER_PROJECT_ID = 'proj-2';
const ISSUE_ID = 'issue-abc';
const OTHER_ISSUE_ID = 'issue-xyz';
const ITEM_ID = 'item-1';
const ITEM_ID_2 = 'item-2';
const USER_ADMIN = 'user-admin';
const USER_MEMBER = 'user-member';
const USER_VIEWER = 'user-viewer';
const USER_FOREIGN = 'user-foreign';

const baseItem = {
  id: ITEM_ID,
  issueId: ISSUE_ID,
  text: 'Write tests',
  done: false,
  order: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const baseItem2 = {
  id: ITEM_ID_2,
  issueId: ISSUE_ID,
  text: 'Deploy to prod',
  done: true,
  order: 1,
  createdAt: new Date('2026-01-01T00:01:00.000Z'),
  updatedAt: new Date('2026-01-01T00:01:00.000Z'),
};

/**
 * Build a minimal Prisma mock satisfying ChecklistService's usage.
 *
 * @param opts.itemProjectId  — which project the item's issue belongs to
 * @param opts.issueProjectId — which project findFirst(issue) belongs to
 * @param opts.userRole       — role returned for membership lookup (null = no membership)
 * @param opts.maxOrder       — current max order value in aggregate
 */
function makePrisma(
  opts: {
    itemProjectId?: string;
    issueProjectId?: string;
    userRole?: Role | null;
    maxOrder?: number | null;
  } = {},
) {
  const itemProjectId = opts.itemProjectId ?? PROJECT_ID;
  const issueProjectId = opts.issueProjectId ?? PROJECT_ID;
  const userRole = opts.userRole !== undefined ? opts.userRole : Role.MEMBER;
  const maxOrder = opts.maxOrder !== undefined ? opts.maxOrder : null;

  const prisma = {
    issue: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === ISSUE_ID) return Promise.resolve({ id: ISSUE_ID, projectId: issueProjectId });
        return Promise.resolve(null);
      }),
    },
    checklistItem: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === ITEM_ID) {
          return Promise.resolve({
            ...baseItem,
            issue: { projectId: itemProjectId },
          });
        }
        if (where.id === ITEM_ID_2) {
          return Promise.resolve({
            ...baseItem2,
            issue: { projectId: itemProjectId },
          });
        }
        return Promise.resolve(null);
      }),
      findMany: jest.fn().mockResolvedValue([baseItem, baseItem2]),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...baseItem,
          text: data.text ?? baseItem.text,
          order: data.order ?? baseItem.order,
        }),
      ),
      update: jest.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const base = where.id === ITEM_ID ? baseItem : baseItem2;
        return Promise.resolve({ ...base, ...data });
      }),
      delete: jest.fn().mockResolvedValue(baseItem),
      aggregate: jest.fn().mockResolvedValue({ _max: { order: maxOrder } }),
      count: jest.fn().mockResolvedValue(2),
    },
    project: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === PROJECT_ID) {
          return Promise.resolve({ id: PROJECT_ID, workspaceId: WORKSPACE_ID, workspace: { id: WORKSPACE_ID } });
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
          if (userId === USER_FOREIGN) return Promise.resolve(null);
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
describe('ChecklistService.findAll', () => {
  it('returns items ordered by order for a project member', async () => {
    const service = new ChecklistService(makePrisma({ userRole: Role.MEMBER }));
    const result = await service.findAll(USER_MEMBER, ISSUE_ID);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(ITEM_ID);
    expect(result[1].id).toBe(ITEM_ID_2);
  });

  it('rejects a non-member with ForbiddenException', async () => {
    const service = new ChecklistService(makePrisma({ userRole: null }));
    await expect(service.findAll(USER_FOREIGN, ISSUE_ID)).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException for unknown issue', async () => {
    const service = new ChecklistService(makePrisma());
    await expect(service.findAll(USER_MEMBER, 'no-such-issue')).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------
describe('ChecklistService.create', () => {
  it('creates an item with order = max+1 (first item, max=null → order=0)', async () => {
    const service = new ChecklistService(makePrisma({ userRole: Role.MEMBER, maxOrder: null }));
    const result = await service.create(USER_MEMBER, ISSUE_ID, { text: 'Do something' });
    expect(result.text).toBe('Do something');
    expect(result.order).toBe(0);
  });

  it('creates an item with order = max+1 (max=3 → order=4)', async () => {
    const prisma = makePrisma({ userRole: Role.MEMBER, maxOrder: 3 });
    const service = new ChecklistService(prisma);
    await service.create(USER_MEMBER, ISSUE_ID, { text: 'Next task' });
    // The create mock returns baseItem.order, but we verify aggregate was called
    expect(prisma.checklistItem.aggregate).toHaveBeenCalledWith({
      where: { issueId: ISSUE_ID },
      _max: { order: true },
    });
    expect(prisma.checklistItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ order: 4 }) }),
    );
  });

  it('rejects VIEWER with ForbiddenException', async () => {
    const service = new ChecklistService(makePrisma({ userRole: Role.VIEWER }));
    await expect(service.create(USER_VIEWER, ISSUE_ID, { text: 'x' })).rejects.toThrow(ForbiddenException);
  });

  it('rejects non-member with ForbiddenException', async () => {
    const service = new ChecklistService(makePrisma({ userRole: null }));
    await expect(service.create(USER_FOREIGN, ISSUE_ID, { text: 'x' })).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException for unknown issue', async () => {
    const service = new ChecklistService(makePrisma());
    await expect(service.create(USER_MEMBER, 'no-issue', { text: 'x' })).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------
describe('ChecklistService.update', () => {
  it('edits text of an item as MEMBER', async () => {
    const service = new ChecklistService(makePrisma({ userRole: Role.MEMBER }));
    const result = await service.update(USER_MEMBER, ITEM_ID, { text: 'Updated text' });
    expect(result.text).toBe('Updated text');
  });

  it('toggles done to true', async () => {
    const service = new ChecklistService(makePrisma({ userRole: Role.MEMBER }));
    const result = await service.update(USER_MEMBER, ITEM_ID, { done: true });
    expect(result.done).toBe(true);
  });

  it('sets a new order value', async () => {
    const service = new ChecklistService(makePrisma({ userRole: Role.MEMBER }));
    const result = await service.update(USER_MEMBER, ITEM_ID, { order: 5 });
    expect(result.order).toBe(5);
  });

  it('rejects VIEWER with ForbiddenException', async () => {
    const service = new ChecklistService(makePrisma({ userRole: Role.VIEWER }));
    await expect(service.update(USER_VIEWER, ITEM_ID, { text: 'x' })).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException for unknown item', async () => {
    const service = new ChecklistService(makePrisma());
    await expect(service.update(USER_MEMBER, 'no-item', { text: 'x' })).rejects.toThrow(NotFoundException);
  });

  it('rejects tenant isolation — item belongs to another project (ForbiddenException)', async () => {
    // item is in OTHER_PROJECT_ID (ws-2), caller has no membership there
    const service = new ChecklistService(makePrisma({ itemProjectId: OTHER_PROJECT_ID }));
    await expect(service.update(USER_MEMBER, ITEM_ID, { text: 'hack' })).rejects.toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------
describe('ChecklistService.remove', () => {
  it('deletes an item as MEMBER', async () => {
    const service = new ChecklistService(makePrisma({ userRole: Role.MEMBER }));
    await expect(service.remove(USER_MEMBER, ITEM_ID)).resolves.toBeUndefined();
  });

  it('rejects VIEWER with ForbiddenException', async () => {
    const service = new ChecklistService(makePrisma({ userRole: Role.VIEWER }));
    await expect(service.remove(USER_VIEWER, ITEM_ID)).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException for unknown item', async () => {
    const service = new ChecklistService(makePrisma());
    await expect(service.remove(USER_MEMBER, 'no-item')).rejects.toThrow(NotFoundException);
  });

  it('rejects tenant isolation — item belongs to another project (ForbiddenException)', async () => {
    const service = new ChecklistService(makePrisma({ itemProjectId: OTHER_PROJECT_ID }));
    await expect(service.remove(USER_MEMBER, ITEM_ID)).rejects.toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// reorder
// ---------------------------------------------------------------------------
describe('ChecklistService.reorder', () => {
  it('reorders items and returns them in new order', async () => {
    const prisma = makePrisma({ userRole: Role.MEMBER });
    const service = new ChecklistService(prisma);
    const result = await service.reorder(USER_MEMBER, ISSUE_ID, [ITEM_ID_2, ITEM_ID]);
    // Should call update for each item with its new index
    expect(prisma.checklistItem.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID_2 },
      data: { order: 0 },
    });
    expect(prisma.checklistItem.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: { order: 1 },
    });
    // Returns the final sorted list
    expect(result).toHaveLength(2);
  });

  it('rejects VIEWER with ForbiddenException', async () => {
    const service = new ChecklistService(makePrisma({ userRole: Role.VIEWER }));
    await expect(service.reorder(USER_VIEWER, ISSUE_ID, [ITEM_ID])).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when an itemId is not on the issue', async () => {
    const service = new ChecklistService(makePrisma());
    await expect(
      service.reorder(USER_MEMBER, ISSUE_ID, ['foreign-item-id']),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for unknown issue', async () => {
    const service = new ChecklistService(makePrisma());
    await expect(service.reorder(USER_MEMBER, 'no-issue', [ITEM_ID])).rejects.toThrow(NotFoundException);
  });
});

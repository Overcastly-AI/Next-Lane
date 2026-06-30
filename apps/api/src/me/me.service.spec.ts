import { MeService } from './me.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * DB-free unit tests for MeService. Prisma is mocked so we can assert:
 *  - results are scoped to the caller's workspaces (no cross-tenant leak),
 *  - both the assigned and reported queries filter by the caller's id,
 *  - the DTO shape (key, sprint, status) is correct,
 *  - no memberships short-circuits to empty results without querying issues.
 */

function makePrisma() {
  return {
    membership: { findMany: jest.fn() },
    issue: { findMany: jest.fn() },
    quickLink: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  } as unknown as PrismaService & {
    membership: { findMany: jest.Mock };
    issue: { findMany: jest.Mock };
    quickLink: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

const assignedRow = {
  id: 'issue-1',
  number: 12,
  title: 'Fix the login bug',
  type: 'BUG',
  priority: 'HIGH',
  projectId: 'proj-1',
  statusId: 'status-1',
  dueDate: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-06-01T00:00:00.000Z'),
  project: { key: 'NL' },
  status: { name: 'In Progress', category: 'IN_PROGRESS' },
  sprint: { name: 'Sprint 1', state: 'ACTIVE' },
};

const reportedRow = {
  id: 'issue-2',
  number: 7,
  title: 'Add burndown chart',
  type: 'TASK',
  priority: 'LOW',
  projectId: 'proj-1',
  statusId: 'status-2',
  dueDate: null,
  updatedAt: new Date('2026-05-01T00:00:00.000Z'),
  project: { key: 'NL' },
  status: { name: 'To Do', category: 'TODO' },
  sprint: null,
};

describe('MeService.getMyWork', () => {
  let prisma: MockPrisma;
  let service: MeService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new MeService(prisma);
  });

  it('scopes both queries to the caller workspaces and id (no cross-tenant leak)', async () => {
    prisma.membership.findMany.mockResolvedValue([
      { workspaceId: 'ws-1' },
      { workspaceId: 'ws-2' },
    ]);
    prisma.issue.findMany
      .mockResolvedValueOnce([assignedRow]) // assigned
      .mockResolvedValueOnce([reportedRow]); // reported

    const result = await service.getMyWork('user-1');

    // Both queries are constrained to the caller's workspaces.
    const assignedWhere = prisma.issue.findMany.mock.calls[0][0].where;
    const reportedWhere = prisma.issue.findMany.mock.calls[1][0].where;
    expect(assignedWhere.project.workspaceId).toEqual({ in: ['ws-1', 'ws-2'] });
    expect(reportedWhere.project.workspaceId).toEqual({ in: ['ws-1', 'ws-2'] });

    // And by the caller's relationship to each issue.
    expect(assignedWhere.assigneeId).toBe('user-1');
    expect(reportedWhere.reporterId).toBe('user-1');

    // Result cap is applied.
    expect(prisma.issue.findMany.mock.calls[0][0].take).toBe(100);

    expect(result).toEqual({
      assigned: [
        {
          id: 'issue-1',
          key: 'NL-12',
          number: 12,
          title: 'Fix the login bug',
          type: 'BUG',
          priority: 'HIGH',
          projectId: 'proj-1',
          projectKey: 'NL',
          statusId: 'status-1',
          statusName: 'In Progress',
          statusCategory: 'IN_PROGRESS',
          sprintName: 'Sprint 1',
          sprintState: 'ACTIVE',
          dueDate: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
      reported: [
        {
          id: 'issue-2',
          key: 'NL-7',
          number: 7,
          title: 'Add burndown chart',
          type: 'TASK',
          priority: 'LOW',
          projectId: 'proj-1',
          projectKey: 'NL',
          statusId: 'status-2',
          statusName: 'To Do',
          statusCategory: 'TODO',
          sprintName: null,
          sprintState: null,
          dueDate: null,
          updatedAt: '2026-05-01T00:00:00.000Z',
        },
      ],
    });
  });

  it('returns empty groups when the caller has no memberships (no leak)', async () => {
    prisma.membership.findMany.mockResolvedValue([]);

    const result = await service.getMyWork('user-1');

    expect(result).toEqual({ assigned: [], reported: [] });
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });
});

describe('MeService quick links', () => {
  let prisma: MockPrisma;
  let service: MeService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new MeService(prisma);
  });

  const linkRow = {
    id: 'ql-1',
    userId: 'user-1',
    label: 'Grafana',
    url: 'https://grafana.example.com',
    order: 0,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-02T00:00:00.000Z'),
  };

  it('lists only the caller links, ordered, mapped to the DTO shape', async () => {
    prisma.quickLink.findMany.mockResolvedValue([linkRow]);

    const result = await service.listQuickLinks('user-1');

    expect(prisma.quickLink.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    expect(result).toEqual([
      {
        id: 'ql-1',
        label: 'Grafana',
        url: 'https://grafana.example.com',
        order: 0,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z',
      },
    ]);
  });

  it('appends a new link after the caller existing max order', async () => {
    prisma.quickLink.findFirst.mockResolvedValue({ order: 4 });
    prisma.quickLink.create.mockResolvedValue({ ...linkRow, order: 5 });

    await service.createQuickLink('user-1', {
      label: 'Docs',
      url: 'https://docs.example.com',
    });

    expect(prisma.quickLink.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        label: 'Docs',
        url: 'https://docs.example.com',
        order: 5,
      },
    });
  });

  it('starts ordering at 0 when the caller has no links yet', async () => {
    prisma.quickLink.findFirst.mockResolvedValue(null);
    prisma.quickLink.create.mockResolvedValue(linkRow);

    await service.createQuickLink('user-1', {
      label: 'Grafana',
      url: 'https://grafana.example.com',
    });

    expect(prisma.quickLink.create.mock.calls[0][0].data.order).toBe(0);
  });

  it('updates a link owned by the caller', async () => {
    prisma.quickLink.findUnique.mockResolvedValue({ userId: 'user-1' });
    prisma.quickLink.update.mockResolvedValue({ ...linkRow, label: 'Renamed' });

    await service.updateQuickLink('user-1', 'ql-1', { label: 'Renamed' });

    expect(prisma.quickLink.update).toHaveBeenCalledWith({
      where: { id: 'ql-1' },
      data: { label: 'Renamed' },
    });
  });

  it('refuses to update a link owned by another user (no cross-user leak)', async () => {
    prisma.quickLink.findUnique.mockResolvedValue({ userId: 'someone-else' });

    await expect(
      service.updateQuickLink('user-1', 'ql-1', { label: 'Hacked' }),
    ).rejects.toThrow('Quick link not found');
    expect(prisma.quickLink.update).not.toHaveBeenCalled();
  });

  it('refuses to delete a link owned by another user', async () => {
    prisma.quickLink.findUnique.mockResolvedValue({ userId: 'someone-else' });

    await expect(service.deleteQuickLink('user-1', 'ql-1')).rejects.toThrow(
      'Quick link not found',
    );
    expect(prisma.quickLink.delete).not.toHaveBeenCalled();
  });

  it('deletes a link owned by the caller', async () => {
    prisma.quickLink.findUnique.mockResolvedValue({ userId: 'user-1' });
    prisma.quickLink.delete.mockResolvedValue(linkRow);

    const result = await service.deleteQuickLink('user-1', 'ql-1');

    expect(prisma.quickLink.delete).toHaveBeenCalledWith({
      where: { id: 'ql-1' },
    });
    expect(result).toEqual({ id: 'ql-1' });
  });
});

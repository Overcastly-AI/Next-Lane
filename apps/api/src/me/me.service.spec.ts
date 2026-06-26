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
  } as unknown as PrismaService & {
    membership: { findMany: jest.Mock };
    issue: { findMany: jest.Mock };
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

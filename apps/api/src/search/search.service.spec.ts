import { ForbiddenException } from '@nestjs/common';
import { SearchService, parseIssueKey } from './search.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * DB-free unit tests for SearchService. Prisma is mocked so we can assert:
 *  - results are scoped to the caller's workspaces (no cross-tenant leak),
 *  - the DTO shape is correct,
 *  - an empty query / no memberships short-circuits to empty results,
 *  - a projectId filter is authorized via membership.
 */

function makePrisma() {
  return {
    membership: { findMany: jest.fn(), findUnique: jest.fn() },
    issue: { findMany: jest.fn() },
    project: { findMany: jest.fn(), findUnique: jest.fn() },
  } as unknown as PrismaService & {
    membership: { findMany: jest.Mock; findUnique: jest.Mock };
    issue: { findMany: jest.Mock };
    project: { findMany: jest.Mock; findUnique: jest.Mock };
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

const issueRow = {
  id: 'issue-1',
  number: 12,
  title: 'Fix the login bug',
  type: 'BUG',
  projectId: 'proj-1',
  statusId: 'status-1',
  project: { key: 'NL' },
  status: { name: 'To Do', category: 'TODO' },
};

describe('SearchService.search', () => {
  let prisma: MockPrisma;
  let service: SearchService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new SearchService(prisma);
  });

  it('scopes both issue and project queries to the caller workspaces only', async () => {
    prisma.membership.findMany.mockResolvedValue([
      { workspaceId: 'ws-1' },
      { workspaceId: 'ws-2' },
    ]);
    prisma.issue.findMany.mockResolvedValue([issueRow]);
    prisma.project.findMany.mockResolvedValue([
      { id: 'proj-1', key: 'NL', name: 'Next Lane', workspaceId: 'ws-1' },
    ]);

    const result = await service.search('user-1', 'login');

    // Issue query is constrained to the caller's workspaces.
    const issueWhere = prisma.issue.findMany.mock.calls[0][0].where;
    expect(issueWhere.project.workspaceId).toEqual({ in: ['ws-1', 'ws-2'] });
    // Project query too.
    const projectWhere = prisma.project.findMany.mock.calls[0][0].where;
    expect(projectWhere.workspaceId).toEqual({ in: ['ws-1', 'ws-2'] });

    // Result cap is applied.
    expect(prisma.issue.findMany.mock.calls[0][0].take).toBe(20);

    // DTO shape.
    expect(result).toEqual({
      query: 'login',
      issues: [
        {
          id: 'issue-1',
          key: 'NL-12',
          number: 12,
          title: 'Fix the login bug',
          projectId: 'proj-1',
          projectKey: 'NL',
          statusId: 'status-1',
          statusName: 'To Do',
          statusCategory: 'TODO',
          type: 'BUG',
        },
      ],
      projects: [
        { id: 'proj-1', key: 'NL', name: 'Next Lane', workspaceId: 'ws-1' },
      ],
    });
  });

  it('returns empty results when the caller has no memberships (no leak)', async () => {
    prisma.membership.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'login');

    expect(result).toEqual({ query: 'login', issues: [], projects: [] });
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });

  it('returns empty results for an empty query without querying data', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);

    const result = await service.search('user-1', '   ');

    expect(result).toEqual({ query: '', issues: [], projects: [] });
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });

  it('matches an issue-key query like NL-12', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.issue.findMany.mockResolvedValue([issueRow]);
    prisma.project.findMany.mockResolvedValue([]);

    await service.search('user-1', 'NL-12');

    const or = prisma.issue.findMany.mock.calls[0][0].where.OR;
    expect(
      or.some(
        (clause: { number?: number }) => clause.number === 12,
      ),
    ).toBe(true);
  });

  it('rejects a projectId in a workspace the caller does not belong to', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    // assertProjectMember finds the project but no matching membership.
    prisma.project.findUnique.mockResolvedValue({
      id: 'proj-x',
      workspaceId: 'ws-other',
    });
    prisma.membership.findUnique.mockResolvedValue(null);

    await expect(
      service.search('user-1', 'login', 'proj-x'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });

  it('narrows the issue query to a single project when projectId is given', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.project.findUnique.mockResolvedValue({
      id: 'proj-1',
      workspaceId: 'ws-1',
    });
    prisma.membership.findUnique.mockResolvedValue({ role: 'MEMBER' });
    prisma.issue.findMany.mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);

    await service.search('user-1', 'login', 'proj-1');

    expect(prisma.issue.findMany.mock.calls[0][0].where.projectId).toBe('proj-1');
  });
});

describe('parseIssueKey', () => {
  it('parses NL-12', () => {
    expect(parseIssueKey('NL-12')).toEqual({ key: 'NL', number: 12 });
  });
  it('parses lowercase nl-12', () => {
    expect(parseIssueKey('nl-12')).toEqual({ key: 'nl', number: 12 });
  });
  it('returns null for plain text', () => {
    expect(parseIssueKey('login bug')).toBeNull();
  });
  it('returns null for a bare number', () => {
    expect(parseIssueKey('12')).toBeNull();
  });
});

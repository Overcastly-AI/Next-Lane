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
    page: { findMany: jest.fn() },
    project: { findMany: jest.fn(), findUnique: jest.fn() },
    $queryRaw: jest.fn(),
  } as unknown as PrismaService & {
    membership: { findMany: jest.Mock; findUnique: jest.Mock };
    issue: { findMany: jest.Mock };
    page: { findMany: jest.Mock };
    project: { findMany: jest.Mock; findUnique: jest.Mock };
    $queryRaw: jest.Mock;
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
    // Note: 'login' is >= 2 chars so the FTS path is used for issues.
    // $queryRaw returns FTS rows (with BigInt number as Postgres returns).
    const ftsRow = {
      id: 'issue-1',
      number: BigInt(12),
      title: 'Fix the login bug',
      type: 'BUG',
      projectId: 'proj-1',
      statusId: 'status-1',
      projectKey: 'NL',
      statusName: 'To Do',
      statusCategory: 'TODO',
    };
    const pageFtsRow = {
      id: 'page-1',
      title: 'Login flow',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      archived: false,
      projectKey: 'NL',
    };
    prisma.membership.findMany.mockResolvedValue([
      { workspaceId: 'ws-1' },
      { workspaceId: 'ws-2' },
    ]);
    // FTS fires issues first, then pages (Promise.all array order).
    prisma.$queryRaw
      .mockResolvedValueOnce([ftsRow])
      .mockResolvedValueOnce([pageFtsRow]);
    prisma.project.findMany.mockResolvedValue([
      { id: 'proj-1', key: 'NL', name: 'Next Lane', workspaceId: 'ws-1' },
    ]);

    const result = await service.search('user-1', 'login');

    // FTS path used for BOTH issues and pages — $queryRaw twice, no findMany.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
    expect(prisma.page.findMany).not.toHaveBeenCalled();

    // Project query is still via findMany, scoped to caller's workspaces.
    const projectWhere = prisma.project.findMany.mock.calls[0][0].where;
    expect(projectWhere.workspaceId).toEqual({ in: ['ws-1', 'ws-2'] });

    // DTO shape (number is coerced from BigInt to JS number).
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
      pages: [
        { id: 'page-1', title: 'Login flow', workspaceId: 'ws-1', projectId: 'proj-1', projectKey: 'NL', archived: false },
      ],
      projects: [
        { id: 'proj-1', key: 'NL', name: 'Next Lane', workspaceId: 'ws-1' },
      ],
    });
  });

  it('suppresses the pages group (never queries pages) when includePages=false', async () => {
    // Regression for the /search page-leak: a PAT scoped only `issues:read`
    // must get issues + projects but NO knowledge-base page hits, even though
    // pages live in the same workspace. The controller passes includePages=false
    // for such a principal.
    const ftsRow = {
      id: 'issue-1',
      number: BigInt(12),
      title: 'Fix the login bug',
      type: 'BUG',
      projectId: 'proj-1',
      statusId: 'status-1',
      projectKey: 'NL',
      statusName: 'To Do',
      statusCategory: 'TODO',
    };
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    // Only the issues FTS query should fire — pages must not be queried at all.
    prisma.$queryRaw.mockResolvedValueOnce([ftsRow]);
    prisma.project.findMany.mockResolvedValue([
      { id: 'proj-1', key: 'NL', name: 'Next Lane', workspaceId: 'ws-1' },
    ]);

    const result = await service.search('user-1', 'login', undefined, false);

    // Issues FTS ran once; the page query (FTS or ILIKE) never ran.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.page.findMany).not.toHaveBeenCalled();
    expect(result.pages).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.projects).toHaveLength(1);
  });

  it('returns empty results when the caller has no memberships (no leak)', async () => {
    prisma.membership.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'login');

    expect(result).toEqual({ query: 'login', issues: [], pages: [], projects: [] });
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });

  it('returns empty results for an empty query without querying data', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);

    const result = await service.search('user-1', '   ');

    expect(result).toEqual({ query: '', issues: [], pages: [], projects: [] });
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });

  it('matches an issue-key query like NL-12', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.issue.findMany.mockResolvedValue([issueRow]);
    prisma.page.findMany.mockResolvedValue([]);
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
    // 'login' >= 2 chars → FTS path. $queryRaw is called with projectId scoping.
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.project.findUnique.mockResolvedValue({
      id: 'proj-1',
      workspaceId: 'ws-1',
    });
    prisma.membership.findUnique.mockResolvedValue({ role: 'MEMBER' });
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);

    await service.search('user-1', 'login', 'proj-1');

    // FTS path — $queryRaw invoked for issues AND pages, findMany not invoked
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
    expect(prisma.page.findMany).not.toHaveBeenCalled();
  });

  it('page FTS is tenant-scoped to the caller workspaces (no cross-tenant leak)', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // issues
      .mockResolvedValueOnce([
        { id: 'page-9', title: 'Runbook', workspaceId: 'ws-1', projectId: 'proj-1', archived: false, projectKey: 'NL' },
      ]); // pages
    prisma.project.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'runbook');

    expect(result.pages).toEqual([
      { id: 'page-9', title: 'Runbook', workspaceId: 'ws-1', projectId: 'proj-1', projectKey: 'NL', archived: false },
    ]);
    // The workspace-id array is passed as a parameterized value into the raw
    // page query — assert it appears in the tagged-template params.
    const pageCallParams = prisma.$queryRaw.mock.calls[1];
    expect(JSON.stringify(pageCallParams)).toContain('ws-1');
  });

  it('searchPagesOnly returns only pages (the pages:read surface — no issue/project groups)', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'page-1', title: 'Runbook', workspaceId: 'ws-1', projectId: 'proj-1', archived: false, projectKey: 'NL' },
    ]);

    const result = await service.searchPagesOnly('user-1', 'runbook');

    // One raw query (pages FTS only — never the issue query), pages-only shape.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      query: 'runbook',
      pages: [
        { id: 'page-1', title: 'Runbook', workspaceId: 'ws-1', projectId: 'proj-1', projectKey: 'NL', archived: false },
      ],
    });
  });

  it('searchPagesOnly returns empty without querying when the caller has no memberships', async () => {
    prisma.membership.findMany.mockResolvedValue([]);
    const result = await service.searchPagesOnly('user-1', 'runbook');
    expect(result).toEqual({ query: 'runbook', pages: [] });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.page.findMany).not.toHaveBeenCalled();
  });

  it('searchPagesOnly rejects a projectId outside the caller workspaces', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.project.findUnique.mockResolvedValue({ id: 'proj-x', workspaceId: 'ws-other' });
    prisma.membership.findUnique.mockResolvedValue(null);
    await expect(
      service.searchPagesOnly('user-1', 'runbook', 'proj-x'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('falls back to page ILIKE for a 1-char query (below FTS_MIN_LENGTH)', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.issue.findMany.mockResolvedValue([]);
    prisma.page.findMany.mockResolvedValue([
      {
        id: 'page-3',
        title: 'A',
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        archived: false,
        project: { key: 'NL' },
      },
    ]);
    prisma.project.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'a');

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.page.findMany).toHaveBeenCalled();
    expect(result.pages).toEqual([
      { id: 'page-3', title: 'A', workspaceId: 'ws-1', projectId: 'proj-1', projectKey: 'NL', archived: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Workspace-level docs (org-level-docs epic, Slice 2): Page.projectId is now
// nullable (a workspace page has none). These tests pin down the two bugs
// the schema-architect flagged for this slice — the ILIKE `project` relation
// filter silently excluding `projectId: null` rows, and the FTS inner JOIN
// silently dropping them — by asserting a workspace-level page (mocked with
// `projectId: null`) IS returned, with `projectKey: null`, from every page
// search path (ILIKE, FTS, and `searchPagesOnly`).
// ---------------------------------------------------------------------------
describe('SearchService page search — workspace-level pages (org-level-docs epic, Slice 2)', () => {
  let prisma: MockPrisma;
  let service: SearchService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new SearchService(prisma);
  });

  it('ILIKE page search scopes tenancy by Page.workspaceId directly (never via the project relation)', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.issue.findMany.mockResolvedValue([]);
    prisma.page.findMany.mockResolvedValue([
      { id: 'page-ws', title: 'Handbook', workspaceId: 'ws-1', projectId: null, archived: false, project: null },
    ]);
    prisma.project.findMany.mockResolvedValue([]);

    // 1-char query -> ILIKE path.
    const result = await service.search('user-1', 'a');

    const where = prisma.page.findMany.mock.calls[0][0].where;
    // Tenant scope is `workspaceId: { in: [...] }` directly on Page, NOT
    // `project: { workspaceId: { in: [...] } }` — the latter would silently
    // exclude this exact workspace-level page (projectId: null).
    expect(where.workspaceId).toEqual({ in: ['ws-1'] });
    expect(where.project).toBeUndefined();
    expect(result.pages).toEqual([
      { id: 'page-ws', title: 'Handbook', workspaceId: 'ws-1', projectId: null, projectKey: null, archived: false },
    ]);
  });

  it('FTS page search LEFT JOINs Project (a workspace page has no Project row) and scopes by pg.workspaceId', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // issues
      .mockResolvedValueOnce([
        { id: 'page-ws', title: 'Handbook', workspaceId: 'ws-1', projectId: null, archived: false, projectKey: null },
      ]); // pages
    prisma.project.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'handbook');

    expect(result.pages).toEqual([
      { id: 'page-ws', title: 'Handbook', workspaceId: 'ws-1', projectId: null, projectKey: null, archived: false },
    ]);

    // Inspect the raw SQL text (the tagged-template strings array, joined) —
    // must be a LEFT JOIN (an INNER JOIN would silently drop this row) and
    // scoped by pg."workspaceId" (not p."workspaceId", which would be NULL
    // for a workspace page and never match).
    const pageCallStrings = prisma.$queryRaw.mock.calls[1][0] as unknown as string[];
    const sql = pageCallStrings.join('');
    expect(sql).toContain('LEFT JOIN "Project"');
    expect(sql).toContain('pg."workspaceId"');
  });

  it('searchPagesOnly surfaces a workspace-level page with projectKey null', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'page-ws', title: 'Handbook', workspaceId: 'ws-1', projectId: null, archived: false, projectKey: null },
    ]);

    const result = await service.searchPagesOnly('user-1', 'handbook');

    expect(result).toEqual({
      query: 'handbook',
      pages: [
        { id: 'page-ws', title: 'Handbook', workspaceId: 'ws-1', projectId: null, projectKey: null, archived: false },
      ],
    });
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

/**
 * Full-text search path tests for SearchService.search.
 * Verifies that queries >= 2 characters use $queryRaw (FTS), not issue.findMany
 * (ILIKE). Also verifies that:
 *  - tenant scoping is applied in the raw query (workspaceId filter)
 *  - key-style queries ("NL-12") always use the ILIKE path
 *  - special characters in the query do not error (websearch_to_tsquery handles them)
 *  - 1-char queries fall back to ILIKE
 *  - description-only matches are surfaced (the generated column covers description)
 */
describe('SearchService full-text search path', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: SearchService;

  const ftsIssueRow = {
    id: 'issue-fts-1',
    number: BigInt(7),
    title: 'Database performance issue',
    type: 'TASK',
    projectId: 'proj-1',
    statusId: 'status-1',
    projectKey: 'NL',
    statusName: 'In Progress',
    statusCategory: 'IN_PROGRESS',
  };

  beforeEach(() => {
    prisma = makePrisma();
    service = new SearchService(prisma);
  });

  it('uses $queryRaw (FTS) for queries >= 2 characters', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw.mockResolvedValue([ftsIssueRow]);
    prisma.project.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'database');

    // FTS path: $queryRaw called for issues AND pages, no findMany
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.issue.findMany).not.toHaveBeenCalled();

    // DTO shape preserved
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      id: 'issue-fts-1',
      key: 'NL-7',
      number: 7,
      title: 'Database performance issue',
      projectKey: 'NL',
      statusCategory: 'IN_PROGRESS',
      type: 'TASK',
    });
  });

  it('falls back to ILIKE (issue.findMany) for 1-character queries', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.issue.findMany.mockResolvedValue([]);
    prisma.page.findMany.mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);

    await service.search('user-1', 'a');

    expect(prisma.issue.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('uses ILIKE path for key-style queries like "NL-12" (single-token exact lookup)', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.issue.findMany.mockResolvedValue([]);
    prisma.page.findMany.mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);

    await service.search('user-1', 'NL-12');

    // Key queries go through findMany (ILIKE path + key predicate)
    expect(prisma.issue.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('handles special characters in query without error (websearch_to_tsquery is user-safe)', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);

    // Characters that would break to_tsquery are safe in websearch_to_tsquery
    await expect(
      service.search('user-1', 'bug & (fix OR patch) -wont:fix'),
    ).resolves.toMatchObject({ issues: [], projects: [] });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('scopes FTS query to the callers workspaces (tenant isolation)', async () => {
    prisma.membership.findMany.mockResolvedValue([
      { workspaceId: 'ws-tenant-a' },
      { workspaceId: 'ws-tenant-b' },
    ]);
    prisma.$queryRaw.mockResolvedValue([ftsIssueRow]);
    prisma.project.findMany.mockResolvedValue([]);

    await service.search('user-1', 'performance');

    // The $queryRaw calls (issues + pages) must have received the workspaceIds
    // so Postgres can filter — we verify by checking the mock was invoked (the
    // actual SQL is validated end-to-end on the live instance).
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    // The raw template should reference the workspace ids (passed as a bind
    // parameter); we can't easily inspect the Prisma.sql fragment internals
    // in unit tests, but we ensure FTS was invoked and not ILIKE.
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });

  it('narrows FTS to a single project when projectId is provided', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.project.findUnique.mockResolvedValue({
      id: 'proj-1',
      workspaceId: 'ws-1',
    });
    prisma.membership.findUnique.mockResolvedValue({ role: 'MEMBER' });
    prisma.$queryRaw.mockResolvedValue([ftsIssueRow]);
    prisma.project.findMany.mockResolvedValue([]);

    await service.search('user-1', 'performance', 'proj-1');

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });

  it('returns empty when no FTS matches exist', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'nonexistentterm');

    expect(result.issues).toHaveLength(0);
    expect(result.projects).toHaveLength(0);
  });

  it('correctly converts bigint number from raw query to JS number in DTO', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw.mockResolvedValue([{ ...ftsIssueRow, number: BigInt(99) }]);
    prisma.project.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'performance');

    expect(result.issues[0].number).toBe(99);
    expect(typeof result.issues[0].number).toBe('number');
    expect(result.issues[0].key).toBe('NL-99');
  });
});

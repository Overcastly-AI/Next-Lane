import { ForbiddenException } from '@nestjs/common';
import {
  SEARCH_HIGHLIGHT_END,
  SEARCH_HIGHLIGHT_START,
  splitSearchHighlight,
  stripSearchHighlight,
} from '@next-lane/shared';
import { SearchService, buildIlikeSnippet, parseIssueKey } from './search.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * DB-free unit tests for SearchService. Prisma is mocked so we can assert:
 *  - results are scoped to the caller's workspaces (no cross-tenant leak),
 *  - the DTO shape is correct (including the `snippet` and `paging` contract),
 *  - server-side LIMIT/OFFSET reach the database instead of being sliced later,
 *  - an empty query / no memberships short-circuits to empty results,
 *  - a projectId filter is authorized via membership.
 */

function makePrisma() {
  return {
    membership: { findMany: jest.fn(), findUnique: jest.fn() },
    issue: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    page: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    comment: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    project: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    $queryRaw: jest.fn(),
  } as unknown as PrismaService & {
    membership: { findMany: jest.Mock; findUnique: jest.Mock };
    issue: { findMany: jest.Mock; count: jest.Mock };
    page: { findMany: jest.Mock; count: jest.Mock };
    comment: { findMany: jest.Mock; count: jest.Mock };
    project: { findMany: jest.Mock; findUnique: jest.Mock; count: jest.Mock };
    $queryRaw: jest.Mock;
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

const issueRow = {
  id: 'issue-1',
  number: 12,
  title: 'Fix the login bug',
  description: null,
  type: 'BUG',
  projectId: 'proj-1',
  statusId: 'status-1',
  project: { key: 'NL' },
  status: { name: 'To Do', category: 'TODO' },
};

/** Default paging block for a group that returned nothing. */
const noHits = { limit: 20, offset: 0, total: 0, hasMore: false };

describe('SearchService.search', () => {
  let prisma: MockPrisma;
  let service: SearchService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new SearchService(prisma);
  });

  it('scopes issue, page and project queries to the caller workspaces only', async () => {
    // Note: 'login' is >= 2 chars so the FTS path is used for issues.
    // $queryRaw returns FTS rows (with BigInt number/total as Postgres returns).
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
      snippet: `the ${SEARCH_HIGHLIGHT_START}login${SEARCH_HIGHLIGHT_END} form throws`,
      total: BigInt(1),
    };
    const pageFtsRow = {
      id: 'page-1',
      title: 'Login flow',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      archived: false,
      projectKey: 'NL',
      snippet: `${SEARCH_HIGHLIGHT_START}login${SEARCH_HIGHLIGHT_END} is handled by the gateway`,
      total: BigInt(1),
    };
    prisma.membership.findMany.mockResolvedValue([
      { workspaceId: 'ws-1' },
      { workspaceId: 'ws-2' },
    ]);
    // FTS fires issues, then pages, then comments (Promise.all array order).
    prisma.$queryRaw
      .mockResolvedValueOnce([ftsRow])
      .mockResolvedValueOnce([pageFtsRow])
      .mockResolvedValueOnce([]);
    prisma.project.findMany.mockResolvedValue([
      { id: 'proj-1', key: 'NL', name: 'Next Lane', workspaceId: 'ws-1' },
    ]);
    prisma.project.count.mockResolvedValue(1);

    const result = await service.search('user-1', 'login');

    // FTS path for issues, pages AND comments — $queryRaw ×3, no findMany.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
    expect(prisma.page.findMany).not.toHaveBeenCalled();
    expect(prisma.comment.findMany).not.toHaveBeenCalled();

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
          snippet: `the ${SEARCH_HIGHLIGHT_START}login${SEARCH_HIGHLIGHT_END} form throws`,
        },
      ],
      pages: [
        {
          id: 'page-1',
          title: 'Login flow',
          workspaceId: 'ws-1',
          projectId: 'proj-1',
          projectKey: 'NL',
          archived: false,
          snippet: `${SEARCH_HIGHLIGHT_START}login${SEARCH_HIGHLIGHT_END} is handled by the gateway`,
        },
      ],
      projects: [{ id: 'proj-1', key: 'NL', name: 'Next Lane', workspaceId: 'ws-1' }],
      comments: [],
      paging: {
        issues: { limit: 20, offset: 0, total: 1, hasMore: false },
        pages: { limit: 20, offset: 0, total: 1, hasMore: false },
        projects: { limit: 20, offset: 0, total: 1, hasMore: false },
        comments: noHits,
      },
    });
  });

  it('suppresses the pages group (never queries pages) when includePages=false', async () => {
    // Regression for the /search page-leak: a PAT scoped only `issues:read`
    // must get issues + projects but NO knowledge-base page hits, even though
    // pages live in the same workspace. The controller passes includePages=false
    // for such a principal. Comments stay in — they ARE issue data, so
    // `issues:read` covers them.
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
      snippet: null,
      total: BigInt(1),
    };
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    // Issues FTS + comments FTS should fire; pages must not be queried at all.
    prisma.$queryRaw.mockResolvedValueOnce([ftsRow]).mockResolvedValueOnce([]);
    prisma.project.findMany.mockResolvedValue([
      { id: 'proj-1', key: 'NL', name: 'Next Lane', workspaceId: 'ws-1' },
    ]);
    prisma.project.count.mockResolvedValue(1);

    const result = await service.search('user-1', 'login', undefined, false);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.page.findMany).not.toHaveBeenCalled();
    expect(result.pages).toEqual([]);
    expect(result.paging.pages).toEqual(noHits);
    expect(result.issues).toHaveLength(1);
    expect(result.projects).toHaveLength(1);
  });

  it('returns empty results when the caller has no memberships (no leak)', async () => {
    prisma.membership.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'login');

    expect(result).toEqual({
      query: 'login',
      issues: [],
      pages: [],
      projects: [],
      comments: [],
      paging: { issues: noHits, pages: noHits, projects: noHits, comments: noHits },
    });
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });

  it('returns empty results for an empty query without querying data', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);

    const result = await service.search('user-1', '   ');

    expect(result.query).toBe('');
    expect(result.issues).toEqual([]);
    expect(result.comments).toEqual([]);
    expect(result.paging.issues).toEqual(noHits);
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });

  it('matches an issue-key query like NL-12', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.issue.findMany.mockResolvedValue([issueRow]);
    prisma.page.findMany.mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);

    await service.search('user-1', 'NL-12');

    const or = prisma.issue.findMany.mock.calls[0][0].where.OR;
    expect(or.some((clause: { number?: number }) => clause.number === 12)).toBe(true);
  });

  it('rejects a projectId in a workspace the caller does not belong to', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    // assertProjectMember finds the project but no matching membership.
    prisma.project.findUnique.mockResolvedValue({
      id: 'proj-x',
      workspaceId: 'ws-other',
    });
    prisma.membership.findUnique.mockResolvedValue(null);

    await expect(service.search('user-1', 'login', 'proj-x')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });

  it('narrows the issue query to a single project when projectId is given', async () => {
    // 'login' >= 2 chars → FTS path. $queryRaw is called with projectId scoping.
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.project.findUnique.mockResolvedValue({ id: 'proj-1', workspaceId: 'ws-1' });
    prisma.membership.findUnique.mockResolvedValue({ role: 'MEMBER' });
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);

    await service.search('user-1', 'login', 'proj-1');

    // FTS path — $queryRaw invoked for issues, pages AND comments.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
    expect(prisma.page.findMany).not.toHaveBeenCalled();
  });

  it('page FTS is tenant-scoped to the caller workspaces (no cross-tenant leak)', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // issues
      .mockResolvedValueOnce([
        {
          id: 'page-9',
          title: 'Runbook',
          workspaceId: 'ws-1',
          projectId: 'proj-1',
          archived: false,
          projectKey: 'NL',
          snippet: 'restart the worker',
          total: BigInt(1),
        },
      ]) // pages
      .mockResolvedValueOnce([]); // comments
    prisma.project.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'runbook');

    expect(result.pages).toEqual([
      {
        id: 'page-9',
        title: 'Runbook',
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        projectKey: 'NL',
        archived: false,
        snippet: 'restart the worker',
      },
    ]);
    // The workspace-id array is passed as a parameterized value into the raw
    // page query — assert it appears in the tagged-template params.
    const pageCallParams = prisma.$queryRaw.mock.calls[1];
    expect(JSON.stringify(pageCallParams)).toContain('ws-1');
  });

  it('searchPagesOnly returns only pages (the pages:read surface — no issue/project/comment groups)', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 'page-1',
        title: 'Runbook',
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        archived: false,
        projectKey: 'NL',
        snippet: 'how to restart',
        total: BigInt(1),
      },
    ]);

    const result = await service.searchPagesOnly('user-1', 'runbook');

    // One raw query (pages FTS only — never the issue/comment queries).
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      query: 'runbook',
      pages: [
        {
          id: 'page-1',
          title: 'Runbook',
          workspaceId: 'ws-1',
          projectId: 'proj-1',
          projectKey: 'NL',
          archived: false,
          snippet: 'how to restart',
        },
      ],
      paging: { limit: 20, offset: 0, total: 1, hasMore: false },
    });
  });

  it('searchPagesOnly returns empty without querying when the caller has no memberships', async () => {
    prisma.membership.findMany.mockResolvedValue([]);
    const result = await service.searchPagesOnly('user-1', 'runbook');
    expect(result).toEqual({ query: 'runbook', pages: [], paging: noHits });
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
        content: 'A page about apples',
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        archived: false,
        project: { key: 'NL' },
      },
    ]);
    prisma.page.count.mockResolvedValue(1);
    prisma.project.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'a');

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.page.findMany).toHaveBeenCalled();
    expect(result.pages).toEqual([
      {
        id: 'page-3',
        title: 'A',
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        projectKey: 'NL',
        archived: false,
        // ILIKE path still produces a delimited snippet — same DTO contract.
        snippet: `${SEARCH_HIGHLIGHT_START}A${SEARCH_HIGHLIGHT_END} page about apples`,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// R1 — recall that returns answers, not titles.
//
// The behaviour these tests pin down is the whole point of the feature: a
// caller must be able to judge a hit WITHOUT a follow-up full-record fetch,
// and must be able to reach match #21.
// ---------------------------------------------------------------------------
describe('SearchService — snippets (R1)', () => {
  let prisma: MockPrisma;
  let service: SearchService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new SearchService(prisma);
  });

  it('returns a body snippet for a page whose match is in the CONTENT, not the title', async () => {
    // The canonical recall case: nothing in the title hints at the answer, so
    // titles-only search would force a 256 KiB get_page to find out.
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // issues
      .mockResolvedValueOnce([
        {
          id: 'page-7',
          title: 'Q3 Planning Notes',
          workspaceId: 'ws-1',
          projectId: 'proj-1',
          archived: false,
          projectKey: 'NL',
          snippet: `we cap the API at 100 req/min via ${SEARCH_HIGHLIGHT_START}rate limiting${SEARCH_HIGHLIGHT_END} middleware`,
          total: BigInt(1),
        },
      ])
      .mockResolvedValueOnce([]); // comments
    prisma.project.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'rate limiting');

    const hit = result.pages[0];
    expect(hit.title).toBe('Q3 Planning Notes');
    expect(hit.title.toLowerCase()).not.toContain('rate limiting');
    // The answer is right there in the search response.
    expect(stripSearchHighlight(hit.snippet ?? '')).toContain('100 req/min');
    expect(splitSearchHighlight(hit.snippet ?? '')).toContainEqual({
      text: 'rate limiting',
      highlight: true,
    });
  });

  it('asks Postgres for a ts_headline with non-HTML delimiters, computed after LIMIT', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);

    await service.search('user-1', 'runbook');

    const [strings, ...params] = prisma.$queryRaw.mock.calls[1] as [string[], ...unknown[]];
    const sql = strings.join('?');
    expect(sql).toContain('ts_headline');
    // The headline is in the OUTER select, over a subquery that already applied
    // LIMIT/OFFSET — ts_headline re-parses the whole document per row, so it
    // must never run over the full match set.
    expect(sql).toContain('LIMIT');
    expect(sql.indexOf('ts_headline')).toBeLessThan(sql.indexOf('LIMIT'));
    // Deterministic ordering, or paging would duplicate/skip rows.
    expect(sql).toContain('ORDER BY rank DESC, pg2.id');
    // The options string is a bound parameter carrying our sentinels, never
    // ts_headline's `<b>` default.
    const options = params.find(
      (p): p is string => typeof p === 'string' && p.startsWith('StartSel='),
    );
    expect(options).toBeDefined();
    expect(options).toContain(`StartSel=${SEARCH_HIGHLIGHT_START}`);
    expect(options).toContain(`StopSel=${SEARCH_HIGHLIGHT_END}`);
    expect(options).not.toContain('<b>');
    expect(options).toContain('MaxFragments=2');
  });

  it('collapses whitespace in a markdown fragment so a hit renders as one line', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'page-md',
          title: 'Runbook',
          workspaceId: 'ws-1',
          projectId: null,
          archived: false,
          projectKey: null,
          snippet: 'canary first.\n\n## Throttling\n\nWe apply   rate limiting\tat the edge',
          total: BigInt(1),
        },
      ])
      .mockResolvedValueOnce([]);
    prisma.project.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'rate limiting');
    expect(result.pages[0].snippet).toBe(
      'canary first. ## Throttling We apply rate limiting at the edge',
    );
  });

  it('drops an empty ts_headline (issue with no description) to null rather than ""', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'i-1',
          number: BigInt(3),
          title: 'Login broken',
          type: 'BUG',
          projectId: 'proj-1',
          statusId: 'st-1',
          projectKey: 'NL',
          statusName: 'To Do',
          statusCategory: 'TODO',
          snippet: '   ',
          total: BigInt(1),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prisma.project.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'login');
    expect(result.issues[0].snippet).toBeNull();
  });

  it('hard-truncates a pathological snippet (one enormous "word" defeats MaxWords)', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'page-big',
          title: 'Blob',
          workspaceId: 'ws-1',
          projectId: null,
          archived: false,
          projectKey: null,
          snippet: 'x'.repeat(5000),
          total: BigInt(1),
        },
      ])
      .mockResolvedValueOnce([]);
    prisma.project.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'blob');
    expect((result.pages[0].snippet ?? '').length).toBeLessThanOrEqual(401);
  });
});

// ---------------------------------------------------------------------------
// R1 — server-side pagination. Before this, RESULT_CAP = 20 was hard-coded and
// MCP "paged" by slicing those 20 client-side: match #21 was unreachable and
// `total` was a lie.
// ---------------------------------------------------------------------------
describe('SearchService — server-side pagination (R1)', () => {
  let prisma: MockPrisma;
  let service: SearchService;

  /** Build `count` fake page FTS rows all reporting the same `total`. */
  function pageRows(count: number, total: number, startAt = 0) {
    return Array.from({ length: count }, (_, i) => ({
      id: `page-${startAt + i}`,
      title: `Page ${startAt + i}`,
      workspaceId: 'ws-1',
      projectId: null,
      archived: false,
      projectKey: null,
      snippet: 'body text',
      total: BigInt(total),
    }));
  }

  beforeEach(() => {
    prisma = makePrisma();
    service = new SearchService(prisma);
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.project.findMany.mockResolvedValue([]);
  });

  it('page 1 of many: LIMIT/OFFSET are bound parameters and hasMore is true', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce(pageRows(5, 42)).mockResolvedValueOnce([]);

    const result = await service.search('user-1', 'runbook', undefined, true, {
      limit: 5,
      offset: 0,
    });

    expect(result.pages).toHaveLength(5);
    expect(result.paging.pages).toEqual({ limit: 5, offset: 0, total: 42, hasMore: true });
    // The window really went to Postgres — not applied to a fixed 20-row cap
    // after the fact.
    const params = prisma.$queryRaw.mock.calls[1] as unknown[];
    expect(params).toContain(5);
    expect(params).toContain(0);
  });

  it('last page: offset + returned === total means hasMore is false', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(pageRows(2, 42, 40))
      .mockResolvedValueOnce([]);

    const result = await service.search('user-1', 'runbook', undefined, true, {
      limit: 5,
      offset: 40,
    });

    expect(result.pages).toHaveLength(2);
    expect(result.paging.pages).toEqual({ limit: 5, offset: 40, total: 42, hasMore: false });
  });

  it('beyond the end: no rows, total unknowable from the page, hasMore false', async () => {
    // Zero rows means no window function value came back, so `total` reads 0.
    // The contract that matters is that we do not claim there is more.
    prisma.$queryRaw.mockResolvedValue([]);

    const result = await service.search('user-1', 'runbook', undefined, true, {
      limit: 5,
      offset: 500,
    });

    expect(result.pages).toEqual([]);
    expect(result.paging.pages).toEqual({ limit: 5, offset: 500, total: 0, hasMore: false });
  });

  it('clamps an absurd limit to the maximum page size instead of trusting it', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    const result = await service.search('user-1', 'runbook', undefined, true, {
      limit: 10_000,
    });

    expect(result.paging.pages.limit).toBe(50);
    const params = prisma.$queryRaw.mock.calls[1] as unknown[];
    expect(params).toContain(50);
    expect(params).not.toContain(10_000);
  });

  it('pushes limit/offset into the ILIKE fallback as take/skip (not a post-hoc slice)', async () => {
    prisma.issue.findMany.mockResolvedValue([]);
    prisma.issue.count.mockResolvedValue(7);
    prisma.page.findMany.mockResolvedValue([]);
    prisma.page.count.mockResolvedValue(0);

    // 1-char query → ILIKE path.
    const result = await service.search('user-1', 'a', undefined, true, {
      limit: 3,
      offset: 3,
    });

    const args = prisma.issue.findMany.mock.calls[0][0];
    expect(args.take).toBe(3);
    expect(args.skip).toBe(3);
    // Stable secondary sort so paging can't duplicate/skip rows.
    expect(args.orderBy).toEqual([{ updatedAt: 'desc' }, { id: 'asc' }]);
    expect(result.paging.issues).toEqual({ limit: 3, offset: 3, total: 7, hasMore: true });
  });

  it('computes only the groups the caller asked for', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    const result = await service.search('user-1', 'stripe', undefined, true, {
      groups: ['comments'],
    });

    // One raw query (comments) — issues/pages never ran, projects never ran.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.project.findMany).not.toHaveBeenCalled();
    expect(result.issues).toEqual([]);
    expect(result.paging.issues).toEqual(noHits);
  });
});

// ---------------------------------------------------------------------------
// R1 — comments are searchable. Decisions get written in comments; before the
// Comment.searchVector migration they were invisible to search entirely.
// ---------------------------------------------------------------------------
describe('SearchService — comment search (R1)', () => {
  let prisma: MockPrisma;
  let service: SearchService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new SearchService(prisma);
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.project.findMany.mockResolvedValue([]);
  });

  it('returns a decision recorded in a comment, with the owning issue inline', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // issues
      .mockResolvedValueOnce([]) // pages
      .mockResolvedValueOnce([
        {
          id: 'c-1',
          issueId: 'i-42',
          issueNumber: BigInt(42),
          issueTitle: 'Choose a payment provider',
          projectId: 'proj-1',
          projectKey: 'NL',
          authorName: 'Dana',
          createdAt: new Date('2026-07-01T10:00:00.000Z'),
          snippet: `Decision: going with ${SEARCH_HIGHLIGHT_START}Stripe${SEARCH_HIGHLIGHT_END}`,
          total: BigInt(1),
        },
      ]);

    const result = await service.search('user-1', 'stripe');

    expect(result.comments).toEqual([
      {
        id: 'c-1',
        issueId: 'i-42',
        issueKey: 'NL-42',
        issueTitle: 'Choose a payment provider',
        projectId: 'proj-1',
        projectKey: 'NL',
        authorName: 'Dana',
        createdAt: '2026-07-01T10:00:00.000Z',
        snippet: `Decision: going with ${SEARCH_HIGHLIGHT_START}Stripe${SEARCH_HIGHLIGHT_END}`,
      },
    ]);
    expect(result.paging.comments).toEqual({
      limit: 20,
      offset: 0,
      total: 1,
      hasMore: false,
    });
  });

  it('scopes comment FTS through Issue → Project → workspaceId (no cross-tenant leak)', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await service.search('user-1', 'stripe');

    const [strings, ...params] = prisma.$queryRaw.mock.calls[2] as [string[], ...unknown[]];
    const sql = strings.join('?');
    expect(sql).toContain('FROM "Comment" c2');
    // The ONLY authorization boundary: a comment is reachable only through its
    // issue's project's workspace.
    expect(sql).toContain('JOIN "Issue"   i2 ON i2.id = c2."issueId"');
    expect(sql).toContain('JOIN "Project" p2 ON p2.id = i2."projectId"');
    expect(sql).toContain('WHERE p2."workspaceId" = ANY(');
    // ...and the workspace ids arrive as bound parameters, not interpolated.
    expect(params).toContainEqual(['ws-1']);
  });

  it('scopes the ILIKE comment fallback through the same relation chain', async () => {
    prisma.issue.findMany.mockResolvedValue([]);
    prisma.page.findMany.mockResolvedValue([]);
    prisma.comment.findMany.mockResolvedValue([]);

    await service.search('user-1', 'a'); // 1 char → ILIKE

    const where = prisma.comment.findMany.mock.calls[0][0].where;
    expect(where.issue).toEqual({ project: { workspaceId: { in: ['ws-1'] } } });
  });

  it('narrows comments to one project when projectId is supplied (ILIKE path)', async () => {
    prisma.project.findUnique.mockResolvedValue({ id: 'proj-1', workspaceId: 'ws-1' });
    prisma.membership.findUnique.mockResolvedValue({ role: 'MEMBER' });
    prisma.issue.findMany.mockResolvedValue([]);
    prisma.page.findMany.mockResolvedValue([]);
    prisma.comment.findMany.mockResolvedValue([]);

    await service.search('user-1', 'a', 'proj-1');

    const where = prisma.comment.findMany.mock.calls[0][0].where;
    expect(where.issue).toEqual({
      projectId: 'proj-1',
      project: { workspaceId: { in: ['ws-1'] } },
    });
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
      {
        id: 'page-ws',
        title: 'Handbook',
        content: '',
        workspaceId: 'ws-1',
        projectId: null,
        archived: false,
        project: null,
      },
    ]);
    prisma.page.count.mockResolvedValue(1);
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
      {
        id: 'page-ws',
        title: 'Handbook',
        workspaceId: 'ws-1',
        projectId: null,
        projectKey: null,
        archived: false,
        snippet: null,
      },
    ]);
  });

  it('FTS page search LEFT JOINs Project (a workspace page has no Project row) and scopes by pg.workspaceId', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // issues
      .mockResolvedValueOnce([
        {
          id: 'page-ws',
          title: 'Handbook',
          workspaceId: 'ws-1',
          projectId: null,
          archived: false,
          projectKey: null,
          snippet: null,
          total: BigInt(1),
        },
      ]) // pages
      .mockResolvedValueOnce([]); // comments
    prisma.project.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'handbook');

    expect(result.pages).toEqual([
      {
        id: 'page-ws',
        title: 'Handbook',
        workspaceId: 'ws-1',
        projectId: null,
        projectKey: null,
        archived: false,
        snippet: null,
      },
    ]);

    // Inspect the raw SQL text (the tagged-template strings array, joined) —
    // must be a LEFT JOIN (an INNER JOIN would silently drop this row) and
    // scoped by pg."workspaceId" (not p."workspaceId", which would be NULL
    // for a workspace page and never match).
    const pageCallStrings = prisma.$queryRaw.mock.calls[1][0] as unknown as string[];
    const sql = pageCallStrings.join('');
    expect(sql).toContain('LEFT JOIN "Project"');
    expect(sql).toContain('pg2."workspaceId"');
  });

  it('searchPagesOnly surfaces a workspace-level page with projectKey null', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 'page-ws',
        title: 'Handbook',
        workspaceId: 'ws-1',
        projectId: null,
        archived: false,
        projectKey: null,
        snippet: 'company handbook body',
        total: BigInt(1),
      },
    ]);

    const result = await service.searchPagesOnly('user-1', 'handbook');

    expect(result).toEqual({
      query: 'handbook',
      pages: [
        {
          id: 'page-ws',
          title: 'Handbook',
          workspaceId: 'ws-1',
          projectId: null,
          projectKey: null,
          archived: false,
          snippet: 'company handbook body',
        },
      ],
      paging: { limit: 20, offset: 0, total: 1, hasMore: false },
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

describe('buildIlikeSnippet', () => {
  it('windows around the first match and delimits it', () => {
    const body = `${'a'.repeat(200)} needle ${'b'.repeat(200)}`;
    const snippet = buildIlikeSnippet(body, 'needle') ?? '';
    expect(snippet).toContain(`${SEARCH_HIGHLIGHT_START}needle${SEARCH_HIGHLIGHT_END}`);
    // Bounded — a 400-char body must not come back whole.
    expect(snippet.length).toBeLessThan(body.length);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('preserves the original casing of the matched text', () => {
    expect(buildIlikeSnippet('The Needle here', 'needle')).toBe(
      `The ${SEARCH_HIGHLIGHT_START}Needle${SEARCH_HIGHLIGHT_END} here`,
    );
  });

  it('treats regex metacharacters as literal text (no RegExp, no injection)', () => {
    // If this were compiled as a pattern, `.*` would match at index 0 and the
    // highlight would land on the wrong text — or throw for an unbalanced `(`.
    const body = 'safe prefix .* literal suffix';
    expect(buildIlikeSnippet(body, '.*')).toBe(
      `safe prefix ${SEARCH_HIGHLIGHT_START}.*${SEARCH_HIGHLIGHT_END} literal suffix`,
    );
    expect(buildIlikeSnippet('a ( b', '(')).toBe(
      `a ${SEARCH_HIGHLIGHT_START}(${SEARCH_HIGHLIGHT_END} b`,
    );
    // A catastrophic-backtracking pattern is just a string we look for.
    expect(buildIlikeSnippet('nothing to see', '(a+)+$')).toBe('nothing to see');
  });

  it('falls back to the head of the body when the match was in the title', () => {
    expect(buildIlikeSnippet('body without the term', 'zzz')).toBe(
      'body without the term',
    );
  });

  it('returns null for an empty body', () => {
    expect(buildIlikeSnippet(null, 'x')).toBeNull();
    expect(buildIlikeSnippet('', 'x')).toBeNull();
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
    snippet: 'the query planner picks a seq scan',
    total: BigInt(1),
  };

  beforeEach(() => {
    prisma = makePrisma();
    service = new SearchService(prisma);
  });

  it('uses $queryRaw (FTS) for queries >= 2 characters', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    // Issues first, then pages, then comments — only the issues query returns
    // an issue row (a blanket mock would feed issue rows to the comment mapper).
    prisma.$queryRaw.mockResolvedValueOnce([ftsIssueRow]).mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'database');

    // FTS path: $queryRaw called for issues, pages AND comments, no findMany
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
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
      snippet: 'the query planner picks a seq scan',
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

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('passes a SQL-injection-shaped query as a bound parameter, never as SQL text', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);

    const nasty = `'; DROP TABLE "Page"; --`;
    await service.search('user-1', nasty);

    for (const call of prisma.$queryRaw.mock.calls) {
      const [strings, ...params] = call as [string[], ...unknown[]];
      // The query text NEVER appears in the static SQL fragments...
      expect(strings.join('?')).not.toContain('DROP TABLE');
      // ...it arrives as a bound parameter instead.
      expect(params).toContain(nasty);
    }
  });

  it('scopes FTS query to the callers workspaces (tenant isolation)', async () => {
    prisma.membership.findMany.mockResolvedValue([
      { workspaceId: 'ws-tenant-a' },
      { workspaceId: 'ws-tenant-b' },
    ]);
    // Issues first, then pages, then comments — only the issues query returns
    // an issue row (a blanket mock would feed issue rows to the comment mapper).
    prisma.$queryRaw.mockResolvedValueOnce([ftsIssueRow]).mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);

    await service.search('user-1', 'performance');

    // Every raw query (issues + pages + comments) must have received the
    // workspaceIds as a bound array so Postgres can filter.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    for (const call of prisma.$queryRaw.mock.calls) {
      const [, ...params] = call as [string[], ...unknown[]];
      expect(params).toContainEqual(['ws-tenant-a', 'ws-tenant-b']);
    }
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });

  it('narrows FTS to a single project when projectId is provided', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.project.findUnique.mockResolvedValue({
      id: 'proj-1',
      workspaceId: 'ws-1',
    });
    prisma.membership.findUnique.mockResolvedValue({ role: 'MEMBER' });
    // Issues first, then pages, then comments — only the issues query returns
    // an issue row (a blanket mock would feed issue rows to the comment mapper).
    prisma.$queryRaw.mockResolvedValueOnce([ftsIssueRow]).mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);

    await service.search('user-1', 'performance', 'proj-1');

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
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
    prisma.$queryRaw
      .mockResolvedValueOnce([{ ...ftsIssueRow, number: BigInt(99) }])
      .mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'performance');

    expect(result.issues[0].number).toBe(99);
    expect(typeof result.issues[0].number).toBe('number');
    expect(result.issues[0].key).toBe('NL-99');
  });

  it('converts the bigint COUNT(*) OVER() total to a JS number (JSON cannot carry BigInt)', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.$queryRaw
      .mockResolvedValueOnce([{ ...ftsIssueRow, total: BigInt(137) }])
      .mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);

    const result = await service.search('user-1', 'performance');

    expect(result.paging.issues.total).toBe(137);
    expect(typeof result.paging.issues.total).toBe('number');
    // Would throw "Do not know how to serialize a BigInt" if we passed it through.
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});

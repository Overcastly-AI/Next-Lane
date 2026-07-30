import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertProjectMember } from '../common/membership.util';
import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_HIGHLIGHT_END,
  SEARCH_HIGHLIGHT_START,
  SEARCH_MAX_LIMIT,
  SEARCH_SNIPPET_ELLIPSIS,
} from '@next-lane/shared';
import type {
  SearchCommentDto,
  SearchGroup,
  SearchIssueDto,
  SearchPageDto,
  SearchPagesResultsDto,
  SearchPagingDto,
  SearchProjectDto,
  SearchResultsDto,
  SearchSnippet,
  StatusCategory,
  IssueType,
} from '@next-lane/shared';

/**
 * Minimum query length required before switching from a simple ILIKE to
 * full-text search. A 1-character query produces extremely broad tsvector
 * results and `websearch_to_tsquery` may silently drop it (e.g. stop words),
 * so we skip FTS and fall back to ILIKE for very short inputs.
 */
const FTS_MIN_LENGTH = 2;

/**
 * `ts_headline` configuration — the knob that turns search from "a list of
 * titles" into "an answer". Every value is deliberate:
 *
 * • `StartSel`/`StopSel` — the Private Use Area sentinels from
 *   `@next-lane/shared`, NOT the `<b>`/`</b>` default. See that module for the
 *   full argument; short version: this string lands in a JSON DTO that the web
 *   renders as text and an agent reads raw, so it must not be HTML and must not
 *   collide with the markdown in the body being excerpted.
 * • `MaxFragments=2` — enables `ts_headline`'s fragment mode, which stitches
 *   together the best *disjoint* windows instead of one contiguous run. Two
 *   fragments is enough to show a match plus a corroborating second mention;
 *   more is mostly padding, and every fragment is tokens someone pays for.
 * • `MaxWords=20` / `MinWords=8` — in fragment mode these bound each fragment,
 *   so the worst case is 2 × 20 ≈ 40 words ≈ 260 chars. Wide enough to read as
 *   a sentence, narrow enough that a full page of 20 hits stays in single-digit KB.
 * • `ShortWord=3` — Postgres' default; keeps a fragment from starting or ending
 *   on a dangling "of"/"the".
 * • `FragmentDelimiter` — an ellipsis, so a human and a model both read the
 *   join as "text was skipped here" without needing a legend.
 *
 * NOT a user input: this string is a compile-time constant, passed as a bound
 * query parameter alongside the (also bound) user query.
 */
const HEADLINE_OPTIONS = [
  `StartSel=${SEARCH_HIGHLIGHT_START}`,
  `StopSel=${SEARCH_HIGHLIGHT_END}`,
  'MaxFragments=2',
  'MaxWords=20',
  'MinWords=8',
  'ShortWord=3',
  `FragmentDelimiter= ${SEARCH_SNIPPET_ELLIPSIS} `,
].join(', ');

/**
 * Hard ceiling on a snippet, applied in JS after Postgres. `ts_headline`
 * respects MaxWords per fragment but a "word" can be arbitrarily long (a
 * minified blob, a base64 payload, a 2 KB URL), so a pathological document
 * could still blow the byte budget this whole change exists to protect.
 */
const SNIPPET_MAX_CHARS = 400;

/** Characters of context kept either side of an ILIKE match. */
const ILIKE_SNIPPET_CONTEXT = 90;

/** Raw row returned by the FTS $queryRaw for issues. */
interface FtsIssueRow {
  id: string;
  number: bigint;
  title: string;
  type: string;
  projectId: string;
  statusId: string;
  projectKey: string;
  statusName: string;
  statusCategory: string;
  snippet: string | null;
  /** `COUNT(*) OVER()` from the inner ranking query — total matches, pre-LIMIT. */
  total: bigint;
}

/** Raw row returned by the FTS $queryRaw for pages. */
interface FtsPageRow {
  id: string;
  title: string;
  workspaceId: string;
  /** Null = a workspace-level page (no owning project). */
  projectId: string | null;
  archived: boolean;
  /** Null when `projectId` is null. */
  projectKey: string | null;
  snippet: string | null;
  total: bigint;
}

/** Raw row returned by the FTS $queryRaw for comments. */
interface FtsCommentRow {
  id: string;
  issueId: string;
  issueNumber: bigint;
  issueTitle: string;
  projectId: string;
  projectKey: string;
  authorName: string | null;
  createdAt: Date;
  snippet: string | null;
  total: bigint;
}

/** One page of results plus the true (pre-LIMIT) match count for the group. */
interface Paged<T> {
  items: T[];
  total: number;
}

/** Zeroed paging for a group the caller didn't request / isn't authorized for. */
function emptyPaging(limit: number, offset: number): SearchPagingDto {
  return { limit, offset, total: 0, hasMore: false };
}

function pagingFor(
  limit: number,
  offset: number,
  page: Paged<unknown>,
): SearchPagingDto {
  return {
    limit,
    offset,
    total: page.total,
    hasMore: offset + page.items.length < page.total,
  };
}

const EMPTY_PAGE: Paged<never> = { items: [], total: 0 };

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cross-project search scoped strictly to the workspaces the caller belongs to.
   *
   * Scoping is enforced by deriving the caller's workspace ids from their
   * memberships and constraining every query to projects in those workspaces —
   * so a hit can never come from another tenant's data. When `projectId` is
   * provided, we additionally assert membership on that project and narrow to it.
   *
   * Issue search uses Postgres full-text search (GIN-indexed `searchVector`
   * generated column covering title + description) via `websearch_to_tsquery`,
   * which is user-input-safe (handles quotes, special chars, stop words). Results
   * are ordered by `ts_rank` descending so the most relevant issue appears first.
   * For very short queries (< {@link FTS_MIN_LENGTH} chars) and key-style
   * queries like "NL-12" the service falls back to Prisma ILIKE, which is correct
   * for single-token or exact-key lookups.
   *
   * Every group returns a highlighted SNIPPET of the matched body and is paged
   * SERVER-SIDE (`limit`/`offset` plus a true `total`), so one call can answer
   * "what do we know about X?" instead of costing 1 + N full-record fetches.
   *
   * `includePages` gates the knowledge-base `pages` group. The `GET /search`
   * route only requires `issues:read`, but its response also carries page hits,
   * which are a distinct surface guarded by `pages:read`. A PAT scoped to only
   * `issues:read` must therefore NOT receive page content here (that would leak
   * the wiki past its scope — the exact bug the pages-only `/search/pages`
   * route was created to avoid). Callers pass `false` when the principal lacks
   * `pages:read`; JWT sessions and unscoped PATs pass `true` (full access).
   *
   * The `comments` group needs NO additional gate: a comment is issue data, so
   * the route's existing `issues:read` requirement is exactly the right one.
   *
   * `opts.groups` lets a caller ask for a subset ("just comments") so the other
   * queries are never run — the difference between a targeted recall question
   * and paying for four searches to read one.
   */
  async search(
    userId: string,
    q?: string,
    projectId?: string,
    includePages = true,
    opts: { limit?: number; offset?: number; groups?: SearchGroup[] } = {},
  ): Promise<SearchResultsDto> {
    const query = (q ?? '').trim();
    const limit = clampLimit(opts.limit);
    const offset = Math.max(opts.offset ?? 0, 0);
    const wants = (g: SearchGroup): boolean => !opts.groups || opts.groups.includes(g);

    // Workspaces the caller can see. This is the only authorization boundary
    // for the result set — never query issues/projects without it.
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    const workspaceIds = memberships.map((m) => m.workspaceId);

    if (workspaceIds.length === 0 || query.length === 0) {
      return emptyResults(query, limit, offset);
    }

    let allowedProjectId: string | undefined;
    if (projectId) {
      // Throws ForbiddenException if the caller is not a member of the project's
      // workspace — prevents probing foreign projects via ?projectId=.
      const project = await assertProjectMember(this.prisma, userId, projectId);
      if (!workspaceIds.includes(project.workspaceId)) {
        throw new ForbiddenException('Not a member of this project');
      }
      allowedProjectId = projectId;
    }

    // Determine whether to use full-text search or fall back to ILIKE.
    // Key-style queries like "NL-12" always use the ILIKE path because they
    // are single-token exact identifiers, not natural-language text.
    const keyMatch = parseIssueKey(query);
    const useFts = !keyMatch && query.length >= FTS_MIN_LENGTH;
    const page = { limit, offset };

    const [issues, pages, projects, comments] = await Promise.all([
      !wants('issues')
        ? Promise.resolve(EMPTY_PAGE as Paged<SearchIssueDto>)
        : useFts
          ? this.searchIssuesFts(query, workspaceIds, page, allowedProjectId)
          : this.searchIssuesIlike(query, workspaceIds, page, allowedProjectId, keyMatch),
      // Pages have no key-style lookup, so they use FTS for len >= FTS_MIN_LENGTH
      // and ILIKE otherwise — same tenant scoping as issues. Skipped entirely
      // (empty group) when the caller lacks `pages:read` — see `includePages`.
      !includePages || !wants('pages')
        ? Promise.resolve(EMPTY_PAGE as Paged<SearchPageDto>)
        : useFts
          ? this.searchPagesFts(query, workspaceIds, page, allowedProjectId)
          : this.searchPagesIlike(query, workspaceIds, page, allowedProjectId),
      // Project search is global within the caller's workspaces, regardless of
      // the projectId filter (which only scopes issues/pages/comments).
      wants('projects')
        ? this.searchProjects(query, workspaceIds, page)
        : Promise.resolve(EMPTY_PAGE as Paged<SearchProjectDto>),
      // Comments: the place decisions are actually recorded. A key-style query
      // ("NL-12") means nothing against a comment body, so it takes the ILIKE
      // path alongside very short queries.
      !wants('comments')
        ? Promise.resolve(EMPTY_PAGE as Paged<SearchCommentDto>)
        : useFts
          ? this.searchCommentsFts(query, workspaceIds, page, allowedProjectId)
          : this.searchCommentsIlike(query, workspaceIds, page, allowedProjectId),
    ]);

    return {
      query,
      issues: issues.items,
      pages: pages.items,
      projects: projects.items,
      comments: comments.items,
      paging: {
        issues: pagingFor(limit, offset, issues),
        pages: pagingFor(limit, offset, pages),
        projects: pagingFor(limit, offset, projects),
        comments: pagingFor(limit, offset, comments),
      },
    };
  }

  /**
   * Pages-only search for `GET /search/pages` (`pages:read` — see the
   * controller for why this exists separately from the combined `/search`,
   * which is `issues:read` because its response includes issue hits). Same
   * workspace scoping and FTS/ILIKE split as the combined search; returns
   * only the `pages` group.
   */
  async searchPagesOnly(
    userId: string,
    q?: string,
    projectId?: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<SearchPagesResultsDto> {
    const query = (q ?? '').trim();
    const limit = clampLimit(opts.limit);
    const offset = Math.max(opts.offset ?? 0, 0);

    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    const workspaceIds = memberships.map((m) => m.workspaceId);
    if (workspaceIds.length === 0 || query.length === 0) {
      return { query, pages: [], paging: emptyPaging(limit, offset) };
    }

    let allowedProjectId: string | undefined;
    if (projectId) {
      const project = await assertProjectMember(this.prisma, userId, projectId);
      if (!workspaceIds.includes(project.workspaceId)) {
        throw new ForbiddenException('Not a member of this project');
      }
      allowedProjectId = projectId;
    }

    const page = { limit, offset };
    const result =
      query.length >= FTS_MIN_LENGTH
        ? await this.searchPagesFts(query, workspaceIds, page, allowedProjectId)
        : await this.searchPagesIlike(query, workspaceIds, page, allowedProjectId);
    return { query, pages: result.items, paging: pagingFor(limit, offset, result) };
  }

  /**
   * Full-text search over pages via the GIN-indexed `searchVector` generated
   * column (title + content). Tenant scoping is by `Page.workspaceId`
   * DIRECTLY (every page — project or workspace-level — always has one), NOT
   * via an inner join through `Project`: `Page.projectId` is nullable
   * (workspace-level pages have none), so a `JOIN "Project"` would silently
   * drop every workspace page from the results. The `LEFT JOIN` below exists
   * only to fetch `projectKey` for a project page; it plays no role in tenant
   * scoping. An optional single-project narrow additionally filters by
   * `pg."projectId"`. `websearch_to_tsquery` is user-input-safe.
   *
   * SHAPE — why the inner subquery: `ts_headline` re-parses the whole document
   * for every row it is evaluated on, which on a 256 KiB page is expensive.
   * Ranking + `LIMIT`/`OFFSET` therefore happen in the inner query (which
   * touches only the GIN index and the tsvector), and the headline is computed
   * in the outer query on at most `limit` rows. `COUNT(*) OVER()` rides along
   * inside that subquery to give a true total without a second round trip.
   * `ORDER BY rank DESC, id` — the id tiebreaker makes paging deterministic;
   * without it two equally-ranked rows can swap between page 1 and page 2, so a
   * caller sees one hit twice and never sees the other at all.
   */
  private async searchPagesFts(
    query: string,
    workspaceIds: string[],
    { limit, offset }: { limit: number; offset: number },
    projectId?: string,
  ): Promise<Paged<SearchPageDto>> {
    let rows: FtsPageRow[];
    if (projectId) {
      rows = await this.prisma.$queryRaw<FtsPageRow[]>`
        SELECT
          pg.id, pg.title, pg."workspaceId", pg."projectId", pg.archived,
          p.key AS "projectKey",
          ts_headline('english', coalesce(pg.content, ''),
                      websearch_to_tsquery('english', ${query}),
                      ${HEADLINE_OPTIONS}) AS snippet,
          h.total
        FROM (
          SELECT pg2.id,
                 ts_rank(pg2."searchVector", websearch_to_tsquery('english', ${query})) AS rank,
                 COUNT(*) OVER() AS total
          FROM "Page" pg2
          WHERE pg2."workspaceId" = ANY(${workspaceIds}::text[])
            AND pg2."projectId"   = ${projectId}
            AND pg2."searchVector" @@ websearch_to_tsquery('english', ${query})
          ORDER BY rank DESC, pg2.id
          LIMIT ${limit} OFFSET ${offset}
        ) h
        JOIN "Page" pg ON pg.id = h.id
        LEFT JOIN "Project" p ON p.id = pg."projectId"
        ORDER BY h.rank DESC, pg.id
      `;
    } else {
      rows = await this.prisma.$queryRaw<FtsPageRow[]>`
        SELECT
          pg.id, pg.title, pg."workspaceId", pg."projectId", pg.archived,
          p.key AS "projectKey",
          ts_headline('english', coalesce(pg.content, ''),
                      websearch_to_tsquery('english', ${query}),
                      ${HEADLINE_OPTIONS}) AS snippet,
          h.total
        FROM (
          SELECT pg2.id,
                 ts_rank(pg2."searchVector", websearch_to_tsquery('english', ${query})) AS rank,
                 COUNT(*) OVER() AS total
          FROM "Page" pg2
          WHERE pg2."workspaceId" = ANY(${workspaceIds}::text[])
            AND pg2."searchVector" @@ websearch_to_tsquery('english', ${query})
          ORDER BY rank DESC, pg2.id
          LIMIT ${limit} OFFSET ${offset}
        ) h
        JOIN "Page" pg ON pg.id = h.id
        LEFT JOIN "Project" p ON p.id = pg."projectId"
        ORDER BY h.rank DESC, pg.id
      `;
    }
    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        workspaceId: r.workspaceId,
        projectId: r.projectId,
        projectKey: r.projectKey,
        archived: r.archived,
        snippet: normalizeSnippet(r.snippet),
      })),
      total: totalOf(rows),
    };
  }

  /**
   * Fallback ILIKE page search for very short queries (title + content).
   * Tenant-scoped by `Page.workspaceId` directly — see `searchPagesFts`'s doc
   * for why this must NOT go through the `project` relation (that filter
   * silently excludes every `projectId: null` workspace page).
   *
   * There is no tsquery to headline against on this path, so the snippet is a
   * plain substring window around the first case-insensitive match
   * ({@link buildIlikeSnippet}) using the same delimiters — the DTO contract is
   * identical whichever path served the query.
   */
  private async searchPagesIlike(
    query: string,
    workspaceIds: string[],
    { limit, offset }: { limit: number; offset: number },
    projectId?: string,
  ): Promise<Paged<SearchPageDto>> {
    const where: Prisma.PageWhereInput = {
      workspaceId: { in: workspaceIds },
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } },
      ],
    };
    if (projectId) where.projectId = projectId;

    const [rows, total] = await Promise.all([
      this.prisma.page.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          title: true,
          content: true,
          workspaceId: true,
          projectId: true,
          archived: true,
          project: { select: { key: true } },
        },
      }),
      this.prisma.page.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        workspaceId: r.workspaceId,
        projectId: r.projectId,
        projectKey: r.project?.key ?? null,
        archived: r.archived,
        snippet: buildIlikeSnippet(r.content, query),
      })),
      total,
    };
  }

  /**
   * Full-text search using the GIN-indexed `searchVector` generated column.
   * Uses `websearch_to_tsquery('english', $query)` which is user-input-safe:
   * it handles quoted phrases, `OR`, `-negation`, and ignores characters that
   * would error with `to_tsquery`. Results are ranked by `ts_rank` descending.
   *
   * Tenant scoping is enforced via a JOIN on `Project` and the caller's
   * `workspaceIds` array (passed as a parameterized array literal). An optional
   * `projectId` narrows the search to a single project.
   *
   * The snippet comes from `description` ONLY — the title is already returned
   * in full, so headlining it too would spend bytes repeating a field the
   * caller can already see. See `searchPagesFts` for why ranking/paging happen
   * in an inner subquery and the headline in the outer one.
   */
  private async searchIssuesFts(
    query: string,
    workspaceIds: string[],
    { limit, offset }: { limit: number; offset: number },
    projectId?: string,
  ): Promise<Paged<SearchIssueDto>> {
    // Build the optional project-scoping predicate. We include it inline only
    // when projectId is defined, otherwise we omit the clause entirely.
    // Both branches use parameterized values — no string interpolation of
    // user-supplied data.
    let rows: FtsIssueRow[];

    if (projectId) {
      rows = await this.prisma.$queryRaw<FtsIssueRow[]>`
        SELECT
          i.id,
          i.number,
          i.title,
          i.type,
          i."projectId",
          i."statusId",
          p.key            AS "projectKey",
          s.name           AS "statusName",
          s.category       AS "statusCategory",
          ts_headline('english', coalesce(i.description, ''),
                      websearch_to_tsquery('english', ${query}),
                      ${HEADLINE_OPTIONS}) AS snippet,
          h.total
        FROM (
          SELECT i2.id,
                 ts_rank(i2."searchVector", websearch_to_tsquery('english', ${query})) AS rank,
                 COUNT(*) OVER() AS total
          FROM "Issue" i2
          JOIN "Project" p2 ON p2.id = i2."projectId"
          WHERE p2."workspaceId" = ANY(${workspaceIds}::text[])
            AND i2."projectId"   = ${projectId}
            AND i2."searchVector" @@ websearch_to_tsquery('english', ${query})
          ORDER BY rank DESC, i2.id
          LIMIT ${limit} OFFSET ${offset}
        ) h
        JOIN "Issue"   i ON i.id = h.id
        JOIN "Project" p ON p.id = i."projectId"
        JOIN "Status"  s ON s.id = i."statusId"
        ORDER BY h.rank DESC, i.id
      `;
    } else {
      rows = await this.prisma.$queryRaw<FtsIssueRow[]>`
        SELECT
          i.id,
          i.number,
          i.title,
          i.type,
          i."projectId",
          i."statusId",
          p.key            AS "projectKey",
          s.name           AS "statusName",
          s.category       AS "statusCategory",
          ts_headline('english', coalesce(i.description, ''),
                      websearch_to_tsquery('english', ${query}),
                      ${HEADLINE_OPTIONS}) AS snippet,
          h.total
        FROM (
          SELECT i2.id,
                 ts_rank(i2."searchVector", websearch_to_tsquery('english', ${query})) AS rank,
                 COUNT(*) OVER() AS total
          FROM "Issue" i2
          JOIN "Project" p2 ON p2.id = i2."projectId"
          WHERE p2."workspaceId" = ANY(${workspaceIds}::text[])
            AND i2."searchVector" @@ websearch_to_tsquery('english', ${query})
          ORDER BY rank DESC, i2.id
          LIMIT ${limit} OFFSET ${offset}
        ) h
        JOIN "Issue"   i ON i.id = h.id
        JOIN "Project" p ON p.id = i."projectId"
        JOIN "Status"  s ON s.id = i."statusId"
        ORDER BY h.rank DESC, i.id
      `;
    }

    return {
      items: rows.map((r) => ({
        id: r.id,
        key: `${r.projectKey}-${Number(r.number)}`,
        number: Number(r.number),
        title: r.title,
        projectId: r.projectId,
        projectKey: r.projectKey,
        statusId: r.statusId,
        statusName: r.statusName,
        statusCategory: r.statusCategory as StatusCategory,
        type: r.type as IssueType,
        snippet: normalizeSnippet(r.snippet),
      })),
      total: totalOf(rows),
    };
  }

  /**
   * Fallback ILIKE search for very short queries and issue-key lookups.
   * Matches title + description via Prisma's `contains`/`mode: insensitive`,
   * and adds a key-style predicate when `keyMatch` is provided.
   */
  private async searchIssuesIlike(
    query: string,
    workspaceIds: string[],
    { limit, offset }: { limit: number; offset: number },
    projectId?: string,
    keyMatch?: { key: string; number: number } | null,
  ): Promise<Paged<SearchIssueDto>> {
    const textMatch: Prisma.IssueWhereInput[] = [
      { title: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
    ];

    if (keyMatch) {
      textMatch.push({
        number: keyMatch.number,
        project: { key: { equals: keyMatch.key, mode: 'insensitive' } },
      });
    }

    const where: Prisma.IssueWhereInput = {
      project: { workspaceId: { in: workspaceIds } },
      OR: textMatch,
    };
    if (projectId) {
      where.projectId = projectId;
    }

    const [rows, total] = await Promise.all([
      this.prisma.issue.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          number: true,
          title: true,
          description: true,
          type: true,
          projectId: true,
          statusId: true,
          project: { select: { key: true } },
          status: { select: { name: true, category: true } },
        },
      }),
      this.prisma.issue.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        key: `${r.project.key}-${r.number}`,
        number: r.number,
        title: r.title,
        projectId: r.projectId,
        projectKey: r.project.key,
        statusId: r.statusId,
        statusName: r.status.name,
        statusCategory: r.status.category as StatusCategory,
        type: r.type as IssueType,
        snippet: buildIlikeSnippet(r.description, query),
      })),
      total,
    };
  }

  /**
   * Full-text search over COMMENT bodies via the GIN-indexed
   * `Comment.searchVector` generated column — the surface that makes "what did
   * we decide about X?" answerable, since decisions get written in comments.
   *
   * TENANT SCOPING: a comment has no workspace of its own, so the inner query
   * walks Comment → Issue → Project and filters on `Project."workspaceId"`,
   * exactly the boundary `searchIssuesFts` enforces. Both joins are INNER (a
   * comment always has an issue, an issue always has a project), so there is no
   * nullable-FK hole of the kind `searchPagesFts` documents for pages. Nothing
   * about a comment is reachable unless its issue's project passes the
   * workspace check. The `LEFT JOIN "User"` is only for the author's display
   * name (nullable after account deletion) and plays no part in scoping.
   */
  private async searchCommentsFts(
    query: string,
    workspaceIds: string[],
    { limit, offset }: { limit: number; offset: number },
    projectId?: string,
  ): Promise<Paged<SearchCommentDto>> {
    let rows: FtsCommentRow[];
    if (projectId) {
      rows = await this.prisma.$queryRaw<FtsCommentRow[]>`
        SELECT
          c.id,
          c."issueId",
          c."createdAt",
          i.number   AS "issueNumber",
          i.title    AS "issueTitle",
          i."projectId",
          p.key      AS "projectKey",
          u.name     AS "authorName",
          ts_headline('english', coalesce(c.body, ''),
                      websearch_to_tsquery('english', ${query}),
                      ${HEADLINE_OPTIONS}) AS snippet,
          h.total
        FROM (
          SELECT c2.id,
                 ts_rank(c2."searchVector", websearch_to_tsquery('english', ${query})) AS rank,
                 COUNT(*) OVER() AS total
          FROM "Comment" c2
          JOIN "Issue"   i2 ON i2.id = c2."issueId"
          JOIN "Project" p2 ON p2.id = i2."projectId"
          WHERE p2."workspaceId" = ANY(${workspaceIds}::text[])
            AND i2."projectId"   = ${projectId}
            AND c2."searchVector" @@ websearch_to_tsquery('english', ${query})
          ORDER BY rank DESC, c2.id
          LIMIT ${limit} OFFSET ${offset}
        ) h
        JOIN "Comment" c ON c.id = h.id
        JOIN "Issue"   i ON i.id = c."issueId"
        JOIN "Project" p ON p.id = i."projectId"
        LEFT JOIN "User" u ON u.id = c."authorId"
        ORDER BY h.rank DESC, c.id
      `;
    } else {
      rows = await this.prisma.$queryRaw<FtsCommentRow[]>`
        SELECT
          c.id,
          c."issueId",
          c."createdAt",
          i.number   AS "issueNumber",
          i.title    AS "issueTitle",
          i."projectId",
          p.key      AS "projectKey",
          u.name     AS "authorName",
          ts_headline('english', coalesce(c.body, ''),
                      websearch_to_tsquery('english', ${query}),
                      ${HEADLINE_OPTIONS}) AS snippet,
          h.total
        FROM (
          SELECT c2.id,
                 ts_rank(c2."searchVector", websearch_to_tsquery('english', ${query})) AS rank,
                 COUNT(*) OVER() AS total
          FROM "Comment" c2
          JOIN "Issue"   i2 ON i2.id = c2."issueId"
          JOIN "Project" p2 ON p2.id = i2."projectId"
          WHERE p2."workspaceId" = ANY(${workspaceIds}::text[])
            AND c2."searchVector" @@ websearch_to_tsquery('english', ${query})
          ORDER BY rank DESC, c2.id
          LIMIT ${limit} OFFSET ${offset}
        ) h
        JOIN "Comment" c ON c.id = h.id
        JOIN "Issue"   i ON i.id = c."issueId"
        JOIN "Project" p ON p.id = i."projectId"
        LEFT JOIN "User" u ON u.id = c."authorId"
        ORDER BY h.rank DESC, c.id
      `;
    }

    return {
      items: rows.map((r) => ({
        id: r.id,
        issueId: r.issueId,
        issueKey: `${r.projectKey}-${Number(r.issueNumber)}`,
        issueTitle: r.issueTitle,
        projectId: r.projectId,
        projectKey: r.projectKey,
        authorName: r.authorName,
        createdAt: toIso(r.createdAt),
        snippet: normalizeSnippet(r.snippet),
      })),
      total: totalOf(rows),
    };
  }

  /**
   * Fallback ILIKE comment search for very short / key-style queries. Scoped
   * through the same Comment → Issue → Project → workspace chain the FTS path
   * uses, expressed as a nested Prisma relation filter.
   */
  private async searchCommentsIlike(
    query: string,
    workspaceIds: string[],
    { limit, offset }: { limit: number; offset: number },
    projectId?: string,
  ): Promise<Paged<SearchCommentDto>> {
    const where: Prisma.CommentWhereInput = {
      issue: projectId
        ? { projectId, project: { workspaceId: { in: workspaceIds } } }
        : { project: { workspaceId: { in: workspaceIds } } },
      body: { contains: query, mode: 'insensitive' },
    };

    const [rows, total] = await Promise.all([
      this.prisma.comment.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          body: true,
          issueId: true,
          createdAt: true,
          author: { select: { name: true } },
          issue: {
            select: {
              number: true,
              title: true,
              projectId: true,
              project: { select: { key: true } },
            },
          },
        },
      }),
      this.prisma.comment.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        issueId: r.issueId,
        issueKey: `${r.issue.project.key}-${r.issue.number}`,
        issueTitle: r.issue.title,
        projectId: r.issue.projectId,
        projectKey: r.issue.project.key,
        authorName: r.author?.name ?? null,
        createdAt: toIso(r.createdAt),
        snippet: buildIlikeSnippet(r.body, query),
      })),
      total,
    };
  }

  private async searchProjects(
    query: string,
    workspaceIds: string[],
    { limit, offset }: { limit: number; offset: number },
  ): Promise<Paged<SearchProjectDto>> {
    const where: Prisma.ProjectWhereInput = {
      workspaceId: { in: workspaceIds },
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { key: { contains: query, mode: 'insensitive' } },
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: { id: true, key: true, name: true, workspaceId: true },
      }),
      this.prisma.project.count({ where }),
    ]);

    return {
      items: rows.map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        workspaceId: p.workspaceId,
      })),
      total,
    };
  }
}

/** Clamp a caller-supplied page size into [1, SEARCH_MAX_LIMIT]. */
function clampLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return SEARCH_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), SEARCH_MAX_LIMIT);
}

/**
 * `COUNT(*) OVER()` comes back as a Postgres bigint, which Prisma surfaces as a
 * JS BigInt (and which `JSON.stringify` refuses to serialise). Read it off the
 * first row; zero rows means zero matches.
 */
function totalOf(rows: Array<{ total: bigint }>): number {
  return rows.length > 0 ? Number(rows[0].total) : 0;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Post-process a `ts_headline` result:
 *  - drop empties (an issue with no description headlines to `''`);
 *  - collapse runs of whitespace to a single space. Bodies are markdown, so a
 *    raw fragment carries blank lines and indentation that render as a ragged
 *    multi-line blob in a one-line result row and cost bytes for nothing. The
 *    snippet is a preview, not a reproduction — callers that need the real
 *    formatting fetch the record;
 *  - enforce the absolute length guard.
 */
function normalizeSnippet(raw: string | null): SearchSnippet {
  if (!raw) return null;
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return null;
  return collapsed.length > SNIPPET_MAX_CHARS
    ? `${collapsed.slice(0, SNIPPET_MAX_CHARS)}${SEARCH_SNIPPET_ELLIPSIS}`
    : collapsed;
}

/**
 * Snippet for the non-FTS (ILIKE) path: a window of context around the first
 * case-insensitive occurrence of the query, with that occurrence wrapped in the
 * same delimiters `ts_headline` uses. Keeps the DTO contract identical no
 * matter which path served the query, so a caller never has to branch.
 *
 * `indexOf` over a lower-cased copy — NOT a RegExp — so a query containing
 * regex metacharacters (`.*`, `(`, `[a-z]`, a catastrophic-backtracking
 * pattern) is matched literally and can never be interpreted as a pattern.
 */
export function buildIlikeSnippet(
  body: string | null | undefined,
  query: string,
): SearchSnippet {
  if (!body) return null;
  const at = body.toLowerCase().indexOf(query.toLowerCase());
  if (at === -1) {
    // Matched on the title (or the issue key) rather than the body: still hand
    // back the head of the body so the hit can be judged in this one call.
    const head = body.slice(0, SNIPPET_MAX_CHARS).trim();
    if (head.length === 0) return null;
    return body.length > SNIPPET_MAX_CHARS ? `${head}${SEARCH_SNIPPET_ELLIPSIS}` : head;
  }
  const start = Math.max(at - ILIKE_SNIPPET_CONTEXT, 0);
  const end = Math.min(at + query.length + ILIKE_SNIPPET_CONTEXT, body.length);
  const prefix = start > 0 ? SEARCH_SNIPPET_ELLIPSIS : '';
  const suffix = end < body.length ? SEARCH_SNIPPET_ELLIPSIS : '';
  const window =
    body.slice(start, at) +
    SEARCH_HIGHLIGHT_START +
    body.slice(at, at + query.length) +
    SEARCH_HIGHLIGHT_END +
    body.slice(at + query.length, end);
  return `${prefix}${window.trim()}${suffix}`;
}

/** Empty (but fully-shaped) result set — no memberships, or an empty query. */
function emptyResults(query: string, limit: number, offset: number): SearchResultsDto {
  const paging = emptyPaging(limit, offset);
  return {
    query,
    issues: [],
    pages: [],
    projects: [],
    comments: [],
    paging: { issues: paging, pages: paging, projects: paging, comments: paging },
  };
}

/**
 * Parse an issue-key-style query such as "NL-12" or "nl-12" into its project key
 * and number. Returns null when the query is not key-shaped.
 */
export function parseIssueKey(
  query: string,
): { key: string; number: number } | null {
  const match = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(query.trim());
  if (!match) return null;
  const number = Number.parseInt(match[2], 10);
  if (!Number.isFinite(number)) return null;
  return { key: match[1], number };
}

import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertProjectMember } from '../common/membership.util';
import type {
  SearchIssueDto,
  SearchPageDto,
  SearchProjectDto,
  SearchResultsDto,
  StatusCategory,
  IssueType,
} from '@next-lane/shared';

/** Max hits returned per group (issues / projects). */
const RESULT_CAP = 20;

/**
 * Minimum query length required before switching from a simple ILIKE to
 * full-text search. A 1-character query produces extremely broad tsvector
 * results and `websearch_to_tsquery` may silently drop it (e.g. stop words),
 * so we skip FTS and fall back to ILIKE for very short inputs.
 */
const FTS_MIN_LENGTH = 2;

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
}

/** Raw row returned by the FTS $queryRaw for pages. */
interface FtsPageRow {
  id: string;
  title: string;
  projectId: string;
  archived: boolean;
  projectKey: string;
}

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
   */
  async search(userId: string, q?: string, projectId?: string): Promise<SearchResultsDto> {
    const query = (q ?? '').trim();

    // Workspaces the caller can see. This is the only authorization boundary
    // for the result set — never query issues/projects without it.
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    const workspaceIds = memberships.map((m) => m.workspaceId);

    if (workspaceIds.length === 0 || query.length === 0) {
      return { query, issues: [], pages: [], projects: [] };
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

    const [issues, pages, projects] = await Promise.all([
      useFts
        ? this.searchIssuesFts(query, workspaceIds, allowedProjectId)
        : this.searchIssuesIlike(query, workspaceIds, allowedProjectId, keyMatch),
      // Pages have no key-style lookup, so they use FTS for len >= FTS_MIN_LENGTH
      // and ILIKE otherwise — same tenant scoping as issues.
      useFts
        ? this.searchPagesFts(query, workspaceIds, allowedProjectId)
        : this.searchPagesIlike(query, workspaceIds, allowedProjectId),
      // Project search is global within the caller's workspaces, regardless of
      // the projectId filter (which only scopes issues/pages).
      this.searchProjects(query, workspaceIds),
    ]);

    return { query, issues, pages, projects };
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
  ): Promise<{ query: string; pages: SearchPageDto[] }> {
    const query = (q ?? '').trim();

    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    const workspaceIds = memberships.map((m) => m.workspaceId);
    if (workspaceIds.length === 0 || query.length === 0) {
      return { query, pages: [] };
    }

    let allowedProjectId: string | undefined;
    if (projectId) {
      const project = await assertProjectMember(this.prisma, userId, projectId);
      if (!workspaceIds.includes(project.workspaceId)) {
        throw new ForbiddenException('Not a member of this project');
      }
      allowedProjectId = projectId;
    }

    const pages =
      query.length >= FTS_MIN_LENGTH
        ? await this.searchPagesFts(query, workspaceIds, allowedProjectId)
        : await this.searchPagesIlike(query, workspaceIds, allowedProjectId);
    return { query, pages };
  }

  /**
   * Full-text search over pages via the GIN-indexed `searchVector` generated
   * column (title + content). Same tenant scoping as issues — a JOIN on
   * `Project` constrained to the caller's `workspaceIds`, with an optional
   * single-project narrow. `websearch_to_tsquery` is user-input-safe.
   */
  private async searchPagesFts(
    query: string,
    workspaceIds: string[],
    projectId?: string,
  ): Promise<SearchPageDto[]> {
    let rows: FtsPageRow[];
    if (projectId) {
      rows = await this.prisma.$queryRaw<FtsPageRow[]>`
        SELECT pg.id, pg.title, pg."projectId", pg.archived, p.key AS "projectKey"
        FROM "Page" pg
        JOIN "Project" p ON p.id = pg."projectId"
        WHERE p."workspaceId" = ANY(${workspaceIds}::text[])
          AND pg."projectId"  = ${projectId}
          AND pg."searchVector" @@ websearch_to_tsquery('english', ${query})
        ORDER BY ts_rank(pg."searchVector", websearch_to_tsquery('english', ${query})) DESC
        LIMIT ${RESULT_CAP}
      `;
    } else {
      rows = await this.prisma.$queryRaw<FtsPageRow[]>`
        SELECT pg.id, pg.title, pg."projectId", pg.archived, p.key AS "projectKey"
        FROM "Page" pg
        JOIN "Project" p ON p.id = pg."projectId"
        WHERE p."workspaceId" = ANY(${workspaceIds}::text[])
          AND pg."searchVector" @@ websearch_to_tsquery('english', ${query})
        ORDER BY ts_rank(pg."searchVector", websearch_to_tsquery('english', ${query})) DESC
        LIMIT ${RESULT_CAP}
      `;
    }
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      projectId: r.projectId,
      projectKey: r.projectKey,
      archived: r.archived,
    }));
  }

  /** Fallback ILIKE page search for very short queries (title + content). */
  private async searchPagesIlike(
    query: string,
    workspaceIds: string[],
    projectId?: string,
  ): Promise<SearchPageDto[]> {
    const where: Prisma.PageWhereInput = {
      project: { workspaceId: { in: workspaceIds } },
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } },
      ],
    };
    if (projectId) where.projectId = projectId;

    const rows = await this.prisma.page.findMany({
      where,
      take: RESULT_CAP,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        projectId: true,
        archived: true,
        project: { select: { key: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      projectId: r.projectId,
      projectKey: r.project.key,
      archived: r.archived,
    }));
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
   */
  private async searchIssuesFts(
    query: string,
    workspaceIds: string[],
    projectId?: string,
  ): Promise<SearchIssueDto[]> {
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
          s.category       AS "statusCategory"
        FROM "Issue" i
        JOIN "Project" p ON p.id = i."projectId"
        JOIN "Status"  s ON s.id = i."statusId"
        WHERE p."workspaceId" = ANY(${workspaceIds}::text[])
          AND i."projectId"   = ${projectId}
          AND i."searchVector" @@ websearch_to_tsquery('english', ${query})
        ORDER BY ts_rank(i."searchVector", websearch_to_tsquery('english', ${query})) DESC
        LIMIT ${RESULT_CAP}
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
          s.category       AS "statusCategory"
        FROM "Issue" i
        JOIN "Project" p ON p.id = i."projectId"
        JOIN "Status"  s ON s.id = i."statusId"
        WHERE p."workspaceId" = ANY(${workspaceIds}::text[])
          AND i."searchVector" @@ websearch_to_tsquery('english', ${query})
        ORDER BY ts_rank(i."searchVector", websearch_to_tsquery('english', ${query})) DESC
        LIMIT ${RESULT_CAP}
      `;
    }

    return rows.map((r) => ({
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
    }));
  }

  /**
   * Fallback ILIKE search for very short queries and issue-key lookups.
   * Matches title + description via Prisma's `contains`/`mode: insensitive`,
   * and adds a key-style predicate when `keyMatch` is provided.
   */
  private async searchIssuesIlike(
    query: string,
    workspaceIds: string[],
    projectId?: string,
    keyMatch?: { key: string; number: number } | null,
  ): Promise<SearchIssueDto[]> {
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

    const rows = await this.prisma.issue.findMany({
      where,
      take: RESULT_CAP,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        number: true,
        title: true,
        type: true,
        projectId: true,
        statusId: true,
        project: { select: { key: true } },
        status: { select: { name: true, category: true } },
      },
    });

    return rows.map((r) => ({
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
    }));
  }

  private async searchProjects(
    query: string,
    workspaceIds: string[],
  ): Promise<SearchProjectDto[]> {
    const rows = await this.prisma.project.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { key: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: RESULT_CAP,
      orderBy: { name: 'asc' },
      select: { id: true, key: true, name: true, workspaceId: true },
    });

    return rows.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      workspaceId: p.workspaceId,
    }));
  }
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

import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertProjectMember } from '../common/membership.util';
import type {
  SearchIssueDto,
  SearchProjectDto,
  SearchResultsDto,
  StatusCategory,
  IssueType,
} from '@next-lane/shared';

/** Max hits returned per group (issues / projects). */
const RESULT_CAP = 20;

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
      return { query, issues: [], projects: [] };
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

    const [issues, projects] = await Promise.all([
      this.searchIssues(query, workspaceIds, allowedProjectId),
      // Project search is global within the caller's workspaces, regardless of
      // the projectId filter (which only scopes issues).
      this.searchProjects(query, workspaceIds),
    ]);

    return { query, issues, projects };
  }

  private async searchIssues(
    query: string,
    workspaceIds: string[],
    projectId?: string,
  ): Promise<SearchIssueDto[]> {
    const textMatch: Prisma.IssueWhereInput[] = [
      { title: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
    ];

    // Support key-style queries like "NL-12" -> project key "NL", number 12.
    const keyMatch = parseIssueKey(query);
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

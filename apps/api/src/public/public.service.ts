import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShareTokensService } from '../share-tokens/share-tokens.service';
import { DashboardShareTokensService } from '../dashboard-share-tokens/dashboard-share-tokens.service';
import { DashboardsService } from '../dashboards/dashboards.service';
import { toStatusDto } from '../statuses/statuses.service';
import { toIssueDto } from '../issues/issue.mapper';
import { SprintState } from '@next-lane/shared';
import type { PublicBoardDto, PublicDashboardDto } from '@next-lane/shared';

/**
 * Maximum number of issues returned in the public board snapshot.
 * Mirrors the authenticated board cap to keep response sizes predictable.
 */
const PUBLIC_BOARD_ISSUES_CAP = 500;

const issueInclude = {
  status: true,
  assignee: true,
  reporter: true,
  labels: { include: { label: true } },
  project: { select: { key: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.IssueInclude;

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shareTokens: ShareTokensService,
    private readonly dashboardShareTokens: DashboardShareTokensService,
    private readonly dashboards: DashboardsService,
  ) {}

  /**
   * Return a read-only board snapshot for a valid, non-revoked share token.
   * Throws NotFoundException (via ShareTokensService) when the token is
   * unknown or revoked — no information leaks.
   *
   * Only the token's own project data is returned; cross-project access is
   * impossible because projectId is derived entirely from the token row.
   */
  async getPublicBoard(rawToken: string): Promise<PublicBoardDto> {
    // Validates the token and returns the scoped projectId.
    const { projectId } = await this.shareTokens.validateToken(rawToken);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, key: true, name: true },
    });

    // This should not happen (cascade delete would remove the token too), but
    // guard defensively to avoid leaking a null-ref error.
    if (!project) {
      throw new Error('Project not found for share token');
    }

    const statuses = await this.prisma.status.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });

    // Mirror the authenticated board: scope to active sprint + no-sprint issues.
    const rows = await this.prisma.issue.findMany({
      where: {
        projectId,
        project: { archived: false },
        OR: [
          { sprintId: null },
          { sprint: { state: SprintState.ACTIVE } },
        ],
      },
      include: issueInclude,
      orderBy: [{ status: { order: 'asc' } }, { rank: 'asc' }],
      take: PUBLIC_BOARD_ISSUES_CAP + 1,
    });

    const truncated = rows.length > PUBLIC_BOARD_ISSUES_CAP;
    const issues = truncated ? rows.slice(0, PUBLIC_BOARD_ISSUES_CAP) : rows;

    return {
      project: { id: project.id, key: project.key, name: project.name },
      statuses: statuses.map(toStatusDto),
      issues: issues.map(toIssueDto),
    };
  }

  /**
   * Return a read-only, fully-evaluated dashboard snapshot for a valid,
   * non-revoked dashboard share token. Throws NotFoundException (via
   * `DashboardShareTokensService`) when the token is unknown or revoked — no
   * information leaks.
   *
   * Every gadget is evaluated with no signed-in identity — a gadget whose
   * NLQL calls `me()` degrades to an explicit per-gadget `error` rather than
   * crashing or silently resolving to "unassigned"; see
   * `DashboardsService.evaluateGadget`'s `me()`-degradation contract.
   */
  async getPublicDashboard(rawToken: string): Promise<PublicDashboardDto> {
    const { dashboardId } = await this.dashboardShareTokens.validateToken(rawToken);
    const { dashboard, project, gadgets, issuesTruncated } =
      await this.dashboards.getPublicDashboardData(dashboardId);

    return {
      project: { id: project.id, key: project.key, name: project.name },
      dashboard: { id: dashboard.id, name: dashboard.name },
      gadgets,
      issuesTruncated,
    };
  }
}

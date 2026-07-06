import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertProjectRole } from '../common/membership.util';
import { Role } from '@next-lane/shared';
import {
  generateShareToken,
  hashShareToken,
} from '../share-tokens/share-tokens.service';
import type {
  DashboardShareTokenDto,
  CreateDashboardShareTokenResponse,
} from './dto/dashboard-share-token.dto';

function toDto(row: {
  id: string;
  dashboardId: string;
  createdById: string;
  createdAt: Date;
  revokedAt: Date | null;
}): DashboardShareTokenDto {
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/**
 * Public share links for dashboards — the dashboard analogue of
 * `ShareTokensService`, backed by its own `DashboardShareToken` table (see
 * schema.prisma for why this is a parallel model rather than a widened
 * `ShareToken`). Every method resolves the dashboard's owning project and
 * defers authorization to `assertProjectRole`, exactly like the board
 * share-token surface.
 */
@Injectable()
export class DashboardShareTokensService {
  constructor(private readonly prisma: PrismaService) {}

  /** Look up a dashboard's projectId, or throw NotFoundException. */
  private async getDashboardProjectId(dashboardId: string): Promise<string> {
    const dashboard = await this.prisma.dashboard.findUnique({
      where: { id: dashboardId },
      select: { projectId: true },
    });
    if (!dashboard) throw new NotFoundException('Dashboard not found');
    return dashboard.projectId;
  }

  /**
   * Mint a new share token for a dashboard. ADMIN-only (on the dashboard's
   * project) — enforced here.
   *
   * Returns the raw token once — it is never stored, only its SHA-256 hash is
   * persisted. The caller must copy it immediately.
   */
  async create(
    userId: string,
    dashboardId: string,
  ): Promise<CreateDashboardShareTokenResponse> {
    const projectId = await this.getDashboardProjectId(dashboardId);
    await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);

    const rawToken = generateShareToken();
    const tokenHash = hashShareToken(rawToken);

    const record = await this.prisma.dashboardShareToken.create({
      data: { dashboardId, tokenHash, createdById: userId },
    });

    return {
      id: record.id,
      dashboardId: record.dashboardId,
      rawToken,
      createdAt: record.createdAt.toISOString(),
    };
  }

  /**
   * List all share tokens for a dashboard (including revoked). ADMIN-only.
   * The raw token is never returned here.
   */
  async findAll(
    userId: string,
    dashboardId: string,
  ): Promise<DashboardShareTokenDto[]> {
    const projectId = await this.getDashboardProjectId(dashboardId);
    await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);

    const rows = await this.prisma.dashboardShareToken.findMany({
      where: { dashboardId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDto);
  }

  /**
   * Revoke (soft-delete) a share token. ADMIN-only.
   *
   * Returns 404 if the token does not exist or belongs to a different
   * dashboard (to avoid leaking token IDs across dashboards).
   */
  async revoke(
    userId: string,
    dashboardId: string,
    tokenId: string,
  ): Promise<DashboardShareTokenDto> {
    const projectId = await this.getDashboardProjectId(dashboardId);
    await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);

    const token = await this.prisma.dashboardShareToken.findUnique({
      where: { id: tokenId },
    });
    if (!token || token.dashboardId !== dashboardId) {
      throw new NotFoundException('Share token not found.');
    }

    const updated = await this.prisma.dashboardShareToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
    return toDto(updated);
  }

  /**
   * Validate a raw share token and return its dashboardId.
   *
   * Throws NotFoundException when the token is missing or revoked so we give
   * identical 404 responses to both invalid and revoked tokens (no oracle).
   */
  async validateToken(rawToken: string): Promise<{ dashboardId: string }> {
    const hash = hashShareToken(rawToken);
    const record = await this.prisma.dashboardShareToken.findUnique({
      where: { tokenHash: hash },
    });

    if (!record || record.revokedAt !== null) {
      throw new NotFoundException('Share link not found or has been revoked.');
    }

    return { dashboardId: record.dashboardId };
  }
}

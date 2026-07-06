/**
 * Unit tests for PublicService — the entry point for both public share
 * surfaces (board + dashboard). All DB/service calls are mocked.
 *
 * Covered scenarios:
 *   getPublicBoard:
 *     1. valid token — returns the scoped project/statuses/issues.
 *     2. invalid/revoked token — propagates NotFoundException (no oracle).
 *   getPublicDashboard:
 *     3. valid token — validates via DashboardShareTokensService then
 *        delegates to DashboardsService.getPublicDashboardData.
 *     4. revoked/unknown token — propagates NotFoundException; dashboard
 *        data is never evaluated (fails before the expensive read).
 *     5. a me()-referencing gadget's error surfaces unchanged in the
 *        response (degradation happens in DashboardsService; PublicService
 *        must not swallow or rewrite it).
 */

import { NotFoundException } from '@nestjs/common';
import { PublicService } from './public.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ShareTokensService } from '../share-tokens/share-tokens.service';
import type { DashboardShareTokensService } from '../dashboard-share-tokens/dashboard-share-tokens.service';
import type { DashboardsService } from '../dashboards/dashboards.service';

function makeShareTokens() {
  return { validateToken: jest.fn() } as unknown as ShareTokensService & {
    validateToken: jest.Mock;
  };
}

function makeDashboardShareTokens() {
  return { validateToken: jest.fn() } as unknown as DashboardShareTokensService & {
    validateToken: jest.Mock;
  };
}

function makeDashboards() {
  return { getPublicDashboardData: jest.fn() } as unknown as DashboardsService & {
    getPublicDashboardData: jest.Mock;
  };
}

function makePrisma() {
  return {
    project: { findUnique: jest.fn() },
    status: { findMany: jest.fn().mockResolvedValue([]) },
    issue: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService & {
    project: { findUnique: jest.Mock };
    status: { findMany: jest.Mock };
    issue: { findMany: jest.Mock };
  };
}

describe('PublicService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let shareTokens: ReturnType<typeof makeShareTokens>;
  let dashboardShareTokens: ReturnType<typeof makeDashboardShareTokens>;
  let dashboards: ReturnType<typeof makeDashboards>;
  let service: PublicService;

  beforeEach(() => {
    prisma = makePrisma();
    shareTokens = makeShareTokens();
    dashboardShareTokens = makeDashboardShareTokens();
    dashboards = makeDashboards();
    service = new PublicService(prisma, shareTokens, dashboardShareTokens, dashboards);
  });

  // ── getPublicBoard ─────────────────────────────────────────────────────

  describe('getPublicBoard', () => {
    it('returns the scoped project/statuses/issues for a valid token', async () => {
      shareTokens.validateToken.mockResolvedValue({ projectId: 'proj-1' });
      prisma.project.findUnique.mockResolvedValue({
        id: 'proj-1',
        key: 'NL',
        name: 'Next Lane',
      });
      prisma.status.findMany.mockResolvedValue([]);
      prisma.issue.findMany.mockResolvedValue([]);

      const result = await service.getPublicBoard('nls_valid');

      expect(shareTokens.validateToken).toHaveBeenCalledWith('nls_valid');
      expect(result.project).toEqual({ id: 'proj-1', key: 'NL', name: 'Next Lane' });
    });

    it('propagates NotFoundException for an invalid/revoked token (no oracle)', async () => {
      shareTokens.validateToken.mockRejectedValue(
        new NotFoundException('Share link not found or has been revoked.'),
      );

      await expect(service.getPublicBoard('nls_bad')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.project.findUnique).not.toHaveBeenCalled();
    });
  });

  // ── getPublicDashboard ─────────────────────────────────────────────────

  describe('getPublicDashboard', () => {
    it('validates the token then delegates to DashboardsService.getPublicDashboardData', async () => {
      dashboardShareTokens.validateToken.mockResolvedValue({ dashboardId: 'dash-1' });
      dashboards.getPublicDashboardData.mockResolvedValue({
        dashboard: { id: 'dash-1', name: 'Team overview' },
        project: { id: 'proj-1', key: 'NL', name: 'Next Lane' },
        gadgets: [{ gadgetId: 'g-1', title: 'Open issues', visualization: 'STAT', config: {}, data: { kind: 'STAT', count: 3 } }],
        issuesTruncated: false,
      });

      const result = await service.getPublicDashboard('nls_valid');

      expect(dashboardShareTokens.validateToken).toHaveBeenCalledWith('nls_valid');
      expect(dashboards.getPublicDashboardData).toHaveBeenCalledWith('dash-1');
      expect(result.dashboard).toEqual({ id: 'dash-1', name: 'Team overview' });
      expect(result.project).toEqual({ id: 'proj-1', key: 'NL', name: 'Next Lane' });
      expect(result.gadgets).toHaveLength(1);
      expect(result.issuesTruncated).toBe(false);
    });

    it('propagates NotFoundException for a revoked/unknown token without ever evaluating dashboard data', async () => {
      dashboardShareTokens.validateToken.mockRejectedValue(
        new NotFoundException('Share link not found or has been revoked.'),
      );

      await expect(service.getPublicDashboard('nls_bad')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(dashboards.getPublicDashboardData).not.toHaveBeenCalled();
    });

    it('surfaces a me()-degraded gadget error unchanged (no rewriting/swallowing)', async () => {
      dashboardShareTokens.validateToken.mockResolvedValue({ dashboardId: 'dash-1' });
      dashboards.getPublicDashboardData.mockResolvedValue({
        dashboard: { id: 'dash-1', name: 'Team overview' },
        project: { id: 'proj-1', key: 'NL', name: 'Next Lane' },
        gadgets: [
          {
            gadgetId: 'g-1',
            title: 'My open issues',
            visualization: 'TABLE',
            config: {},
            error:
              'This gadget uses me() and needs a signed-in user — not available on a public dashboard link.',
          },
        ],
        issuesTruncated: false,
      });

      const result = await service.getPublicDashboard('nls_valid');

      expect(result.gadgets[0].data).toBeUndefined();
      expect(result.gadgets[0].error).toMatch(/me\(\)/);
    });
  });
});

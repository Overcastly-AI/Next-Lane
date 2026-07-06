/**
 * Unit tests for DashboardShareTokensService — the dashboard analogue of
 * ShareTokensService (see share-tokens/share-tokens.service.spec.ts, which
 * this mirrors scenario-for-scenario).
 *
 * All DB calls are mocked — no real Postgres in the test path.
 *
 * Covered scenarios:
 *   1. create() — ADMIN can mint; raw token shown once, only hash stored.
 *   2. create() — non-ADMIN is rejected (ForbiddenException via assertProjectRole).
 *   3. create() — missing dashboard returns NotFoundException.
 *   4. findAll() — returns metadata list, never the hash or raw token.
 *   5. revoke() — sets revokedAt; wrong dashboardId returns NotFoundException.
 *   6. validateToken() — valid token returns dashboardId.
 *   7. validateToken() — revoked token returns NotFoundException.
 *   8. validateToken() — unknown token returns NotFoundException.
 *   9. Tenant isolation: validateToken() cannot return another dashboard's data.
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DashboardShareTokensService } from './dashboard-share-tokens.service';
import type { PrismaService } from '../prisma/prisma.service';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

interface MockPrisma {
  dashboard: { findUnique: jest.Mock };
  dashboardShareToken: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  project: { findUnique: jest.Mock };
  membership: { findUnique: jest.Mock };
  projectMembership: { findUnique: jest.Mock };
}

function makePrisma(): MockPrisma {
  return {
    dashboard: { findUnique: jest.fn() },
    dashboardShareToken: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    project: { findUnique: jest.fn() },
    membership: { findUnique: jest.fn() },
    projectMembership: { findUnique: jest.fn().mockResolvedValue(null) },
  };
}

const ADMIN_USER = { id: 'user-admin', email: 'admin@example.com', name: 'Admin' };
const MEMBER_USER = { id: 'user-member', email: 'member@example.com', name: 'Member' };
const PROJECT = { id: 'proj-1', workspaceId: 'ws-1', name: 'Test', key: 'T', description: null, leadId: null, archived: false, createdAt: new Date() };
const WORKSPACE = { id: 'ws-1', name: 'WS', slug: 'ws', createdAt: new Date(), updatedAt: new Date() };
const PROJECT_WITH_WORKSPACE = { ...PROJECT, workspace: WORKSPACE };
const DASHBOARD_ID = 'dash-1';

describe('DashboardShareTokensService', () => {
  let prisma: MockPrisma;
  let service: DashboardShareTokensService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new DashboardShareTokensService(prisma as unknown as PrismaService);
    prisma.dashboard.findUnique.mockResolvedValue({ projectId: PROJECT.id });
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('ADMIN can mint a token; raw token is returned once, only hash stored', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_WITH_WORKSPACE);
      prisma.membership.findUnique.mockResolvedValue({ role: 'ADMIN', workspace: WORKSPACE });
      const createdAt = new Date();
      prisma.dashboardShareToken.create.mockResolvedValue({
        id: 'tok-1',
        dashboardId: DASHBOARD_ID,
        tokenHash: 'stored-hash',
        createdById: ADMIN_USER.id,
        createdAt,
        revokedAt: null,
      });

      const result = await service.create(ADMIN_USER.id, DASHBOARD_ID);

      expect(result.rawToken).toMatch(/^nls_/);
      expect(result.id).toBe('tok-1');
      expect(result.dashboardId).toBe(DASHBOARD_ID);

      const stored = prisma.dashboardShareToken.create.mock.calls[0][0].data as {
        tokenHash: string;
      };
      expect(stored.tokenHash).toBe(sha256(result.rawToken));
      expect(stored.tokenHash).not.toBe(result.rawToken);
    });

    it('non-ADMIN (MEMBER) is rejected with ForbiddenException', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_WITH_WORKSPACE);
      prisma.membership.findUnique.mockResolvedValue({ role: 'MEMBER', workspace: WORKSPACE });

      await expect(service.create(MEMBER_USER.id, DASHBOARD_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.dashboardShareToken.create).not.toHaveBeenCalled();
    });

    it('missing dashboard returns NotFoundException', async () => {
      prisma.dashboard.findUnique.mockResolvedValue(null);

      await expect(service.create(ADMIN_USER.id, 'nonexistent')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.dashboardShareToken.create).not.toHaveBeenCalled();
    });
  });

  // ── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns metadata list scoped to the dashboard', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_WITH_WORKSPACE);
      prisma.membership.findUnique.mockResolvedValue({ role: 'ADMIN', workspace: WORKSPACE });
      const now = new Date();
      prisma.dashboardShareToken.findMany.mockResolvedValue([
        {
          id: 'tok-1',
          dashboardId: DASHBOARD_ID,
          tokenHash: 'hash-should-never-appear',
          createdById: ADMIN_USER.id,
          createdAt: now,
          revokedAt: null,
        },
      ]);

      const result = await service.findAll(ADMIN_USER.id, DASHBOARD_ID);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('tok-1');
      expect(result[0].dashboardId).toBe(DASHBOARD_ID);
      expect(result[0].revokedAt).toBeNull();
      expect((result[0] as unknown as Record<string, unknown>).tokenHash).toBeUndefined();
      expect((result[0] as unknown as Record<string, unknown>).rawToken).toBeUndefined();
    });

    it('non-ADMIN is rejected', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_WITH_WORKSPACE);
      prisma.membership.findUnique.mockResolvedValue({ role: 'MEMBER', workspace: WORKSPACE });

      await expect(service.findAll(MEMBER_USER.id, DASHBOARD_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // ── revoke ──────────────────────────────────────────────────────────────────

  describe('revoke', () => {
    it('sets revokedAt for a token belonging to the dashboard', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_WITH_WORKSPACE);
      prisma.membership.findUnique.mockResolvedValue({ role: 'ADMIN', workspace: WORKSPACE });
      const now = new Date();
      prisma.dashboardShareToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        dashboardId: DASHBOARD_ID,
        createdById: ADMIN_USER.id,
        revokedAt: null,
      });
      prisma.dashboardShareToken.update.mockResolvedValue({
        id: 'tok-1',
        dashboardId: DASHBOARD_ID,
        createdById: ADMIN_USER.id,
        createdAt: now,
        revokedAt: now,
      });

      const result = await service.revoke(ADMIN_USER.id, DASHBOARD_ID, 'tok-1');

      expect(result.revokedAt).not.toBeNull();
      expect(prisma.dashboardShareToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tok-1' },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    it('returns NotFoundException when tokenId belongs to a different dashboard', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_WITH_WORKSPACE);
      prisma.membership.findUnique.mockResolvedValue({ role: 'ADMIN', workspace: WORKSPACE });
      prisma.dashboardShareToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        dashboardId: 'other-dashboard', // wrong dashboard
        createdById: ADMIN_USER.id,
        revokedAt: null,
      });

      await expect(
        service.revoke(ADMIN_USER.id, DASHBOARD_ID, 'tok-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.dashboardShareToken.update).not.toHaveBeenCalled();
    });

    it('returns NotFoundException for a missing token (no oracle)', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_WITH_WORKSPACE);
      prisma.membership.findUnique.mockResolvedValue({ role: 'ADMIN', workspace: WORKSPACE });
      prisma.dashboardShareToken.findUnique.mockResolvedValue(null);

      await expect(
        service.revoke(ADMIN_USER.id, DASHBOARD_ID, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── validateToken ────────────────────────────────────────────────────────────

  describe('validateToken', () => {
    const RAW = 'nls_test_raw_token_32_bytes_here_x';

    it('returns dashboardId for a valid token', async () => {
      prisma.dashboardShareToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        dashboardId: DASHBOARD_ID,
        tokenHash: sha256(RAW),
        revokedAt: null,
      });

      const result = await service.validateToken(RAW);
      expect(result.dashboardId).toBe(DASHBOARD_ID);
    });

    it('looks up by SHA-256 hash of the raw token', async () => {
      prisma.dashboardShareToken.findUnique.mockResolvedValue(null);

      await expect(service.validateToken(RAW)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.dashboardShareToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tokenHash: sha256(RAW) } }),
      );
    });

    it('rejects a revoked token (NotFoundException — same as unknown)', async () => {
      prisma.dashboardShareToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        dashboardId: DASHBOARD_ID,
        tokenHash: sha256(RAW),
        revokedAt: new Date(Date.now() - 1_000), // revoked
      });

      await expect(service.validateToken(RAW)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an unknown token', async () => {
      prisma.dashboardShareToken.findUnique.mockResolvedValue(null);

      await expect(service.validateToken('nls_bogus')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('tenant isolation: token can only resolve its own dashboardId', async () => {
      const otherRaw = 'nls_other_dashboard_token_32_byte';
      prisma.dashboardShareToken.findUnique.mockResolvedValue({
        id: 'tok-2',
        dashboardId: 'dash-other',
        tokenHash: sha256(otherRaw),
        revokedAt: null,
      });

      const result = await service.validateToken(otherRaw);
      expect(result.dashboardId).toBe('dash-other');
      expect(result.dashboardId).not.toBe(DASHBOARD_ID);
    });
  });
});

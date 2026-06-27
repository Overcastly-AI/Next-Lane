/**
 * Unit tests for ShareTokensService.
 *
 * All DB calls are mocked — no real Postgres in the test path.
 *
 * Covered scenarios:
 *   1. create() — ADMIN can mint; raw token shown once, only hash stored.
 *   2. create() — non-ADMIN is rejected (ForbiddenException via assertProjectRole).
 *   3. findAll() — returns metadata list, never the hash or raw token.
 *   4. revoke() — sets revokedAt; wrong projectId returns NotFoundException.
 *   5. validateToken() — valid token returns projectId.
 *   6. validateToken() — revoked token returns NotFoundException.
 *   7. validateToken() — unknown token returns NotFoundException.
 *   8. Tenant isolation: validateToken() cannot return another project's data.
 *   9. generateShareToken() — starts with nls_ prefix and is unique per call.
 *   10. hashShareToken() — returns SHA-256 hex digest.
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ShareTokensService,
  generateShareToken,
  hashShareToken,
  SHARE_TOKEN_PREFIX,
} from './share-tokens.service';
import type { PrismaService } from '../prisma/prisma.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

interface MockPrisma {
  shareToken: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  project: { findUnique: jest.Mock };
  membership: { findUnique: jest.Mock };
}

function makePrisma(): MockPrisma {
  return {
    shareToken: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    project: { findUnique: jest.fn() },
    membership: { findUnique: jest.fn() },
  };
}

const ADMIN_USER = { id: 'user-admin', email: 'admin@example.com', name: 'Admin' };
const MEMBER_USER = { id: 'user-member', email: 'member@example.com', name: 'Member' };
const PROJECT = { id: 'proj-1', workspaceId: 'ws-1', name: 'Test', key: 'T', description: null, leadId: null, archived: false, createdAt: new Date() };
const WORKSPACE = { id: 'ws-1', name: 'WS', slug: 'ws', createdAt: new Date(), updatedAt: new Date() };
const PROJECT_WITH_WORKSPACE = { ...PROJECT, workspace: WORKSPACE };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('generateShareToken', () => {
  it('starts with the nls_ prefix', () => {
    expect(generateShareToken().startsWith(SHARE_TOKEN_PREFIX)).toBe(true);
  });

  it('generates unique values each call', () => {
    expect(generateShareToken()).not.toBe(generateShareToken());
  });

  it('contains no base64 padding', () => {
    const token = generateShareToken();
    expect(token).not.toContain('=');
    expect(token.slice(SHARE_TOKEN_PREFIX.length)).not.toMatch(/[+/]/);
  });
});

describe('hashShareToken', () => {
  it('returns the SHA-256 hex digest', () => {
    expect(hashShareToken('nls_test')).toBe(sha256('nls_test'));
  });

  it('produces a 64-char hex string', () => {
    expect(hashShareToken('nls_anything')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('ShareTokensService', () => {
  let prisma: MockPrisma;
  let service: ShareTokensService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ShareTokensService(prisma as unknown as PrismaService);
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('ADMIN can mint a token; raw token is returned once, only hash stored', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_WITH_WORKSPACE);
      prisma.membership.findUnique.mockResolvedValue({ role: 'ADMIN', workspace: WORKSPACE });
      const createdAt = new Date();
      prisma.shareToken.create.mockResolvedValue({
        id: 'tok-1',
        projectId: PROJECT.id,
        tokenHash: 'stored-hash',
        createdById: ADMIN_USER.id,
        createdAt,
        revokedAt: null,
      });

      const result = await service.create(ADMIN_USER.id, PROJECT.id);

      expect(result.rawToken).toMatch(/^nls_/);
      expect(result.id).toBe('tok-1');
      expect(result.projectId).toBe(PROJECT.id);

      // Only the hash should be stored, not the raw token.
      const stored = prisma.shareToken.create.mock.calls[0][0].data as {
        tokenHash: string;
      };
      expect(stored.tokenHash).toBe(sha256(result.rawToken));
      expect(stored.tokenHash).not.toBe(result.rawToken);
    });

    it('non-ADMIN (MEMBER) is rejected with ForbiddenException', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_WITH_WORKSPACE);
      prisma.membership.findUnique.mockResolvedValue({ role: 'MEMBER', workspace: WORKSPACE });

      await expect(service.create(MEMBER_USER.id, PROJECT.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.shareToken.create).not.toHaveBeenCalled();
    });
  });

  // ── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns metadata list scoped to the project', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_WITH_WORKSPACE);
      prisma.membership.findUnique.mockResolvedValue({ role: 'ADMIN', workspace: WORKSPACE });
      const now = new Date();
      prisma.shareToken.findMany.mockResolvedValue([
        {
          id: 'tok-1',
          projectId: PROJECT.id,
          tokenHash: 'hash-should-never-appear',
          createdById: ADMIN_USER.id,
          createdAt: now,
          revokedAt: null,
        },
      ]);

      const result = await service.findAll(ADMIN_USER.id, PROJECT.id);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('tok-1');
      expect(result[0].projectId).toBe(PROJECT.id);
      expect(result[0].revokedAt).toBeNull();
      // tokenHash and rawToken must not appear
      expect((result[0] as unknown as Record<string, unknown>).tokenHash).toBeUndefined();
      expect((result[0] as unknown as Record<string, unknown>).rawToken).toBeUndefined();
    });

    it('non-ADMIN is rejected', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_WITH_WORKSPACE);
      prisma.membership.findUnique.mockResolvedValue({ role: 'MEMBER', workspace: WORKSPACE });

      await expect(service.findAll(MEMBER_USER.id, PROJECT.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // ── revoke ──────────────────────────────────────────────────────────────────

  describe('revoke', () => {
    it('sets revokedAt for a token belonging to the project', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_WITH_WORKSPACE);
      prisma.membership.findUnique.mockResolvedValue({ role: 'ADMIN', workspace: WORKSPACE });
      const now = new Date();
      prisma.shareToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        projectId: PROJECT.id,
        createdById: ADMIN_USER.id,
        revokedAt: null,
      });
      prisma.shareToken.update.mockResolvedValue({
        id: 'tok-1',
        projectId: PROJECT.id,
        createdById: ADMIN_USER.id,
        createdAt: now,
        revokedAt: now,
      });

      const result = await service.revoke(ADMIN_USER.id, PROJECT.id, 'tok-1');

      expect(result.revokedAt).not.toBeNull();
      expect(prisma.shareToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tok-1' },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    it('returns NotFoundException when tokenId belongs to a different project', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_WITH_WORKSPACE);
      prisma.membership.findUnique.mockResolvedValue({ role: 'ADMIN', workspace: WORKSPACE });
      prisma.shareToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        projectId: 'other-project', // wrong project
        createdById: ADMIN_USER.id,
        revokedAt: null,
      });

      await expect(service.revoke(ADMIN_USER.id, PROJECT.id, 'tok-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.shareToken.update).not.toHaveBeenCalled();
    });

    it('returns NotFoundException for a missing token (no oracle)', async () => {
      prisma.project.findUnique.mockResolvedValue(PROJECT_WITH_WORKSPACE);
      prisma.membership.findUnique.mockResolvedValue({ role: 'ADMIN', workspace: WORKSPACE });
      prisma.shareToken.findUnique.mockResolvedValue(null);

      await expect(service.revoke(ADMIN_USER.id, PROJECT.id, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ── validateToken ────────────────────────────────────────────────────────────

  describe('validateToken', () => {
    const RAW = 'nls_test_raw_token_32_bytes_here_x';

    it('returns projectId for a valid token', async () => {
      prisma.shareToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        projectId: PROJECT.id,
        tokenHash: sha256(RAW),
        revokedAt: null,
      });

      const result = await service.validateToken(RAW);
      expect(result.projectId).toBe(PROJECT.id);
    });

    it('looks up by SHA-256 hash of the raw token', async () => {
      prisma.shareToken.findUnique.mockResolvedValue(null);

      await expect(service.validateToken(RAW)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.shareToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tokenHash: sha256(RAW) } }),
      );
    });

    it('rejects a revoked token (NotFoundException — same as unknown)', async () => {
      prisma.shareToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        projectId: PROJECT.id,
        tokenHash: sha256(RAW),
        revokedAt: new Date(Date.now() - 1_000), // revoked
      });

      await expect(service.validateToken(RAW)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an unknown token', async () => {
      prisma.shareToken.findUnique.mockResolvedValue(null);

      await expect(service.validateToken('nls_bogus')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('tenant isolation: token can only resolve its own projectId', async () => {
      // Simulate two tokens for two projects; ensure the lookup is hash-scoped.
      const otherRaw = 'nls_other_project_token_32_bytes_';
      prisma.shareToken.findUnique.mockResolvedValue({
        id: 'tok-2',
        projectId: 'proj-other',
        tokenHash: sha256(otherRaw),
        revokedAt: null,
      });

      const result = await service.validateToken(otherRaw);
      // Returns only the scoped project, not PROJECT.id.
      expect(result.projectId).toBe('proj-other');
      expect(result.projectId).not.toBe(PROJECT.id);
    });
  });
});

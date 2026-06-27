/**
 * Unit tests for ApiTokensService.
 *
 * All DB calls are mocked — no real Postgres in the test path.
 *
 * Covered scenarios:
 *   1. create() — raw token shown once, only hash stored, never the raw value.
 *   2. findAll() — returns metadata only, ordered newest-first; never the hash.
 *   3. revoke() — sets revokedAt; a user cannot revoke another user's token.
 *   4. validateRawToken() — valid PAT authenticates as the owning user.
 *   5. validateRawToken() — revoked token is rejected (UnauthorizedException).
 *   6. validateRawToken() — expired token is rejected (UnauthorizedException).
 *   7. validateRawToken() — unknown token is rejected (UnauthorizedException).
 *   8. isPat() — correctly detects the nlp_ prefix.
 */

import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  ApiTokensService,
  generateRawToken,
  hashToken,
  PAT_PREFIX,
} from './api-tokens.service';
import type { PrismaService } from '../prisma/prisma.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

interface MockPrisma {
  apiToken: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
}

function makePrisma(): MockPrisma {
  return {
    apiToken: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
}

const USER = { id: 'user-1', email: 'alice@example.com', name: 'Alice' };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ApiTokensService', () => {
  let prisma: MockPrisma;
  let service: ApiTokensService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ApiTokensService(prisma as unknown as PrismaService);
  });

  // ── generateRawToken / hashToken helpers ────────────────────────────────────

  describe('generateRawToken', () => {
    it('starts with the nlp_ prefix', () => {
      const token = generateRawToken();
      expect(token.startsWith(PAT_PREFIX)).toBe(true);
    });

    it('is at least 44 chars long (prefix + 32 bytes base64url)', () => {
      const token = generateRawToken();
      expect(token.length).toBeGreaterThanOrEqual(44);
    });

    it('generates unique values each call', () => {
      const a = generateRawToken();
      const b = generateRawToken();
      expect(a).not.toBe(b);
    });

    it('contains no base64 padding characters', () => {
      const token = generateRawToken();
      expect(token).not.toContain('=');
      // Standard base64 chars forbidden in base64url:
      expect(token.slice(PAT_PREFIX.length)).not.toMatch(/[+/]/);
    });
  });

  describe('hashToken', () => {
    it('returns the SHA-256 hex digest of the raw token', () => {
      const raw = 'nlp_test_value';
      expect(hashToken(raw)).toBe(sha256(raw));
    });

    it('produces a 64-character hex string', () => {
      expect(hashToken('nlp_anything')).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ── isPat ────────────────────────────────────────────────────────────────────

  describe('isPat', () => {
    it('returns true for tokens starting with nlp_', () => {
      expect(ApiTokensService.isPat('nlp_abc123')).toBe(true);
    });

    it('returns false for JWT-shaped tokens', () => {
      expect(ApiTokensService.isPat('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(ApiTokensService.isPat('')).toBe(false);
    });
  });

  // ── create ───────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('returns the raw token once, stores only the hash', async () => {
      const createdAt = new Date();
      prisma.apiToken.create.mockResolvedValue({
        id: 'tok-1',
        name: 'CI token',
        tokenHash: 'stored-hash',
        expiresAt: null,
        createdAt,
        revokedAt: null,
        lastUsedAt: null,
      });

      const result = await service.create(USER.id, { name: 'CI token' });

      // Raw token is in the response.
      expect(result.rawToken).toBeDefined();
      expect(result.rawToken.startsWith(PAT_PREFIX)).toBe(true);

      // The create call stored the SHA-256 hash of the raw token, NOT the raw token.
      const callData = prisma.apiToken.create.mock.calls[0][0].data as {
        userId: string;
        name: string;
        tokenHash: string;
        expiresAt: Date | null;
      };
      expect(callData.userId).toBe(USER.id);
      expect(callData.name).toBe('CI token');
      // The hash must equal sha256 of the returned raw token.
      expect(callData.tokenHash).toBe(sha256(result.rawToken));
      // The raw token itself is NOT stored.
      expect(callData.tokenHash).not.toBe(result.rawToken);
    });

    it('sets expiresAt when provided', async () => {
      const expiresAt = new Date(Date.now() + 86400_000);
      prisma.apiToken.create.mockResolvedValue({
        id: 'tok-2',
        name: 'Expiring token',
        tokenHash: 'h',
        expiresAt,
        createdAt: new Date(),
        revokedAt: null,
        lastUsedAt: null,
      });

      const result = await service.create(USER.id, {
        name: 'Expiring token',
        expiresAt: expiresAt.toISOString(),
      });

      expect(result.expiresAt).toBe(expiresAt.toISOString());
    });
  });

  // ── findAll ──────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns metadata only — no rawToken, no tokenHash', async () => {
      const now = new Date();
      prisma.apiToken.findMany.mockResolvedValue([
        {
          id: 'tok-1',
          name: 'My token',
          tokenHash: 'secret-hash-never-exposed',
          lastUsedAt: null,
          expiresAt: null,
          createdAt: now,
          revokedAt: null,
          userId: USER.id,
        },
      ]);

      const result = await service.findAll(USER.id);

      expect(result).toHaveLength(1);
      const tok = result[0];
      expect(tok.id).toBe('tok-1');
      expect(tok.name).toBe('My token');
      expect(tok.lastUsedAt).toBeNull();
      expect(tok.expiresAt).toBeNull();
      expect(tok.revokedAt).toBeNull();
      // tokenHash must NOT be in the response.
      expect((tok as unknown as Record<string, unknown>).tokenHash).toBeUndefined();
      // rawToken must NOT be in the response.
      expect((tok as unknown as Record<string, unknown>).rawToken).toBeUndefined();
    });

    it('scopes the query to the calling user', async () => {
      prisma.apiToken.findMany.mockResolvedValue([]);
      await service.findAll('user-42');
      expect(prisma.apiToken.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-42' } }),
      );
    });
  });

  // ── revoke ───────────────────────────────────────────────────────────────────

  describe('revoke', () => {
    it('sets revokedAt for a token the user owns', async () => {
      prisma.apiToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        userId: USER.id,
        revokedAt: null,
      });
      prisma.apiToken.update.mockResolvedValue({ id: 'tok-1' });

      const result = await service.revoke(USER.id, 'tok-1');

      expect(result).toEqual({ id: 'tok-1' });
      expect(prisma.apiToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tok-1' },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    it('throws NotFoundException when the token does not exist', async () => {
      prisma.apiToken.findUnique.mockResolvedValue(null);

      await expect(service.revoke(USER.id, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.apiToken.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the token belongs to another user (no ownership leak)', async () => {
      prisma.apiToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        userId: 'other-user',
        revokedAt: null,
      });

      await expect(service.revoke(USER.id, 'tok-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.apiToken.update).not.toHaveBeenCalled();
    });
  });

  // ── validateRawToken ─────────────────────────────────────────────────────────

  describe('validateRawToken', () => {
    const RAW = 'nlp_test_raw_token_32_bytes_here_x';

    function makeRecord(overrides: Partial<{
      revokedAt: Date | null;
      expiresAt: Date | null;
    }> = {}) {
      return {
        id: 'tok-1',
        tokenHash: sha256(RAW),
        revokedAt: null,
        expiresAt: null,
        user: USER,
        ...overrides,
      };
    }

    it('returns the user when the token is valid', async () => {
      prisma.apiToken.findUnique.mockResolvedValue(makeRecord());
      prisma.apiToken.update.mockResolvedValue({});

      const result = await service.validateRawToken(RAW);

      expect(result).toEqual(USER);
    });

    it('looks up by SHA-256 hash of the raw token', async () => {
      prisma.apiToken.findUnique.mockResolvedValue(null);

      await expect(service.validateRawToken(RAW)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      expect(prisma.apiToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: sha256(RAW) },
        }),
      );
    });

    it('rejects a revoked token', async () => {
      prisma.apiToken.findUnique.mockResolvedValue(
        makeRecord({ revokedAt: new Date(Date.now() - 1_000) }),
      );

      await expect(service.validateRawToken(RAW)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects an expired token', async () => {
      prisma.apiToken.findUnique.mockResolvedValue(
        makeRecord({ expiresAt: new Date(Date.now() - 1) }),
      );

      await expect(service.validateRawToken(RAW)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects an unknown token (not in DB)', async () => {
      prisma.apiToken.findUnique.mockResolvedValue(null);

      await expect(service.validateRawToken('nlp_bogus')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('bumps lastUsedAt asynchronously (fire-and-forget, does not throw)', async () => {
      prisma.apiToken.findUnique.mockResolvedValue(makeRecord());
      // Simulate the async update failing — should not propagate to caller.
      prisma.apiToken.update.mockRejectedValue(new Error('DB error'));

      // Should still resolve without throwing.
      await expect(service.validateRawToken(RAW)).resolves.toEqual(USER);
    });
  });
});

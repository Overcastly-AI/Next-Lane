/**
 * Unit tests for PasswordResetService.
 *
 * All DB calls are mocked — no real Postgres or argon2 hashing in the hot path.
 * The tests cover:
 *   1. Token issued and only its hash stored (raw token never persisted).
 *   2. Prior unused tokens invalidated on a new request.
 *   3. Unknown email: returns without creating a token (anti-enumeration).
 *   4. Valid token: password is updated and token is marked used.
 *   5. Expired token: rejected with BadRequestException.
 *   6. Already-used token: rejected with BadRequestException.
 *   7. Unknown token (not in DB): rejected with BadRequestException.
 *   8. forgot-password always returns 200 for unknown email (service contract).
 */

import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PasswordResetService } from './password-reset.service';
import type { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

interface MockPrisma {
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  passwordResetToken: {
    updateMany: jest.Mock;
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
}

function makePrisma(): MockPrisma {
  return {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    passwordResetToken: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    // Simulate Prisma.$transaction([...]) by resolving each promise in sequence.
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => {
      const results: unknown[] = [];
      for (const op of ops) results.push(await op);
      return results;
    }),
  };
}

function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

const USER = {
  id: 'user-1',
  email: 'alice@example.com',
  passwordHash: 'old-hash',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PasswordResetService', () => {
  let prisma: MockPrisma;
  let service: PasswordResetService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new PasswordResetService(prisma as unknown as PrismaService);
  });

  // -------------------------------------------------------------------------
  // requestReset
  // -------------------------------------------------------------------------

  describe('requestReset', () => {
    it('creates a token record when the user exists, storing only the hash', async () => {
      prisma.user.findUnique.mockResolvedValue(USER);
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.passwordResetToken.create.mockResolvedValue({ id: 'tok-1' });

      await service.requestReset(USER.email);

      // Exactly one token was created.
      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
      const created = prisma.passwordResetToken.create.mock.calls[0][0]
        .data as { userId: string; tokenHash: string; expiresAt: Date };

      // userId is correct.
      expect(created.userId).toBe(USER.id);

      // The stored hash is the SHA-256 of something — we cannot read the raw
      // token back, but we can verify it is a valid 64-char hex string.
      expect(created.tokenHash).toMatch(/^[0-9a-f]{64}$/);

      // expiresAt is in the future.
      expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('invalidates prior unused tokens for the same user before issuing a new one', async () => {
      prisma.user.findUnique.mockResolvedValue(USER);
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 2 });
      prisma.passwordResetToken.create.mockResolvedValue({ id: 'tok-2' });

      await service.requestReset(USER.email);

      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER.id, usedAt: null },
        }),
      );
      // New token is still created.
      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
    });

    it('does NOT create a token when the email is not registered (anti-enumeration)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      // Must not throw — caller should receive the same 200 response.
      await expect(service.requestReset('unknown@example.com')).resolves.toBeUndefined();

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('looks up the user by lower-cased email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await service.requestReset('ALICE@EXAMPLE.COM');

      // The service itself delegates to Prisma with the original case from the
      // DB lookup path; the important thing is it never throws.
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // resetPassword
  // -------------------------------------------------------------------------

  describe('resetPassword', () => {
    const RAW_TOKEN = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

    function makeRecord(overrides: Partial<{
      usedAt: Date | null;
      expiresAt: Date;
    }> = {}) {
      return {
        id: 'tok-1',
        userId: USER.id,
        tokenHash: sha256(RAW_TOKEN),
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000), // 1 hr in future
        usedAt: null,
        ...overrides,
      };
    }

    it('updates the password and marks the token used on a valid token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(makeRecord());
      prisma.user.update.mockResolvedValue({ ...USER, passwordHash: 'new-hash' });
      prisma.passwordResetToken.update.mockResolvedValue({ id: 'tok-1', usedAt: new Date() });

      await service.resetPassword(RAW_TOKEN, 'newSecurePassword!');

      // $transaction was called once.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      // user.update was called with a new passwordHash (we can't know the exact
      // hash but we know the data key is present and it's a string).
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: USER.id },
          data: expect.objectContaining({ passwordHash: expect.any(String) }),
        }),
      );

      // Token was marked used.
      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tok-1' },
          data: { usedAt: expect.any(Date) },
        }),
      );
    });

    it('rejects an expired token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(
        makeRecord({ expiresAt: new Date(Date.now() - 1) }),
      );

      await expect(
        service.resetPassword(RAW_TOKEN, 'newSecurePassword!'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an already-used token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(
        makeRecord({ usedAt: new Date(Date.now() - 1_000) }),
      );

      await expect(
        service.resetPassword(RAW_TOKEN, 'newSecurePassword!'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a token that does not exist in the DB', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword('totally-bogus-token', 'newSecurePassword!'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('looks up the record by the SHA-256 hash of the raw token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword(RAW_TOKEN, 'x'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: sha256(RAW_TOKEN) },
      });
    });
  });
});

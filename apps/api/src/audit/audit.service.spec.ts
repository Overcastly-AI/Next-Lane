/**
 * Unit tests for AuditService.
 *
 * All DB calls are mocked — no real Postgres in the test path.
 *
 * Covered scenarios:
 *   1. record() — creates an AuditEvent row with the correct fields.
 *   2. record() — best-effort: swallows DB errors without throwing.
 *   3. list() — rejects MEMBER (ForbiddenException).
 *   4. list() — rejects VIEWER (ForbiddenException).
 *   5. list() — tenant scoping: query always filters by workspaceId.
 *   6. list() — returns items with resolved actor name.
 *   7. list() — cursor pagination: nextCursor is null on last page.
 *   8. list() — cursor pagination: nextCursor is set when hasMore.
 *   9. list() — malformed cursor degrades gracefully (no throw, treats as first page).
 */

import { ForbiddenException } from '@nestjs/common';
import { Role } from '@next-lane/shared';
import { AuditService } from './audit.service';
import type { PrismaService } from '../prisma/prisma.service';

// ── Prisma mock ───────────────────────────────────────────────────────────────

interface MockPrisma {
  auditEvent: {
    create: jest.Mock;
    findMany: jest.Mock;
  };
  membership: {
    findUnique: jest.Mock;
  };
}

function makePrisma(): MockPrisma {
  return {
    auditEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    membership: {
      findUnique: jest.fn(),
    },
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const WORKSPACE_ID = 'ws-1';
const ADMIN_USER_ID = 'user-admin';
const MEMBER_USER_ID = 'user-member';
const VIEWER_USER_ID = 'user-viewer';

function makeMembership(userId: string, role: Role) {
  return {
    userId,
    workspaceId: WORKSPACE_ID,
    role,
    workspace: { id: WORKSPACE_ID, name: 'Test WS', slug: 'test-ws' },
  };
}

function makeAuditRow(overrides: Partial<{
  id: string;
  createdAt: Date;
  actorId: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'evt-1',
    workspaceId: WORKSPACE_ID,
    actorId: overrides.actorId ?? ADMIN_USER_ID,
    action: 'membership.add',
    targetType: 'Membership',
    targetId: 'mem-1',
    metadata: { targetEmail: 'bob@example.com', role: 'MEMBER' },
    ip: '127.0.0.1',
    createdAt: overrides.createdAt ?? new Date('2026-06-27T10:00:00.000Z'),
    actor: {
      id: ADMIN_USER_ID,
      name: 'Alice Admin',
      email: 'alice@example.com',
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuditService', () => {
  let prisma: MockPrisma;
  let service: AuditService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new AuditService(prisma as unknown as PrismaService);
    jest.clearAllMocks();
  });

  // ── record() ─────────────────────────────────────────────────────────────────

  describe('record()', () => {
    it('calls prisma.auditEvent.create with the correct fields', async () => {
      prisma.auditEvent.create.mockResolvedValue({ id: 'evt-1' });

      service.record({
        workspaceId: WORKSPACE_ID,
        actorId: ADMIN_USER_ID,
        action: 'membership.add',
        targetType: 'Membership',
        targetId: 'mem-1',
        metadata: { role: 'MEMBER' },
        ip: '1.2.3.4',
      });

      // Allow the fire-and-forget promise to settle.
      await Promise.resolve();

      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: {
          workspaceId: WORKSPACE_ID,
          actorId: ADMIN_USER_ID,
          action: 'membership.add',
          targetType: 'Membership',
          targetId: 'mem-1',
          metadata: { role: 'MEMBER' },
          ip: '1.2.3.4',
        },
      });
    });

    it('does not throw when the DB write fails (best-effort)', async () => {
      prisma.auditEvent.create.mockRejectedValue(new Error('DB down'));

      // Should not throw — the promise is fire-and-forget.
      expect(() =>
        service.record({
          workspaceId: WORKSPACE_ID,
          actorId: ADMIN_USER_ID,
          action: 'test.action',
          targetType: 'Test',
          targetId: 'id-1',
        }),
      ).not.toThrow();

      // Settle the internal promise so unhandled-rejection doesn't blow up.
      await Promise.resolve();
    });
  });

  // ── list() — authorization ───────────────────────────────────────────────────

  describe('list() — authorization', () => {
    it('throws ForbiddenException for a MEMBER', async () => {
      prisma.membership.findUnique.mockResolvedValue(
        makeMembership(MEMBER_USER_ID, Role.MEMBER),
      );

      await expect(
        service.list(MEMBER_USER_ID, WORKSPACE_ID, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for a VIEWER', async () => {
      prisma.membership.findUnique.mockResolvedValue(
        makeMembership(VIEWER_USER_ID, Role.VIEWER),
      );

      await expect(
        service.list(VIEWER_USER_ID, WORKSPACE_ID, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
    });

    it('allows access for an ADMIN', async () => {
      prisma.membership.findUnique.mockResolvedValue(
        makeMembership(ADMIN_USER_ID, Role.ADMIN),
      );
      prisma.auditEvent.findMany.mockResolvedValue([]);

      const result = await service.list(ADMIN_USER_ID, WORKSPACE_ID, {});

      expect(result).toEqual({ items: [], nextCursor: null });
    });
  });

  // ── list() — tenant scoping ───────────────────────────────────────────────────

  describe('list() — tenant scoping', () => {
    it('always filters the DB query by workspaceId', async () => {
      prisma.membership.findUnique.mockResolvedValue(
        makeMembership(ADMIN_USER_ID, Role.ADMIN),
      );
      prisma.auditEvent.findMany.mockResolvedValue([]);

      await service.list(ADMIN_USER_ID, WORKSPACE_ID, {});

      const callArgs = prisma.auditEvent.findMany.mock.calls[0][0];
      // The where clause must include workspaceId.
      expect(callArgs.where).toMatchObject({ workspaceId: WORKSPACE_ID });
    });
  });

  // ── list() — DTO shape ────────────────────────────────────────────────────────

  describe('list() — DTO mapping', () => {
    it('resolves actor name and returns correct DTO shape', async () => {
      prisma.membership.findUnique.mockResolvedValue(
        makeMembership(ADMIN_USER_ID, Role.ADMIN),
      );
      prisma.auditEvent.findMany.mockResolvedValue([makeAuditRow()]);

      const result = await service.list(ADMIN_USER_ID, WORKSPACE_ID, { limit: 50 });

      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.id).toBe('evt-1');
      expect(item.workspaceId).toBe(WORKSPACE_ID);
      expect(item.actor).toEqual({
        id: ADMIN_USER_ID,
        name: 'Alice Admin',
        email: 'alice@example.com',
      });
      expect(item.action).toBe('membership.add');
      expect(item.targetType).toBe('Membership');
      expect(item.targetId).toBe('mem-1');
      expect(item.metadata).toEqual({ targetEmail: 'bob@example.com', role: 'MEMBER' });
      expect(item.ip).toBe('127.0.0.1');
      expect(item.createdAt).toBe('2026-06-27T10:00:00.000Z');
      expect(result.nextCursor).toBeNull();
    });

    it('returns null actor when actorId is null', async () => {
      prisma.membership.findUnique.mockResolvedValue(
        makeMembership(ADMIN_USER_ID, Role.ADMIN),
      );
      prisma.auditEvent.findMany.mockResolvedValue([
        { ...makeAuditRow({ actorId: null }), actor: null },
      ]);

      const result = await service.list(ADMIN_USER_ID, WORKSPACE_ID, {});
      expect(result.items[0].actor).toBeNull();
    });
  });

  // ── list() — cursor pagination ────────────────────────────────────────────────

  describe('list() — cursor pagination', () => {
    beforeEach(() => {
      prisma.membership.findUnique.mockResolvedValue(
        makeMembership(ADMIN_USER_ID, Role.ADMIN),
      );
    });

    it('returns nextCursor = null when fewer items than limit', async () => {
      prisma.auditEvent.findMany.mockResolvedValue([makeAuditRow()]);

      const result = await service.list(ADMIN_USER_ID, WORKSPACE_ID, { limit: 50 });

      expect(result.nextCursor).toBeNull();
    });

    it('returns a non-null nextCursor when there are more items', async () => {
      // Return limit+1 rows to signal hasMore.
      const limit = 2;
      const rows = [
        makeAuditRow({ id: 'evt-1', createdAt: new Date('2026-06-27T10:00:00Z') }),
        makeAuditRow({ id: 'evt-2', createdAt: new Date('2026-06-27T09:00:00Z') }),
        makeAuditRow({ id: 'evt-3', createdAt: new Date('2026-06-27T08:00:00Z') }),
      ];
      prisma.auditEvent.findMany.mockResolvedValue(rows);

      const result = await service.list(ADMIN_USER_ID, WORKSPACE_ID, { limit });

      // Only the first `limit` rows are returned.
      expect(result.items).toHaveLength(limit);
      expect(result.nextCursor).not.toBeNull();
      expect(typeof result.nextCursor).toBe('string');
    });

    it('does not throw on a malformed cursor (degrades to first page)', async () => {
      prisma.auditEvent.findMany.mockResolvedValue([]);

      const result = await service.list(ADMIN_USER_ID, WORKSPACE_ID, {
        cursor: 'not-a-valid-base64url-cursor!!!',
      });

      // Graceful degradation: returns empty first page.
      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });
  });
});

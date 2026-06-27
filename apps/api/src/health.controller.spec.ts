import { HttpException, HttpStatus } from '@nestjs/common';
import { HealthController } from './health.controller';
import type { PrismaService } from './prisma/prisma.service';

/**
 * Unit tests for HealthController.
 *
 * These tests are DB-free: PrismaService is always mocked or omitted so the
 * suite can run without a real PostgreSQL instance.
 *
 * Covered scenarios:
 *  - GET /health returns enriched payload { status, uptime, version, db }
 *  - GET /health returns db:'ok' when the DB ping succeeds
 *  - GET /health throws 503 with db:'down' when the DB ping throws
 *  - GET /health/live always returns 200 { status:'ok', uptime }
 *  - X-Request-Id header is forwarded from req.id when present
 *  - X-Request-Id is skipped when req.id is absent (graceful)
 */

// ─── helpers ─────────────────────────────────────────────────────────────────

function makePrisma(opts: { throws?: boolean; timeout?: boolean } = {}) {
  const mockQueryRaw = jest.fn().mockImplementation(() => {
    if (opts.throws) {
      return Promise.reject(new Error('connection refused'));
    }
    if (opts.timeout) {
      // Never resolves — the controller's 3-second race will fire first.
      // In tests we just reject immediately so tests stay fast.
      return Promise.reject(new Error('timeout'));
    }
    return Promise.resolve([{ '?column?': 1 }]);
  });

  return {
    $queryRaw: mockQueryRaw,
  } as unknown as PrismaService;
}

/**
 * Build a minimal express-like Response mock with `setHeader` and the `req`
 * back-reference that the controller reads for X-Request-Id forwarding.
 */
function makeMockRes(reqId?: string) {
  const headers: Record<string, string> = {};
  const req = reqId ? { id: reqId } : {};
  const res = {
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    req,
    _headers: headers,
  };
  return res as unknown as import('express').Response & { _headers: Record<string, string> };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('HealthController', () => {
  describe('GET /health (readiness)', () => {
    it('returns enriched payload with status, uptime, version, and db:ok when DB ping succeeds', async () => {
      const prisma = makePrisma();
      const controller = new HealthController(prisma);
      const res = makeMockRes();

      const result = await controller.check(res);

      expect(result).toMatchObject({
        status: 'ok',
        db: 'ok',
      });
      expect(typeof result.uptime).toBe('number');
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(typeof result.version).toBe('string');
      expect(result.version.length).toBeGreaterThan(0);
    });

    it('calls $queryRaw to ping the database', async () => {
      const prisma = makePrisma();
      const controller = new HealthController(prisma);
      const res = makeMockRes();

      await controller.check(res);

      expect((prisma.$queryRaw as jest.Mock)).toHaveBeenCalledTimes(1);
    });

    it('throws 503 with db:down when the DB ping throws', async () => {
      const prisma = makePrisma({ throws: true });
      const controller = new HealthController(prisma);
      const res = makeMockRes();

      await expect(controller.check(res)).rejects.toBeInstanceOf(HttpException);

      try {
        await controller.check(res);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        const httpErr = err as HttpException;
        expect(httpErr.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        const body = httpErr.getResponse() as Record<string, unknown>;
        expect(body.status).toBe('error');
        expect(body.db).toBe('down');
        expect(typeof body.uptime).toBe('number');
        expect(typeof body.version).toBe('string');
      }
    });

    it('returns db:ok when no PrismaService is injected (graceful for test contexts)', async () => {
      // No prisma injected — should treat it as ok, not crash.
      const controller = new HealthController(undefined);
      const res = makeMockRes();

      const result = await controller.check(res);

      expect(result).toMatchObject({ status: 'ok', db: 'ok' });
    });

    it('sets X-Request-Id header from req.id when present', async () => {
      const prisma = makePrisma();
      const controller = new HealthController(prisma);
      const res = makeMockRes('test-correlation-id-123');

      await controller.check(res);

      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'test-correlation-id-123');
    });

    it('does not set X-Request-Id when req.id is absent', async () => {
      const prisma = makePrisma();
      const controller = new HealthController(prisma);
      const res = makeMockRes(); // no reqId

      await controller.check(res);

      expect(res.setHeader).not.toHaveBeenCalledWith('X-Request-Id', expect.anything());
    });

    it('sets X-Request-Id on 503 responses too (error path)', async () => {
      const prisma = makePrisma({ throws: true });
      const controller = new HealthController(prisma);
      const reqId = 'error-path-req-id';
      const res = makeMockRes(reqId);

      try {
        await controller.check(res);
      } catch {
        // expected 503
      }

      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', reqId);
    });
  });

  describe('GET /health/live (liveness)', () => {
    it('returns 200 with status:ok and uptime', () => {
      const controller = new HealthController(undefined);
      const res = makeMockRes();

      const result = controller.live(res);

      expect(result).toMatchObject({ status: 'ok' });
      expect(typeof result.uptime).toBe('number');
      expect(result.uptime).toBeGreaterThanOrEqual(0);
    });

    it('does NOT call DB — no prisma dependency', () => {
      // Even if we pass a prisma with a throws mock, live() must not use it.
      const prisma = makePrisma({ throws: true });
      const controller = new HealthController(prisma);
      const res = makeMockRes();

      // Should not throw even though prisma would throw if called.
      expect(() => controller.live(res)).not.toThrow();
      expect((prisma.$queryRaw as jest.Mock)).not.toHaveBeenCalled();
    });

    it('sets X-Request-Id header from req.id when present', () => {
      const controller = new HealthController(undefined);
      const res = makeMockRes('live-req-id-abc');

      controller.live(res);

      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'live-req-id-abc');
    });
  });
});

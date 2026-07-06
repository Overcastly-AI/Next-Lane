import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Optional,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from './auth/public.decorator';
import { PrismaService } from './prisma/prisma.service';

// Resolve the application version: prefer the RELEASE_VERSION env var
// (injected by CI/Helm), then fall back to the version in package.json.
// We read package.json lazily so no import machinery is needed.
function resolveVersion(): string {
  if (process.env.RELEASE_VERSION) {
    return process.env.RELEASE_VERSION;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('../package.json') as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const APP_VERSION = resolveVersion();

/**
 * Health controller — unauthenticated; excluded from the global `/api` prefix
 * (see `app.setGlobalPrefix` in `main.ts`).
 *
 * Two endpoints:
 *
 *  GET /health       — **readiness** probe.  Performs a fast `SELECT 1` DB
 *                      ping.  Returns 200 when ready; 503 with `db: 'down'`
 *                      when the database is unreachable.  Use this for k8s
 *                      `readinessProbe` and load-balancer checks.
 *
 *  GET /health/live  — **liveness** probe.  Always returns 200 as long as the
 *                      Node process is alive.  Use for k8s `livenessProbe`.
 *                      No DB round-trip so it cannot generate false negatives.
 *
 * Both endpoints return the `X-Request-Id` header (correlation id) that was
 * attached by pino-http for the request.
 *
 * Not `@RequireScope`-gated: both routes are `@Public()` — no bearer auth at
 * all, so there is no `request.user`/PAT scope for `ScopeGuard` to check.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /**
   * Readiness probe — checks that the API + database are both alive.
   * Returns HTTP 503 if the DB ping fails so k8s removes the pod from the
   * load-balancer endpoint slice until it recovers.
   */
  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const dbStatus = await this.pingDb();

    if (dbStatus !== 'ok') {
      // Propagate X-Request-Id (set by pino-http middleware) on error
      // responses so callers can correlate failed health checks in logs.
      this.forwardRequestId(res);
      throw new HttpException(
        {
          status: 'error',
          uptime: process.uptime(),
          version: APP_VERSION,
          db: 'down',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    this.forwardRequestId(res);
    return {
      status: 'ok',
      uptime: process.uptime(),
      version: APP_VERSION,
      db: 'ok',
    };
  }

  /**
   * Liveness probe — always 200 if the process is alive.
   * Intentionally has no DB dependency so a slow/overloaded DB does not
   * trigger a pod restart loop.
   */
  @Public()
  @Get('live')
  live(@Res({ passthrough: true }) res: Response) {
    this.forwardRequestId(res);
    return { status: 'ok', uptime: process.uptime() };
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  /**
   * Execute a minimal `SELECT 1` against the database and return whether it
   * succeeded.  Bounded by a 3-second timeout so a stalled DB does not hold
   * up the readiness endpoint for long.
   */
  private async pingDb(): Promise<'ok' | 'down'> {
    if (!this.prisma) {
      // PrismaService not injected in test contexts that don't provide it.
      return 'ok';
    }

    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('DB ping timeout')), 3000),
        ),
      ]);
      return 'ok';
    } catch {
      return 'down';
    }
  }

  /**
   * Copy the `x-request-id` response header that pino-http sets on the
   * underlying IncomingMessage so it is also visible on our structured
   * response.  The `passthrough: true` option on `@Res` keeps Nest's
   * serialisation pipeline intact.
   */
  private forwardRequestId(res: Response): void {
    // pino-http sets the id on `res.req` (the IncomingMessage).  The type is
    // deliberately loosened here because `res.req` is not part of the
    // express Response typings.
    const req = (res as unknown as { req?: { id?: string } }).req;
    if (req?.id) {
      res.setHeader('X-Request-Id', req.id);
    }
  }
}

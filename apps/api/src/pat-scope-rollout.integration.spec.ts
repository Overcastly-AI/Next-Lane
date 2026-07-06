/**
 * PAT scope rollout integration test.
 *
 * WHAT THIS TESTS
 * ───────────────
 * The "Hardening Night" sweep gated every controller mutation/read route with
 * `@RequireScope` (mirroring the pattern already established on
 * `issues.controller.ts`). This spec proves, against the REAL running app
 * (no mocks, real `ScopeGuard`), that:
 *
 *   1. DENY — a PAT scoped to a DIFFERENT single scope than a route requires
 *      is rejected with 403 and the exact `ScopeGuard` message naming the
 *      scope the route actually requires.
 *   2. ALLOW — a PAT scoped to EXACTLY the scope a route requires is never
 *      rejected by `ScopeGuard` (the request proceeds past the guard to the
 *      controller/service layer; whatever happens next — 200, 404, 400 from
 *      a dummy id — is irrelevant here, only that it is NOT the scope 403).
 *
 * Guards run before pipes/interceptors/the handler in the Nest request
 * lifecycle, so this holds regardless of whether the path id is real, the
 * body is valid, or the caller has business-level access to the resource —
 * we are testing the DECORATOR, not the underlying feature (already covered
 * by each domain's own unit tests + `tenant-isolation.integration.spec.ts`).
 * This lets one lightweight fixture (one user, one PAT per PAT_SCOPES entry)
 * exhaustively cover every route this sweep touched, instead of needing a
 * fully-populated resource per domain.
 *
 * The route+scope matrix itself lives in `pat-scope-matrix.fixture.ts` (one
 * exported constant), shared with `pat-scope-coverage.integration.spec.ts`
 * — the DiscoveryService-driven guard that fails the build if a future
 * `@RequireScope`-decorated route is added here without a matching matrix
 * row (or vice versa). Add new rows to the fixture, not here.
 *
 * HOW TO RUN
 * ──────────
 *   DATABASE_URL=... JWT_SECRET=local-dev-secret \
 *     pnpm --filter @next-lane/api exec jest --config jest.integration.config.js pat-scope-rollout
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as http from 'http';
import { PAT_SCOPES, type PATScope } from '@next-lane/shared';
import { MATRIX } from './pat-scope-matrix.fixture';

const DB_URL = process.env.DATABASE_URL;
const HAS_DB = Boolean(DB_URL);

/** The exact rejection message ScopeGuard throws — see auth/scope.guard.ts. */
function scopeDeniedMessage(scope: string): string {
  return `This token does not have the required scope: ${scope}`;
}

/** Fire a request against the running NestJS HTTP server. */
async function req(
  server: http.Server,
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; body: string }> {
  const addr = server.address() as { port: number };
  const url = `http://127.0.0.1:${addr.port}/api${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const resp = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  return { status: resp.status, body: text };
}

async function bootstrapApp(): Promise<{
  app: INestApplication;
  server: http.Server;
}> {
  const { AppModule } = await import('./app.module');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.enableCors({ origin: '*', credentials: true });

  await app.init();

  const server = app.getHttpServer() as http.Server;
  server.listen(0);

  return { app, server };
}

/** Pick a scope that is guaranteed to differ from `scope` — used to mint the DENY token. */
function pickWrongScope(scope: PATScope): PATScope {
  return scope === 'comments:read' ? 'issues:read' : 'comments:read';
}

(HAS_DB ? describe : describe.skip)('PAT scope rollout (real HTTP, real ScopeGuard)', () => {
  let app: INestApplication;
  let server: http.Server;
  /** One single-scope PAT per entry in PAT_SCOPES, keyed by scope string. */
  const tokenByScope = new Map<PATScope, string>();

  beforeAll(async () => {
    const boot = await bootstrapApp();
    app = boot.app;
    server = boot.server;

    // One user; PATs are user-scoped so a single principal is enough to mint
    // every single-scope token the matrix needs.
    const email = `pat-scope-rollout-${Date.now()}@test.example`;
    const regResp = await req(server, 'POST', '/auth/register', '', {
      name: 'PAT Scope Rollout',
      email,
      password: 'ScopeRollout#1',
    });
    expect(regResp.status).toBe(201);
    const jwt = (JSON.parse(regResp.body) as { accessToken: string }).accessToken;

    for (const scope of PAT_SCOPES) {
      const tokenResp = await req(server, 'POST', '/me/tokens', jwt, {
        name: `scope-${scope}`,
        scopes: [scope],
      });
      expect(tokenResp.status).toBe(201);
      const raw = (JSON.parse(tokenResp.body) as { rawToken: string }).rawToken;
      tokenByScope.set(scope, raw);
    }
  }, 60_000);

  afterAll(async () => {
    server?.close();
    await app?.close();
  });

  describe.each(MATRIX)(
    '$method $path (requires $scope)',
    ({ method, path, scope }) => {
      it('DENY — a PAT scoped to a different single scope gets 403 with the ScopeGuard message', async () => {
        const wrongScope = pickWrongScope(scope);
        const token = tokenByScope.get(wrongScope);
        expect(token).toBeDefined();

        const result = await req(server, method, path, token!);
        expect(result.status).toBe(403);
        expect(result.body).toContain(scopeDeniedMessage(scope));
      });

      it('ALLOW — a PAT scoped to exactly the required scope is not blocked by ScopeGuard', async () => {
        const token = tokenByScope.get(scope);
        expect(token).toBeDefined();

        const result = await req(server, method, path, token!);
        // Whatever the business outcome (200/201/400/404 from a dummy id), it
        // must not be ScopeGuard's specific rejection.
        expect(result.body).not.toContain('does not have the required scope');
      });
    },
  );
});

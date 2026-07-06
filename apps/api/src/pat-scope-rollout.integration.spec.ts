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
 * HOW TO RUN
 * ──────────
 *   DATABASE_URL=... JWT_SECRET=local-dev-secret \
 *     pnpm --filter @next-lane/api exec jest --config jest.integration.config.js pat-scope-rollout
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as http from 'http';
import { PAT_SCOPES, type PATScope } from '@next-lane/shared';

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

/** One row of the rollout matrix: a route + the single scope it requires. */
interface MatrixRow {
  controller: string;
  method: string;
  path: string;
  scope: PATScope;
}

// Dummy path-param id — guards fire before the handler ever looks it up, so
// it never needs to resolve to a real row (see file header).
const X = 'nonexistent-id';

const MATRIX: MatrixRow[] = [
  // admin-settings
  { controller: 'admin-settings', method: 'GET', path: '/admin/oidc-config', scope: 'admin:read' },
  { controller: 'admin-settings', method: 'PATCH', path: '/admin/oidc-config', scope: 'admin:write' },

  // analytics
  { controller: 'analytics', method: 'GET', path: '/me/analytics', scope: 'issues:read' },
  { controller: 'analytics', method: 'GET', path: `/projects/${X}/analytics`, scope: 'projects:read' },

  // api-tokens
  { controller: 'api-tokens', method: 'GET', path: '/me/tokens', scope: 'tokens:read' },
  { controller: 'api-tokens', method: 'POST', path: '/me/tokens', scope: 'tokens:write' },
  { controller: 'api-tokens', method: 'DELETE', path: `/me/tokens/${X}`, scope: 'tokens:write' },

  // attachments
  { controller: 'attachments', method: 'POST', path: `/issues/${X}/attachments`, scope: 'issues:write' },
  { controller: 'attachments', method: 'GET', path: `/issues/${X}/attachments`, scope: 'issues:read' },
  { controller: 'attachments', method: 'GET', path: `/attachments/${X}`, scope: 'issues:read' },
  { controller: 'attachments', method: 'DELETE', path: `/attachments/${X}`, scope: 'issues:write' },

  // audit
  { controller: 'audit', method: 'GET', path: `/workspaces/${X}/audit-log`, scope: 'workspaces:read' },

  // automations
  { controller: 'automations', method: 'GET', path: `/projects/${X}/automations`, scope: 'projects:read' },
  { controller: 'automations', method: 'POST', path: `/projects/${X}/automations`, scope: 'projects:write' },
  { controller: 'automations', method: 'GET', path: `/projects/${X}/automations/runs`, scope: 'projects:read' },
  { controller: 'automations', method: 'GET', path: `/projects/${X}/automations/${X}`, scope: 'projects:read' },
  { controller: 'automations', method: 'PATCH', path: `/projects/${X}/automations/${X}`, scope: 'projects:write' },
  { controller: 'automations', method: 'DELETE', path: `/projects/${X}/automations/${X}`, scope: 'projects:write' },
  { controller: 'automations', method: 'GET', path: `/projects/${X}/automations/${X}/runs`, scope: 'projects:read' },

  // board
  { controller: 'board', method: 'GET', path: `/projects/${X}/boards`, scope: 'projects:read' },
  { controller: 'board', method: 'POST', path: `/projects/${X}/boards`, scope: 'projects:write' },
  { controller: 'board', method: 'GET', path: `/projects/${X}/board`, scope: 'projects:read' },
  { controller: 'board', method: 'GET', path: `/boards/${X}`, scope: 'projects:read' },
  { controller: 'board', method: 'PATCH', path: `/boards/${X}`, scope: 'projects:write' },
  { controller: 'board', method: 'DELETE', path: `/boards/${X}`, scope: 'projects:write' },

  // checklist
  { controller: 'checklist', method: 'GET', path: `/issues/${X}/checklist`, scope: 'issues:read' },
  { controller: 'checklist', method: 'POST', path: `/issues/${X}/checklist`, scope: 'issues:write' },
  { controller: 'checklist', method: 'PUT', path: `/issues/${X}/checklist/reorder`, scope: 'issues:write' },
  { controller: 'checklist', method: 'PATCH', path: `/checklist/${X}`, scope: 'issues:write' },
  { controller: 'checklist', method: 'DELETE', path: `/checklist/${X}`, scope: 'issues:write' },

  // comments
  { controller: 'comments', method: 'GET', path: `/issues/${X}/comments`, scope: 'comments:read' },
  { controller: 'comments', method: 'POST', path: `/issues/${X}/comments`, scope: 'comments:write' },
  { controller: 'comments', method: 'PATCH', path: `/comments/${X}`, scope: 'comments:write' },
  { controller: 'comments', method: 'DELETE', path: `/comments/${X}`, scope: 'comments:write' },

  // components
  { controller: 'components', method: 'GET', path: `/projects/${X}/components`, scope: 'projects:read' },
  { controller: 'components', method: 'POST', path: `/projects/${X}/components`, scope: 'projects:write' },
  { controller: 'components', method: 'PATCH', path: `/components/${X}`, scope: 'projects:write' },
  { controller: 'components', method: 'DELETE', path: `/components/${X}`, scope: 'projects:write' },

  // gitea
  { controller: 'gitea', method: 'GET', path: `/projects/${X}/gitea`, scope: 'gitea:read' },
  { controller: 'gitea', method: 'PUT', path: `/projects/${X}/gitea`, scope: 'gitea:write' },
  { controller: 'gitea', method: 'DELETE', path: `/projects/${X}/gitea`, scope: 'gitea:write' },
  { controller: 'gitea', method: 'GET', path: `/issues/${X}/gitea-links`, scope: 'gitea:read' },

  // custom-fields
  { controller: 'custom-fields', method: 'GET', path: `/projects/${X}/custom-fields`, scope: 'projects:read' },
  { controller: 'custom-fields', method: 'POST', path: `/projects/${X}/custom-fields`, scope: 'projects:write' },
  { controller: 'custom-fields', method: 'PATCH', path: `/custom-fields/${X}`, scope: 'projects:write' },
  { controller: 'custom-fields', method: 'DELETE', path: `/custom-fields/${X}`, scope: 'projects:write' },

  // dashboards
  { controller: 'dashboards', method: 'GET', path: `/projects/${X}/dashboards`, scope: 'projects:read' },
  { controller: 'dashboards', method: 'POST', path: `/projects/${X}/dashboards`, scope: 'projects:write' },
  { controller: 'dashboards', method: 'GET', path: `/dashboards/${X}`, scope: 'projects:read' },
  { controller: 'dashboards', method: 'GET', path: `/dashboards/${X}/data`, scope: 'projects:read' },
  { controller: 'dashboards', method: 'PATCH', path: `/dashboards/${X}`, scope: 'projects:write' },
  { controller: 'dashboards', method: 'DELETE', path: `/dashboards/${X}`, scope: 'projects:write' },
  { controller: 'dashboards', method: 'POST', path: `/dashboards/${X}/gadgets`, scope: 'projects:write' },
  { controller: 'dashboards', method: 'PATCH', path: `/gadgets/${X}`, scope: 'projects:write' },
  { controller: 'dashboards', method: 'DELETE', path: `/gadgets/${X}`, scope: 'projects:write' },

  // issue-templates
  { controller: 'issue-templates', method: 'GET', path: `/projects/${X}/issue-templates`, scope: 'projects:read' },
  { controller: 'issue-templates', method: 'POST', path: `/projects/${X}/issue-templates`, scope: 'projects:write' },
  { controller: 'issue-templates', method: 'PATCH', path: `/issue-templates/${X}`, scope: 'projects:write' },
  { controller: 'issue-templates', method: 'DELETE', path: `/issue-templates/${X}`, scope: 'projects:write' },
  { controller: 'issue-templates', method: 'POST', path: `/issue-templates/${X}/create-issue`, scope: 'issues:write' },

  // labels
  { controller: 'labels', method: 'GET', path: `/projects/${X}/labels`, scope: 'projects:read' },
  { controller: 'labels', method: 'POST', path: `/projects/${X}/labels`, scope: 'projects:write' },
  { controller: 'labels', method: 'PATCH', path: `/labels/${X}`, scope: 'projects:write' },
  { controller: 'labels', method: 'DELETE', path: `/labels/${X}`, scope: 'projects:write' },
  { controller: 'labels', method: 'POST', path: `/issues/${X}/labels`, scope: 'issues:write' },
  { controller: 'labels', method: 'DELETE', path: `/issues/${X}/labels/${X}`, scope: 'issues:write' },

  // notifications
  { controller: 'notifications', method: 'GET', path: '/notifications', scope: 'issues:read' },
  { controller: 'notifications', method: 'GET', path: '/notifications/unread-count', scope: 'issues:read' },
  { controller: 'notifications', method: 'POST', path: `/notifications/${X}/read`, scope: 'issues:write' },
  { controller: 'notifications', method: 'POST', path: '/notifications/read-all', scope: 'issues:write' },

  // personal-boards (only the issue-creating route is gated)
  { controller: 'personal-boards', method: 'POST', path: `/me/personal-cards/${X}/promote`, scope: 'issues:write' },

  // poker
  { controller: 'poker', method: 'POST', path: `/projects/${X}/poker-sessions`, scope: 'projects:write' },
  { controller: 'poker', method: 'GET', path: `/projects/${X}/poker-sessions`, scope: 'projects:read' },
  { controller: 'poker', method: 'GET', path: `/poker-sessions/${X}`, scope: 'projects:read' },
  { controller: 'poker', method: 'PATCH', path: `/poker-sessions/${X}`, scope: 'projects:write' },
  { controller: 'poker', method: 'POST', path: `/poker-sessions/${X}/items`, scope: 'projects:write' },
  { controller: 'poker', method: 'DELETE', path: `/poker-items/${X}`, scope: 'projects:write' },
  { controller: 'poker', method: 'POST', path: `/poker-items/${X}/vote`, scope: 'projects:write' },
  { controller: 'poker', method: 'POST', path: `/poker-items/${X}/reveal`, scope: 'projects:write' },
  { controller: 'poker', method: 'POST', path: `/poker-items/${X}/commit`, scope: 'projects:write' },

  // projects
  { controller: 'projects', method: 'GET', path: '/projects?workspaceId=x', scope: 'projects:read' },
  { controller: 'projects', method: 'POST', path: '/projects', scope: 'projects:write' },
  { controller: 'projects', method: 'GET', path: `/projects/${X}`, scope: 'projects:read' },
  { controller: 'projects', method: 'PATCH', path: `/projects/${X}`, scope: 'projects:write' },
  { controller: 'projects', method: 'DELETE', path: `/projects/${X}`, scope: 'projects:write' },

  // reports
  { controller: 'reports', method: 'GET', path: `/projects/${X}/reports/velocity`, scope: 'projects:read' },
  { controller: 'reports', method: 'GET', path: `/projects/${X}/reports/velocity-trend`, scope: 'projects:read' },
  { controller: 'reports', method: 'GET', path: `/projects/${X}/sprints/${X}/burndown`, scope: 'projects:read' },
  { controller: 'reports', method: 'GET', path: `/projects/${X}/reports/cfd`, scope: 'projects:read' },

  // roadmap
  { controller: 'roadmap', method: 'GET', path: `/projects/${X}/roadmap`, scope: 'projects:read' },

  // saved-filters
  { controller: 'saved-filters', method: 'GET', path: `/projects/${X}/saved-filters`, scope: 'projects:read' },
  { controller: 'saved-filters', method: 'POST', path: `/projects/${X}/saved-filters`, scope: 'projects:write' },
  { controller: 'saved-filters', method: 'PATCH', path: `/saved-filters/${X}`, scope: 'projects:write' },
  { controller: 'saved-filters', method: 'DELETE', path: `/saved-filters/${X}`, scope: 'projects:write' },

  // search
  { controller: 'search', method: 'GET', path: '/search?q=x', scope: 'issues:read' },
  { controller: 'search', method: 'GET', path: `/projects/${X}/search?q=x`, scope: 'issues:read' },

  // share-tokens
  { controller: 'share-tokens', method: 'POST', path: `/projects/${X}/share-tokens`, scope: 'projects:write' },
  { controller: 'share-tokens', method: 'GET', path: `/projects/${X}/share-tokens`, scope: 'projects:read' },
  { controller: 'share-tokens', method: 'DELETE', path: `/projects/${X}/share-tokens/${X}`, scope: 'projects:write' },

  // sprints
  { controller: 'sprints', method: 'GET', path: `/projects/${X}/sprints`, scope: 'projects:read' },
  { controller: 'sprints', method: 'POST', path: `/projects/${X}/sprints`, scope: 'projects:write' },
  { controller: 'sprints', method: 'PATCH', path: `/sprints/${X}`, scope: 'projects:write' },
  { controller: 'sprints', method: 'DELETE', path: `/sprints/${X}`, scope: 'projects:write' },

  // standups
  { controller: 'standups', method: 'GET', path: `/projects/${X}/standups`, scope: 'projects:read' },
  { controller: 'standups', method: 'GET', path: `/projects/${X}/standups/me`, scope: 'projects:read' },
  { controller: 'standups', method: 'GET', path: `/projects/${X}/standups/prefill`, scope: 'projects:read' },
  { controller: 'standups', method: 'POST', path: `/projects/${X}/standups`, scope: 'projects:write' },

  // statuses
  { controller: 'statuses', method: 'GET', path: `/projects/${X}/statuses`, scope: 'projects:read' },
  { controller: 'statuses', method: 'POST', path: `/projects/${X}/statuses`, scope: 'projects:write' },
  { controller: 'statuses', method: 'PATCH', path: `/statuses/${X}`, scope: 'projects:write' },
  { controller: 'statuses', method: 'DELETE', path: `/statuses/${X}`, scope: 'projects:write' },

  // users
  { controller: 'users', method: 'GET', path: '/users', scope: 'workspaces:read' },
  { controller: 'users', method: 'GET', path: `/users/${X}`, scope: 'workspaces:read' },

  // versions
  { controller: 'versions', method: 'GET', path: `/projects/${X}/versions`, scope: 'projects:read' },
  { controller: 'versions', method: 'POST', path: `/projects/${X}/versions`, scope: 'projects:write' },
  { controller: 'versions', method: 'PATCH', path: `/versions/${X}`, scope: 'projects:write' },
  { controller: 'versions', method: 'DELETE', path: `/versions/${X}`, scope: 'projects:write' },
  { controller: 'versions', method: 'PUT', path: `/issues/${X}/versions`, scope: 'issues:write' },

  // work-logs
  { controller: 'work-logs', method: 'GET', path: `/issues/${X}/worklogs`, scope: 'issues:read' },
  { controller: 'work-logs', method: 'POST', path: `/issues/${X}/worklogs`, scope: 'issues:write' },
  { controller: 'work-logs', method: 'PATCH', path: `/worklogs/${X}`, scope: 'issues:write' },
  { controller: 'work-logs', method: 'DELETE', path: `/worklogs/${X}`, scope: 'issues:write' },

  // workflow
  { controller: 'workflow', method: 'GET', path: `/projects/${X}/workflow`, scope: 'projects:read' },
  { controller: 'workflow', method: 'PATCH', path: `/projects/${X}/workflow`, scope: 'projects:write' },
  { controller: 'workflow', method: 'POST', path: `/projects/${X}/workflow/transitions`, scope: 'projects:write' },
  { controller: 'workflow', method: 'PATCH', path: `/workflow/transitions/${X}`, scope: 'projects:write' },
  { controller: 'workflow', method: 'DELETE', path: `/workflow/transitions/${X}`, scope: 'projects:write' },
  { controller: 'workflow', method: 'GET', path: `/projects/${X}/workflows`, scope: 'projects:read' },
  { controller: 'workflow', method: 'POST', path: `/projects/${X}/workflows`, scope: 'projects:write' },
  { controller: 'workflow', method: 'POST', path: `/projects/${X}/workflows/from-template`, scope: 'projects:write' },
  { controller: 'workflow', method: 'GET', path: `/workflows/${X}`, scope: 'projects:read' },
  { controller: 'workflow', method: 'PATCH', path: `/workflows/${X}`, scope: 'projects:write' },
  { controller: 'workflow', method: 'DELETE', path: `/workflows/${X}`, scope: 'projects:write' },
  { controller: 'workflow', method: 'POST', path: `/workflows/${X}/transitions`, scope: 'projects:write' },
  { controller: 'workflow', method: 'PATCH', path: `/workflow-transitions/${X}`, scope: 'projects:write' },
  { controller: 'workflow', method: 'DELETE', path: `/workflow-transitions/${X}`, scope: 'projects:write' },

  // workspaces
  { controller: 'workspaces', method: 'GET', path: '/workspaces', scope: 'workspaces:read' },
  { controller: 'workspaces', method: 'POST', path: '/workspaces', scope: 'workspaces:write' },
  { controller: 'workspaces', method: 'GET', path: `/workspaces/${X}`, scope: 'workspaces:read' },
  { controller: 'workspaces', method: 'PATCH', path: `/workspaces/${X}`, scope: 'workspaces:write' },
  { controller: 'workspaces', method: 'DELETE', path: `/workspaces/${X}`, scope: 'workspaces:write' },
  { controller: 'workspaces', method: 'GET', path: `/workspaces/${X}/members`, scope: 'workspaces:read' },
  { controller: 'workspaces', method: 'POST', path: `/workspaces/${X}/members`, scope: 'workspaces:write' },
  { controller: 'workspaces', method: 'PATCH', path: `/workspaces/${X}/members/${X}`, scope: 'workspaces:write' },
  { controller: 'workspaces', method: 'DELETE', path: `/workspaces/${X}/members/${X}`, scope: 'workspaces:write' },
  { controller: 'workspaces', method: 'POST', path: `/workspaces/${X}/logo`, scope: 'workspaces:write' },
  { controller: 'workspaces', method: 'DELETE', path: `/workspaces/${X}/logo`, scope: 'workspaces:write' },
];

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

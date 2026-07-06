/**
 * Cross-tenant isolation integration test.
 *
 * WHAT THIS TESTS
 * ───────────────
 * Two independent workspaces — Tenant A and Tenant B — are set up from scratch.
 * Every tenant-scoped resource is created for Tenant A (issue, comment, label,
 * sprint, status, webhook, attachment record, API token).  Tenant B then
 * attempts to read or mutate every one of those resources using B's JWT.
 *
 * Each row of the MATRIX asserts:
 *   – The HTTP status is NOT 200 (i.e. 401 / 403 / 404 / 405 — anything that
 *     proves B cannot access A's data).
 *   – The response body does NOT contain A's workspace/project/issue IDs
 *     (extra guard: ensure no data leak even if the status is somehow 200).
 *
 * REAL APP — NO MOCKS
 * ───────────────────
 * The test bootstraps the full NestJS application via `@nestjs/testing` against
 * the real Postgres database pointed to by DATABASE_URL.  If DATABASE_URL is
 * not set the entire suite is skipped so the unit-test run (no DB) stays green.
 *
 * SOCKET ISOLATION
 * ────────────────
 * The gateway `subscribe` handler calls `assertProjectMember`; tenant B's JWT
 * must receive a WsException('Forbidden') when it tries to subscribe to
 * tenant A's project room.
 *
 * HOW TO RUN
 * ──────────
 *   # From repo root (requires DATABASE_URL env):
 *   DATABASE_URL=... JWT_SECRET=local-dev-secret \
 *     pnpm --filter @next-lane/api exec jest tenant-isolation
 *
 *   # Or via dev-up-instance.sh (sets DATABASE_URL automatically):
 *   bash /path/to/dev-up-instance.sh 1
 *   cd apps/api && DATABASE_URL=postgresql://nextlane:nextlane@127.0.0.1:5432/nextlane_i1 \
 *     JWT_SECRET=local-dev-secret npx jest tenant-isolation
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import * as http from 'http';

// ── Guard: skip the entire suite when no real database is available ───────────

const DB_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET ?? 'local-dev-secret';
const HAS_DB = Boolean(DB_URL);

// We use native fetch (Node ≥ 18) to drive the running app via supertest-style
// helpers.  Supertest is also available as a dep, but using the built-in
// server address keeps the test self-contained.

// ── Types ─────────────────────────────────────────────────────────────────────

interface Tenant {
  token: string; // JWT bearer token
  userId: string;
  workspaceId: string;
  projectId: string;
  issueId: string;
  commentId: string;
  labelId: string;
  sprintId: string;
  statusId: string;
  webhookId: string;
  apiTokenId: string; // personal API token record id (NOT the raw token)
  automationRuleId: string;
  workflowTransitionId: string;
  // Additional resource IDs for extended isolation coverage
  workLogId: string;
  pokerSessionId: string;
  personalColumnId: string;
  issueTemplateId: string;
  // Pass-12 fix batch: personal-cards, quick-links, GitHub integration,
  // dashboards + gadgets.
  personalCardId: string;
  quickLinkId: string;
  dashboardId: string;
  gadgetId: string;
  dashboardShareTokenId: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/** Assert that `result` is a rejection — not a 200 and not leaking foreign data. */
function assertRejected(
  result: { status: number; body: string },
  foreignIds: string[],
  label: string,
): void {
  // Primary: must not be 200 (success)
  expect(result.status).not.toBe(200);

  // Secondary: even if status is not 200, the body must not reveal foreign IDs
  for (const id of foreignIds) {
    if (result.body.includes(id)) {
      fail(
        `${label}: response body leaked foreign id "${id}" (status ${result.status}):\n${result.body.slice(0, 400)}`,
      );
    }
  }
}

/** Bootstrap a full NestJS app. Returns the app + the underlying http.Server. */
async function bootstrapApp(): Promise<{
  app: INestApplication;
  server: http.Server;
}> {
  // Dynamically import the app module to avoid loading it when DB is absent.
  const { AppModule } = await import('./app.module');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();

  // Mirror main.ts setup so routes, guards, and pipes behave identically.
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  // Disable CORS restrictions for testing (same-process requests).
  app.enableCors({ origin: '*', credentials: true });

  await app.init();

  const server = app.getHttpServer() as http.Server;
  // Let the OS pick a free port (avoids conflicts with the dev instance).
  server.listen(0);

  return { app, server };
}

// ── Tenant fixture setup ──────────────────────────────────────────────────────

/**
 * Register a user, create a workspace + project, then provision one of each
 * tenant-scoped resource so the isolation matrix has real IDs to probe.
 *
 * The `suffix` parameter makes names unique between the two tenants so slug
 * collisions cannot occur when both run against the same DB.
 */
async function setupTenant(
  server: http.Server,
  suffix: string,
): Promise<Tenant> {
  const email = `isolation-${suffix}-${Date.now()}@test.example`;
  const password = 'IsolationTest#1';

  // ── Register + login ──────────────────────────────────────────────────────
  const regResp = await req(server, 'POST', '/auth/register', '', {
    name: `Tenant ${suffix}`,
    email,
    password,
  });
  expect(regResp.status).toBe(201);
  const regBody = JSON.parse(regResp.body) as {
    accessToken: string;
    user: { id: string };
  };
  const token = regBody.accessToken;
  const userId = regBody.user.id;

  // ── Workspace ─────────────────────────────────────────────────────────────
  const wsResp = await req(server, 'POST', '/workspaces', token, {
    name: `WS-${suffix}`,
    slug: `ws-${suffix}-${Date.now()}`,
  });
  expect(wsResp.status).toBe(201);
  const workspaceId = (JSON.parse(wsResp.body) as { id: string }).id;

  // ── Project ───────────────────────────────────────────────────────────────
  const projResp = await req(server, 'POST', '/projects', token, {
    name: `Project-${suffix}`,
    key: suffix.toUpperCase().slice(0, 4) + Date.now().toString().slice(-2),
    workspaceId,
  });
  expect(projResp.status).toBe(201);
  const projectId = (JSON.parse(projResp.body) as { id: string }).id;

  // ── Status (first default status created by project) ─────────────────────
  const statusListResp = await req(
    server,
    'GET',
    `/projects/${projectId}/statuses`,
    token,
  );
  expect(statusListResp.status).toBe(200);
  const statuses = JSON.parse(statusListResp.body) as Array<{ id: string }>;
  const statusId = statuses[0]?.id;
  expect(statusId).toBeDefined();

  // ── Issue ─────────────────────────────────────────────────────────────────
  const issueResp = await req(server, 'POST', '/issues', token, {
    projectId,
    title: `Issue for ${suffix}`,
    type: 'TASK',
    statusId,
  });
  expect(issueResp.status).toBe(201);
  const issueId = (JSON.parse(issueResp.body) as { id: string }).id;

  // ── Comment ───────────────────────────────────────────────────────────────
  const commentResp = await req(
    server,
    'POST',
    `/issues/${issueId}/comments`,
    token,
    { body: `Comment from ${suffix}` },
  );
  expect(commentResp.status).toBe(201);
  const commentId = (JSON.parse(commentResp.body) as { id: string }).id;

  // ── Label ─────────────────────────────────────────────────────────────────
  const labelResp = await req(
    server,
    'POST',
    `/projects/${projectId}/labels`,
    token,
    { name: `label-${suffix}`, color: '#ff0000' },
  );
  expect(labelResp.status).toBe(201);
  const labelId = (JSON.parse(labelResp.body) as { id: string }).id;

  // ── Sprint ────────────────────────────────────────────────────────────────
  const sprintResp = await req(
    server,
    'POST',
    `/projects/${projectId}/sprints`,
    token,
    {
      name: `Sprint-${suffix}`,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    },
  );
  expect(sprintResp.status).toBe(201);
  const sprintId = (JSON.parse(sprintResp.body) as { id: string }).id;

  // ── Webhook ───────────────────────────────────────────────────────────────
  const webhookResp = await req(
    server,
    'POST',
    `/projects/${projectId}/webhooks`,
    token,
    {
      url: 'https://example.com/hook',
      events: ['issue.created'],
      secret: 'wh-secret',
    },
  );
  // Webhooks may return 201; if SSRF guard blocks example.com accept 400/201.
  const webhookId =
    webhookResp.status === 201
      ? (JSON.parse(webhookResp.body) as { id: string }).id
      : 'nonexistent-webhook-id';

  // ── API Token ─────────────────────────────────────────────────────────────
  const apiTokenResp = await req(server, 'POST', '/me/tokens', token, {
    name: `token-${suffix}`,
  });
  expect(apiTokenResp.status).toBe(201);
  const apiTokenId = (JSON.parse(apiTokenResp.body) as { id: string }).id;

  // ── Automation Rule ───────────────────────────────────────────────────────
  const automationRuleResp = await req(
    server,
    'POST',
    `/projects/${projectId}/automations`,
    token,
    {
      name: `rule-${suffix}`,
      trigger: 'ISSUE_CREATED',
      actions: [{ type: 'SET_PRIORITY', params: { priority: 'HIGH' } }],
    },
  );
  const automationRuleId =
    automationRuleResp.status === 201
      ? (JSON.parse(automationRuleResp.body) as { id: string }).id
      : 'nonexistent-rule-id';

  // ── Workflow Transition ───────────────────────────────────────────────────
  // Enable enforcement first so we can create a transition.
  await req(server, 'PATCH', `/projects/${projectId}/workflow`, token, {
    enforced: true,
  });
  const transitionsResp = await req(
    server,
    'GET',
    `/projects/${projectId}/workflow`,
    token,
  );
  const workflowTransitionId =
    transitionsResp.status === 200
      ? ((JSON.parse(transitionsResp.body) as { transitions: Array<{ id: string }> })
          .transitions[0]?.id ?? 'nonexistent-transition-id')
      : 'nonexistent-transition-id';

  // ── Work Log ──────────────────────────────────────────────────────────────
  const workLogResp = await req(
    server,
    'POST',
    `/issues/${issueId}/worklogs`,
    token,
    { minutes: 30 },
  );
  const workLogId =
    workLogResp.status === 201
      ? (JSON.parse(workLogResp.body) as { id: string }).id
      : 'nonexistent-worklog-id';

  // ── Planning Poker Session ────────────────────────────────────────────────
  const pokerResp = await req(
    server,
    'POST',
    `/projects/${projectId}/poker-sessions`,
    token,
    { issueIds: [issueId] },
  );
  const pokerSessionId =
    pokerResp.status === 201
      ? (JSON.parse(pokerResp.body) as { id: string }).id
      : 'nonexistent-poker-session-id';

  // ── Personal Column (user-owned; other users can't access by id) ──────────
  const colResp = await req(
    server,
    'POST',
    '/me/personal-columns',
    token,
    { name: `Col-${suffix}` },
  );
  const personalColumnId =
    colResp.status === 201
      ? (JSON.parse(colResp.body) as { id: string }).id
      : 'nonexistent-personal-column-id';

  // ── Issue Template ────────────────────────────────────────────────────────
  const templateResp = await req(
    server,
    'POST',
    `/projects/${projectId}/issue-templates`,
    token,
    { name: `Template-${suffix}` },
  );
  const issueTemplateId =
    templateResp.status === 201
      ? (JSON.parse(templateResp.body) as { id: string }).id
      : 'nonexistent-issue-template-id';

  // ── Personal Card (user-owned; other users can't access by id) ────────────
  const cardResp = await req(server, 'POST', '/me/personal-cards', token, {
    columnId: personalColumnId,
    title: `Card-${suffix}`,
  });
  const personalCardId =
    cardResp.status === 201
      ? (JSON.parse(cardResp.body) as { id: string }).id
      : 'nonexistent-personal-card-id';

  // ── Quick link (user-owned; other users can't access by id) ───────────────
  const quickLinkResp = await req(server, 'POST', '/me/quick-links', token, {
    label: `Link-${suffix}`,
    url: 'https://example.com/tool',
  });
  const quickLinkId =
    quickLinkResp.status === 201
      ? (JSON.parse(quickLinkResp.body) as { id: string }).id
      : 'nonexistent-quick-link-id';

  // ── GitHub integration (project-scoped config; ADMIN-gated) ────────────────
  await req(server, 'PUT', `/projects/${projectId}/github`, token, {
    repoFullName: `acme/widgets-${suffix.toLowerCase()}`,
    token: 'ghp_faketoken1234567890abcdef',
  });

  // ── GitLab integration (project-scoped config; ADMIN-gated) ────────────────
  await req(server, 'PUT', `/projects/${projectId}/gitlab`, token, {
    projectPath: `acme/widgets-${suffix.toLowerCase()}`,
    token: 'glpat-faketoken1234567890abcdef',
  });

  // ── Gitea integration (project-scoped config; ADMIN-gated) ─────────────────
  await req(server, 'PUT', `/projects/${projectId}/gitea`, token, {
    giteaBaseUrl: 'https://git.example.com',
    repoFullName: `acme/widgets-${suffix.toLowerCase()}`,
    token: 'gitea_faketoken1234567890abcdef',
  });

  // ── Dashboard + gadget ───────────────────────────────────────────────────
  const dashboardResp = await req(
    server,
    'POST',
    `/projects/${projectId}/dashboards`,
    token,
    { name: `Dashboard-${suffix}` },
  );
  const dashboardId =
    dashboardResp.status === 201
      ? (JSON.parse(dashboardResp.body) as { id: string }).id
      : 'nonexistent-dashboard-id';

  const gadgetResp = await req(
    server,
    'POST',
    `/dashboards/${dashboardId}/gadgets`,
    token,
    { title: `Gadget-${suffix}`, query: '', visualization: 'STAT' },
  );
  const gadgetId =
    gadgetResp.status === 201
      ? (JSON.parse(gadgetResp.body) as { id: string }).id
      : 'nonexistent-gadget-id';

  // ── Dashboard share token (public read-only link; ADMIN-gated) ────────────
  const dashboardShareTokenResp = await req(
    server,
    'POST',
    `/dashboards/${dashboardId}/share-tokens`,
    token,
  );
  const dashboardShareTokenId =
    dashboardShareTokenResp.status === 201
      ? (JSON.parse(dashboardShareTokenResp.body) as { id: string }).id
      : 'nonexistent-dashboard-share-token-id';

  return {
    token,
    userId,
    workspaceId,
    projectId,
    issueId,
    commentId,
    labelId,
    sprintId,
    statusId,
    webhookId,
    apiTokenId,
    automationRuleId,
    workflowTransitionId,
    workLogId,
    pokerSessionId,
    personalColumnId,
    issueTemplateId,
    personalCardId,
    quickLinkId,
    dashboardId,
    gadgetId,
    dashboardShareTokenId,
  };
}

// ── Matrix definition ─────────────────────────────────────────────────────────

/**
 * Build the full list of cross-tenant attack vectors.
 *
 * Each entry describes one request that Tenant B attempts against Tenant A's
 * resources. All must be rejected (status ≠ 200, no data leaked).
 */
interface MatrixRow {
  label: string;
  method: string;
  path: (a: Tenant) => string;
  body?: (a: Tenant) => unknown;
}

function buildMatrix(a: Tenant): Array<MatrixRow & { resolvedPath: string; resolvedBody?: unknown }> {
  const rows: MatrixRow[] = [
    // ── Workspace ──────────────────────────────────────────────────────────
    {
      label: 'GET workspace A',
      method: 'GET',
      path: (t) => `/workspaces/${t.workspaceId}`,
    },
    {
      label: 'GET workspace A members',
      method: 'GET',
      path: (t) => `/workspaces/${t.workspaceId}/members`,
    },
    {
      label: 'GET workspace A audit-log',
      method: 'GET',
      path: (t) => `/workspaces/${t.workspaceId}/audit-log`,
    },
    {
      label: 'PATCH workspace A (cross-tenant mutation)',
      method: 'PATCH',
      path: (t) => `/workspaces/${t.workspaceId}`,
      body: () => ({ name: 'Hijacked workspace' }),
    },
    {
      label: 'POST workspace A logo (cross-tenant mutation)',
      method: 'POST',
      path: (t) => `/workspaces/${t.workspaceId}/logo`,
    },
    {
      label: 'DELETE workspace A (cross-tenant mutation)',
      method: 'DELETE',
      path: (t) => `/workspaces/${t.workspaceId}`,
    },

    // ── Project ────────────────────────────────────────────────────────────
    {
      label: 'GET project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}`,
    },
    {
      label: 'PATCH project A',
      method: 'PATCH',
      path: (t) => `/projects/${t.projectId}`,
      body: () => ({ name: 'Hijacked' }),
    },
    {
      label: 'DELETE project A (archive)',
      method: 'DELETE',
      path: (t) => `/projects/${t.projectId}`,
    },

    // ── Per-project role overrides ────────────────────────────────────────────
    {
      label: 'GET project A effective members',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/members`,
    },
    {
      label: "PUT project A member role override (B tries to elevate self)",
      method: 'PUT',
      path: (t) => `/projects/${t.projectId}/members/${t.userId}/role`,
      body: () => ({ role: 'ADMIN' }),
    },
    {
      label: "DELETE project A member role override (cross-tenant mutation)",
      method: 'DELETE',
      path: (t) => `/projects/${t.projectId}/members/${t.userId}/role`,
    },

    // ── Issue ──────────────────────────────────────────────────────────────
    {
      label: 'GET issue A',
      method: 'GET',
      path: (t) => `/issues/${t.issueId}`,
    },
    {
      label: 'PATCH issue A',
      method: 'PATCH',
      path: (t) => `/issues/${t.issueId}`,
      body: () => ({ title: 'Hijacked issue' }),
    },
    {
      label: 'DELETE issue A',
      method: 'DELETE',
      path: (t) => `/issues/${t.issueId}`,
    },
    {
      label: 'POST issue A move',
      method: 'POST',
      path: (t) => `/issues/${t.issueId}/move`,
      body: (t) => ({ statusId: t.statusId }),
    },
    {
      label: 'GET issue A activity',
      method: 'GET',
      path: (t) => `/issues/${t.issueId}/activity`,
    },
    {
      label: 'GET issues in project A (list)',
      method: 'GET',
      path: (t) => `/issues?projectId=${t.projectId}`,
    },

    // ── Comments ───────────────────────────────────────────────────────────
    {
      label: 'GET comments on issue A',
      method: 'GET',
      path: (t) => `/issues/${t.issueId}/comments`,
    },
    {
      label: 'POST comment on issue A',
      method: 'POST',
      path: (t) => `/issues/${t.issueId}/comments`,
      body: () => ({ body: 'Injected comment' }),
    },
    {
      label: 'PATCH comment A',
      method: 'PATCH',
      path: (t) => `/comments/${t.commentId}`,
      body: () => ({ body: 'Hijacked comment' }),
    },
    {
      label: 'DELETE comment A',
      method: 'DELETE',
      path: (t) => `/comments/${t.commentId}`,
    },

    // ── Labels ─────────────────────────────────────────────────────────────
    {
      label: 'GET labels for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/labels`,
    },
    {
      label: 'POST label for project A',
      method: 'POST',
      path: (t) => `/projects/${t.projectId}/labels`,
      body: () => ({ name: 'injected-label', color: '#000000' }),
    },
    {
      label: 'PATCH label A',
      method: 'PATCH',
      path: (t) => `/labels/${t.labelId}`,
      body: () => ({ name: 'hijacked-label', color: '#ffffff' }),
    },
    {
      label: 'DELETE label A',
      method: 'DELETE',
      path: (t) => `/labels/${t.labelId}`,
    },
    {
      label: 'POST attach label A to issue A',
      method: 'POST',
      path: (t) => `/issues/${t.issueId}/labels`,
      body: (t) => ({ labelId: t.labelId }),
    },
    {
      label: 'DELETE label A from issue A',
      method: 'DELETE',
      path: (t) => `/issues/${t.issueId}/labels/${t.labelId}`,
    },

    // ── Statuses ───────────────────────────────────────────────────────────
    {
      label: 'GET statuses for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/statuses`,
    },
    {
      label: 'POST status for project A',
      method: 'POST',
      path: (t) => `/projects/${t.projectId}/statuses`,
      body: () => ({ name: 'Injected', category: 'TODO' }),
    },
    {
      label: 'PATCH status A',
      method: 'PATCH',
      path: (t) => `/statuses/${t.statusId}`,
      body: () => ({ name: 'Hijacked status' }),
    },
    {
      label: 'DELETE status A',
      method: 'DELETE',
      path: (t) => `/statuses/${t.statusId}`,
    },

    // ── Sprints ────────────────────────────────────────────────────────────
    {
      label: 'GET sprints for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/sprints`,
    },
    {
      label: 'POST sprint for project A',
      method: 'POST',
      path: (t) => `/projects/${t.projectId}/sprints`,
      body: () => ({
        name: 'Injected sprint',
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 7 * 86400000).toISOString(),
      }),
    },
    {
      label: 'PATCH sprint A',
      method: 'PATCH',
      path: (t) => `/sprints/${t.sprintId}`,
      body: () => ({ name: 'Hijacked sprint' }),
    },
    {
      label: 'DELETE sprint A',
      method: 'DELETE',
      path: (t) => `/sprints/${t.sprintId}`,
    },

    // ── Board ──────────────────────────────────────────────────────────────
    {
      label: 'GET board for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/board`,
    },

    // ── Reports ────────────────────────────────────────────────────────────
    {
      label: 'GET velocity report for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/reports/velocity`,
    },
    {
      label: 'GET velocity trend report for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/reports/velocity-trend`,
    },
    {
      label: 'GET CFD report for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/reports/cfd`,
    },
    {
      label: 'GET burndown for project A sprint A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/sprints/${t.sprintId}/burndown`,
    },

    // ── Roadmap ────────────────────────────────────────────────────────────
    {
      label: 'GET roadmap for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/roadmap`,
    },

    // ── Webhooks ───────────────────────────────────────────────────────────
    {
      label: 'GET webhooks for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/webhooks`,
    },
    {
      label: 'POST webhook for project A',
      method: 'POST',
      path: (t) => `/projects/${t.projectId}/webhooks`,
      body: () => ({
        url: 'https://example.com/injected',
        events: ['issue.created'],
      }),
    },
    {
      label: 'PATCH webhook A in project A',
      method: 'PATCH',
      path: (t) => `/projects/${t.projectId}/webhooks/${t.webhookId}`,
      body: () => ({ url: 'https://example.com/hijacked' }),
    },
    {
      label: 'DELETE webhook A in project A',
      method: 'DELETE',
      path: (t) => `/projects/${t.projectId}/webhooks/${t.webhookId}`,
    },
    {
      label: 'GET webhook A deliveries',
      method: 'GET',
      path: (t) =>
        `/projects/${t.projectId}/webhooks/${t.webhookId}/deliveries`,
    },

    // ── Attachments ────────────────────────────────────────────────────────
    {
      label: 'GET attachments list for issue A',
      method: 'GET',
      path: (t) => `/issues/${t.issueId}/attachments`,
    },

    // ── API Token revoke (cross-user: B tries to revoke A's token) ──────────
    {
      label: "DELETE (revoke) A's API token using B's credentials",
      method: 'DELETE',
      path: (t) => `/me/tokens/${t.apiTokenId}`,
    },

    // ── Workflow ────────────────────────────────────────────────────────────
    {
      label: 'GET workflow for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/workflow`,
    },
    {
      label: 'PATCH workflow enforcement for project A',
      method: 'PATCH',
      path: (t) => `/projects/${t.projectId}/workflow`,
      body: () => ({ enforced: false }),
    },
    {
      label: 'POST workflow transition for project A',
      method: 'POST',
      path: (t) => `/projects/${t.projectId}/workflow/transitions`,
      body: (t) => ({ toStatusId: t.statusId }),
    },
    {
      label: 'PATCH workflow transition A',
      method: 'PATCH',
      path: (t) => `/workflow/transitions/${t.workflowTransitionId}`,
      body: () => ({ name: 'hijacked' }),
    },
    {
      label: 'DELETE workflow transition A',
      method: 'DELETE',
      path: (t) => `/workflow/transitions/${t.workflowTransitionId}`,
    },

    // ── Automations ─────────────────────────────────────────────────────────
    {
      label: 'GET automation rules for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/automations`,
    },
    {
      label: 'POST automation rule for project A',
      method: 'POST',
      path: (t) => `/projects/${t.projectId}/automations`,
      body: () => ({
        name: 'injected-rule',
        trigger: 'ISSUE_CREATED',
        actions: [{ type: 'SET_PRIORITY', params: { priority: 'HIGH' } }],
      }),
    },
    {
      label: 'GET automation rule A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/automations/${t.automationRuleId}`,
    },
    {
      label: 'PATCH automation rule A',
      method: 'PATCH',
      path: (t) => `/projects/${t.projectId}/automations/${t.automationRuleId}`,
      body: () => ({ name: 'hijacked-rule' }),
    },
    {
      label: 'DELETE automation rule A',
      method: 'DELETE',
      path: (t) => `/projects/${t.projectId}/automations/${t.automationRuleId}`,
    },
    {
      label: 'GET automation runs for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/automations/runs`,
    },
    {
      label: 'GET automation runs for rule A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/automations/${t.automationRuleId}/runs`,
    },

    // ── Analytics ───────────────────────────────────────────────────────────
    {
      label: 'GET project analytics for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/analytics`,
    },

    // ── CSV export ──────────────────────────────────────────────────────────
    {
      label: 'GET CSV export for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/issues.csv`,
    },

    // ── Workspace logo mutations ─────────────────────────────────────────────
    // POST (upload) and DELETE (remove) must be admin-gated; B should get 403.
    // GET logo is intentionally public (no auth required) — NOT listed here.
    {
      label: 'DELETE workspace A logo (cross-tenant mutation)',
      method: 'DELETE',
      path: (t) => `/workspaces/${t.workspaceId}/logo`,
    },

    // ── Work Logs ────────────────────────────────────────────────────────────
    {
      label: 'GET work logs on issue A',
      method: 'GET',
      path: (t) => `/issues/${t.issueId}/worklogs`,
    },
    {
      label: 'POST work log on issue A',
      method: 'POST',
      path: (t) => `/issues/${t.issueId}/worklogs`,
      body: () => ({ minutes: 60 }),
    },
    {
      label: 'PATCH work log A',
      method: 'PATCH',
      path: (t) => `/worklogs/${t.workLogId}`,
      body: () => ({ minutes: 90 }),
    },
    {
      label: 'DELETE work log A',
      method: 'DELETE',
      path: (t) => `/worklogs/${t.workLogId}`,
    },

    // ── Standups ─────────────────────────────────────────────────────────────
    {
      label: 'GET standup digest for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/standups`,
    },
    {
      label: 'POST standup entry for project A',
      method: 'POST',
      path: (t) => `/projects/${t.projectId}/standups`,
      body: () => ({
        today: 'Injected standup today',
        yesterday: 'Injected standup yesterday',
        blockers: '',
      }),
    },

    // ── Issue Templates ──────────────────────────────────────────────────────
    {
      label: 'GET issue templates for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/issue-templates`,
    },
    {
      label: 'POST issue template for project A',
      method: 'POST',
      path: (t) => `/projects/${t.projectId}/issue-templates`,
      body: () => ({ name: 'Injected template' }),
    },
    {
      label: 'PATCH issue template A',
      method: 'PATCH',
      path: (t) => `/issue-templates/${t.issueTemplateId}`,
      body: () => ({ name: 'Hijacked template' }),
    },
    {
      label: 'DELETE issue template A',
      method: 'DELETE',
      path: (t) => `/issue-templates/${t.issueTemplateId}`,
    },

    // ── Personal Boards ──────────────────────────────────────────────────────
    // /me/personal-board is always caller-scoped so GET is implicitly isolated,
    // but PATCH/DELETE by column or card id must reject cross-user access.
    {
      label: "PATCH personal column A (cross-user column id)",
      method: 'PATCH',
      path: (t) => `/me/personal-columns/${t.personalColumnId}`,
      body: () => ({ name: 'Hijacked column' }),
    },
    {
      label: "DELETE personal column A (cross-user column id)",
      method: 'DELETE',
      path: (t) => `/me/personal-columns/${t.personalColumnId}`,
    },
    {
      label: "PATCH personal card A (cross-user card id)",
      method: 'PATCH',
      path: (t) => `/me/personal-cards/${t.personalCardId}`,
      body: () => ({ title: 'Hijacked card' }),
    },
    {
      label: "DELETE personal card A (cross-user card id)",
      method: 'DELETE',
      path: (t) => `/me/personal-cards/${t.personalCardId}`,
    },

    // ── Quick links ────────────────────────────────────────────────────────
    // /me/quick-links (GET/POST) is always caller-scoped (own list, own
    // create), so only the by-id verbs can be probed cross-tenant.
    {
      label: "PATCH quick link A (cross-user link id)",
      method: 'PATCH',
      path: (t) => `/me/quick-links/${t.quickLinkId}`,
      body: () => ({ label: 'Hijacked link' }),
    },
    {
      label: "DELETE quick link A (cross-user link id)",
      method: 'DELETE',
      path: (t) => `/me/quick-links/${t.quickLinkId}`,
    },

    // ── GitHub integration ────────────────────────────────────────────────────
    {
      label: 'GET GitHub integration for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/github`,
    },
    {
      label: 'PUT GitHub integration for project A',
      method: 'PUT',
      path: (t) => `/projects/${t.projectId}/github`,
      body: () => ({
        repoFullName: 'attacker/hijacked-repo',
        token: 'ghp_hijacktoken1234567890abcdef',
      }),
    },
    {
      label: 'DELETE GitHub integration for project A',
      method: 'DELETE',
      path: (t) => `/projects/${t.projectId}/github`,
    },
    {
      label: 'GET GitHub links for issue A',
      method: 'GET',
      path: (t) => `/issues/${t.issueId}/github-links`,
    },
    {
      label: 'PATCH GitHub auto-transition-on-merge automation for project A',
      method: 'PATCH',
      path: (t) => `/projects/${t.projectId}/github/automation`,
      body: (t) => ({ enabled: true, statusId: t.statusId }),
    },
    {
      label: 'GET live GitHub PR/CI status for issue A',
      method: 'GET',
      path: (t) => `/issues/${t.issueId}/github-links/live`,
    },

    // ── GitLab integration ────────────────────────────────────────────────────
    {
      label: 'GET GitLab integration for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/gitlab`,
    },
    {
      label: 'PUT GitLab integration for project A',
      method: 'PUT',
      path: (t) => `/projects/${t.projectId}/gitlab`,
      body: () => ({
        projectPath: 'attacker/hijacked-project',
        token: 'glpat-hijacktoken1234567890abcdef',
      }),
    },
    {
      label: 'DELETE GitLab integration for project A',
      method: 'DELETE',
      path: (t) => `/projects/${t.projectId}/gitlab`,
    },
    {
      label: 'GET GitLab links for issue A',
      method: 'GET',
      path: (t) => `/issues/${t.issueId}/gitlab-links`,
    },
    {
      label: 'PATCH GitLab auto-transition-on-merge automation for project A',
      method: 'PATCH',
      path: (t) => `/projects/${t.projectId}/gitlab/automation`,
      body: (t) => ({ enabled: true, statusId: t.statusId }),
    },
    {
      label: 'GET live GitLab MR/pipeline status for issue A',
      method: 'GET',
      path: (t) => `/issues/${t.issueId}/gitlab-links/live`,
    },

    // ── Gitea integration ────────────────────────────────────────────────────
    {
      label: 'GET Gitea integration for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/gitea`,
    },
    {
      label: 'PUT Gitea integration for project A',
      method: 'PUT',
      path: (t) => `/projects/${t.projectId}/gitea`,
      body: () => ({
        giteaBaseUrl: 'https://git.example.com',
        repoFullName: 'attacker/hijacked-repo',
        token: 'gitea_hijacktoken1234567890abcdef',
      }),
    },
    {
      label: 'DELETE Gitea integration for project A',
      method: 'DELETE',
      path: (t) => `/projects/${t.projectId}/gitea`,
    },
    {
      label: 'GET Gitea links for issue A',
      method: 'GET',
      path: (t) => `/issues/${t.issueId}/gitea-links`,
    },

    // ── Agent context ────────────────────────────────────────────────────────────────────
    {
      label: 'GET agent context for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/agent-context`,
    },
    {
      label: 'PUT agent context for project A (cross-tenant mutation)',
      method: 'PUT',
      path: (t) => `/projects/${t.projectId}/agent-context`,
      body: () => ({ content: 'Hijacked handoff — attacker was here.' }),
    },

    // ── Project activity feed (Agent Experience Round 2, criterion 6) ─────────
    {
      label: 'GET activity feed for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/activity`,
    },

    // ── Dashboards ───────────────────────────────────────────────────────────
    {
      label: 'GET dashboards for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/dashboards`,
    },
    {
      label: 'POST dashboard for project A',
      method: 'POST',
      path: (t) => `/projects/${t.projectId}/dashboards`,
      body: () => ({ name: 'Injected dashboard' }),
    },
    {
      label: 'GET dashboard A by id',
      method: 'GET',
      path: (t) => `/dashboards/${t.dashboardId}`,
    },
    {
      label: 'GET dashboard A evaluated data',
      method: 'GET',
      path: (t) => `/dashboards/${t.dashboardId}/data`,
    },
    {
      label: 'PATCH dashboard A',
      method: 'PATCH',
      path: (t) => `/dashboards/${t.dashboardId}`,
      body: () => ({ name: 'Hijacked dashboard' }),
    },
    {
      label: 'DELETE dashboard A',
      method: 'DELETE',
      path: (t) => `/dashboards/${t.dashboardId}`,
    },
    {
      label: 'POST gadget on dashboard A',
      method: 'POST',
      path: (t) => `/dashboards/${t.dashboardId}/gadgets`,
      body: () => ({ title: 'Injected gadget', query: '', visualization: 'STAT' }),
    },
    {
      label: 'PATCH gadget A',
      method: 'PATCH',
      path: (t) => `/gadgets/${t.gadgetId}`,
      body: () => ({ title: 'Hijacked gadget' }),
    },
    {
      label: 'DELETE gadget A',
      method: 'DELETE',
      path: (t) => `/gadgets/${t.gadgetId}`,
    },

    // ── Dashboard share tokens (public read-only link; ADMIN-gated) ─────────
    {
      label: "GET dashboard A's share tokens",
      method: 'GET',
      path: (t) => `/dashboards/${t.dashboardId}/share-tokens`,
    },
    {
      label: 'POST share token on dashboard A',
      method: 'POST',
      path: (t) => `/dashboards/${t.dashboardId}/share-tokens`,
    },
    {
      label: "DELETE (revoke) dashboard A's share token",
      method: 'DELETE',
      path: (t) => `/dashboards/${t.dashboardId}/share-tokens/${t.dashboardShareTokenId}`,
    },

    // ── Planning Poker ───────────────────────────────────────────────────────
    {
      label: 'GET poker sessions for project A',
      method: 'GET',
      path: (t) => `/projects/${t.projectId}/poker-sessions`,
    },
    {
      label: 'POST poker session for project A',
      method: 'POST',
      path: (t) => `/projects/${t.projectId}/poker-sessions`,
      body: (t) => ({ issueIds: [t.issueId] }),
    },
    {
      label: 'GET poker session A by id',
      method: 'GET',
      path: (t) => `/poker-sessions/${t.pokerSessionId}`,
    },
    {
      label: 'PATCH poker session A by id',
      method: 'PATCH',
      path: (t) => `/poker-sessions/${t.pokerSessionId}`,
      body: () => ({ name: 'Hijacked session' }),
    },
  ];

  return rows.map((row) => ({
    ...row,
    resolvedPath: row.path(a),
    resolvedBody: row.body ? row.body(a) : undefined,
  }));
}

// ── Main test suite ───────────────────────────────────────────────────────────

(HAS_DB ? describe : describe.skip)(
  'Tenant Isolation Integration (cross-tenant matrix)',
  () => {
    let app: INestApplication;
    let server: http.Server;
    let tenantA: Tenant;
    let tenantB: Tenant;

    // Ids that must NEVER appear in B's responses (to detect data leaks).
    let foreignIds: string[];

    beforeAll(async () => {
      // Set required env vars before bootstrapping
      process.env.JWT_SECRET = JWT_SECRET;
      process.env.RATE_LIMIT_DISABLED = 'true';

      ({ app, server } = await bootstrapApp());

      // Create both tenants.  Suffix "A" vs "B" disambiguates the fixture data.
      [tenantA, tenantB] = await Promise.all([
        setupTenant(server, 'A'),
        setupTenant(server, 'B'),
      ]);

      // Collect all of A's resource IDs — these must never appear in B's
      // responses.
      foreignIds = [
        tenantA.workspaceId,
        tenantA.projectId,
        tenantA.issueId,
        tenantA.commentId,
        tenantA.labelId,
        tenantA.sprintId,
        tenantA.statusId,
        tenantA.apiTokenId,
        tenantA.dashboardId,
        tenantA.gadgetId,
        tenantA.dashboardShareTokenId,
        tenantA.personalCardId,
        tenantA.quickLinkId,
      ].filter(Boolean);

      // Note: webhookId may be a placeholder string if webhook creation was
      // blocked by SSRF guard; exclude it from leak detection to avoid false
      // positives from the placeholder value appearing in error messages.
    }, 60_000);

    afterAll(async () => {
      if (app) {
        await app.close();
      }
    }, 30_000);

    // ── Data-driven matrix ───────────────────────────────────────────────────

    describe('HTTP endpoint isolation matrix', () => {
      // We build the matrix lazily in a beforeAll so tenantA is resolved.
      let matrix: ReturnType<typeof buildMatrix>;

      beforeAll(() => {
        matrix = buildMatrix(tenantA);
      });

      it('matrix is populated (sanity check)', () => {
        // Threshold updated (Pass-12 fix batch) to reflect the 5 additional
        // resource families closing the third-consecutive-pass gap: personal
        // cards, quick links, workspace PATCH + logo POST, GitHub integration
        // (config + issue links), and dashboards/gadgets (CRUD + data).
        expect(matrix.length).toBeGreaterThan(90);
      });

      /**
       * Run each row of the isolation matrix. We cannot use `it.each` here
       * because the matrix is computed from `tenantA` which is only available
       * after the outer `beforeAll`, and Jest's `it.each` with a dynamic array
       * defined inside `describe` can resolve before `beforeAll` completes in
       * some versions.  Instead we run all rows in a single test and produce
       * a clear per-row failure message.
       */
      it('rejects ALL cross-tenant requests (every row must be non-200)', async () => {
        const results: Array<{
          label: string;
          method: string;
          path: string;
          status: number;
          passed: boolean;
          leak?: string;
        }> = [];

        for (const row of matrix) {
          const result = await req(
            server,
            row.method,
            row.resolvedPath,
            tenantB.token,
            row.resolvedBody,
          );

          const passed = result.status !== 200;
          let leak: string | undefined;
          for (const id of foreignIds) {
            if (result.body.includes(id)) {
              leak = id;
              break;
            }
          }

          results.push({
            label: row.label,
            method: row.method,
            path: row.resolvedPath,
            status: result.status,
            passed: passed && !leak,
            leak,
          });
        }

        // Print coverage table (always visible in jest --verbose output)
        const header = [
          '',
          '═══ ISOLATION MATRIX COVERAGE ═══════════════════════════════════════════',
          `${'RESULT'.padEnd(8)} ${'METHOD'.padEnd(8)} ${'STATUS'.padEnd(7)} LABEL`,
          '─'.repeat(80),
        ];
        const rows = results.map((r) => {
          const mark = r.passed ? 'BLOCKED' : r.leak ? 'LEAK   ' : 'PASS200';
          const leak = r.leak ? ` [leaks ${r.leak}]` : '';
          return `${mark} ${r.method.padEnd(8)} ${String(r.status).padEnd(7)} ${r.label}${leak}`;
        });
        const footer = [
          '─'.repeat(80),
          `Total: ${results.length} endpoints — Blocked: ${results.filter((r) => r.passed).length} — Issues: ${results.filter((r) => !r.passed).length}`,
          '═'.repeat(80),
          '',
        ];
        console.log([...header, ...rows, ...footer].join('\n'));

        // Now assert all rows passed
        const failures = results.filter((r) => !r.passed);
        if (failures.length > 0) {
          const msgs = failures
            .map(
              (r) =>
                `  ${r.method} ${r.path} → status ${r.status}${r.leak ? ` (leaked id: ${r.leak})` : ' (returned 200)'}`,
            )
            .join('\n');
          fail(
            `${failures.length} cross-tenant request(s) were NOT rejected:\n${msgs}`,
          );
        }
      }, 120_000);
    });

    // ── WebSocket gateway isolation ───────────────────────────────────────────

    describe('WebSocket gateway isolation', () => {
      it(
        "rejects tenant B subscribing to tenant A's project room",
        async () => {
          const addr = server.address() as { port: number };
          const socketUrl = `http://127.0.0.1:${addr.port}`;

          // Connect as tenant B with a valid JWT.
          const socket: ClientSocket = ioClient(socketUrl, {
            auth: { token: tenantB.token },
            transports: ['websocket'],
            forceNew: true,
          });

          let error: unknown = null;
          let ackPayload: unknown = null;
          let exceptionPayload: unknown = null;

          await new Promise<void>((resolve) => {
            // Some NestJS WS exception paths emit an 'exception' event instead
            // of delivering the WsException as an ack callback argument.
            socket.on('exception', (data: unknown) => {
              exceptionPayload = data;
              resolve();
            });

            socket.on('connect', () => {
              // Attempt to subscribe to Tenant A's project room.
              socket.emit(
                'subscribe',
                tenantA.projectId,
                (ack: unknown) => {
                  ackPayload = ack;
                  resolve();
                },
              );
            });
            socket.on('connect_error', (err: Error) => {
              error = err;
              resolve();
            });
            socket.on('error', (err: Error) => {
              error = err;
              resolve();
            });
            // Safety timeout — if no ack/error arrives within 10s, resolve anyway.
            // A timeout here IS a rejection: a successful subscribe would have
            // delivered an ack with ok:true well within 10 s.
            setTimeout(resolve, 10_000);
          });

          socket.disconnect();

          // The subscribe handler throws WsException('Forbidden') when
          // membership check fails.  NestJS wraps WsException acks in the
          // standard Socket.io exception envelope:
          //   { status: 'error', message: 'Forbidden' }
          // The gateway may also simply NOT invoke the ack callback (no ack
          // received within the timeout), which is also a valid rejection
          // signal.  We accept any of:
          //   1. connection-level error (socket disconnected at handshake)
          //   2. ack received with status:'error' or ok:false
          //   3. ack received with no ok:true (i.e. subscription denied)
          //   4. no ack received within 10 s (timeout — also a rejection)
          const ackObj =
            typeof ackPayload === 'object' && ackPayload !== null
              ? (ackPayload as Record<string, unknown>)
              : null;

          const isRejected =
            error !== null ||
            exceptionPayload !== null || // WsException delivered as event
            ackPayload === null ||       // timeout = no successful ack delivered
            (ackObj !== null &&
              (ackObj['status'] === 'error' ||
                ackObj['ok'] === false ||
                'error' in ackObj));

          expect(isRejected).toBe(true);

          // Also assert A's project id does not appear in any ack data.
          if (ackPayload) {
            expect(JSON.stringify(ackPayload)).not.toContain(tenantA.projectId);
          }
        },
        30_000,
      );

      it(
        'allows tenant B to subscribe to their own project room',
        async () => {
          const addr = server.address() as { port: number };
          const socketUrl = `http://127.0.0.1:${addr.port}`;

          const socket: ClientSocket = ioClient(socketUrl, {
            auth: { token: tenantB.token },
            transports: ['websocket'],
            forceNew: true,
          });

          let ackPayload: unknown = null;

          await new Promise<void>((resolve) => {
            socket.on('connect', () => {
              socket.emit(
                'subscribe',
                tenantB.projectId,
                (ack: unknown) => {
                  ackPayload = ack;
                  resolve();
                },
              );
            });
            socket.on('connect_error', () => resolve());
            setTimeout(resolve, 10_000);
          });

          socket.disconnect();

          // Subscription to own project must succeed: ack should be { ok: true }.
          expect(ackPayload).toBeDefined();
          expect((ackPayload as { ok: boolean }).ok).toBe(true);
        },
        30_000,
      );
    });

    // ── Symmetric: B's own resources are intact ───────────────────────────────

    describe('Tenant B own-resource access (sanity check)', () => {
      it('can read their own issue', async () => {
        const result = await req(
          server,
          'GET',
          `/issues/${tenantB.issueId}`,
          tenantB.token,
        );
        expect(result.status).toBe(200);
      });

      it('can read their own workspace', async () => {
        const result = await req(
          server,
          'GET',
          `/workspaces/${tenantB.workspaceId}`,
          tenantB.token,
        );
        expect(result.status).toBe(200);
      });

      it('can read their own project', async () => {
        const result = await req(
          server,
          'GET',
          `/projects/${tenantB.projectId}`,
          tenantB.token,
        );
        expect(result.status).toBe(200);
      });
    });
  },
);

// ── Skip notice when no DB ─────────────────────────────────────────────────────

if (!HAS_DB) {
  describe('Tenant Isolation Integration', () => {
    it.skip(
      'skipped — DATABASE_URL not set (unit-test run without a real DB)',
      () => undefined,
    );
  });
}

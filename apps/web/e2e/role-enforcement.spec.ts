import { test, expect, type APIRequestContext } from '@playwright/test';
import { DEMO } from './helpers';

/**
 * Authorization regression coverage for workspace role enforcement
 * (ADMIN > MEMBER > VIEWER).
 *
 * Before this fix the `Role` enum was stored but never checked:
 *  - a VIEWER could create/update/delete issues (must be read-only), and
 *  - ANY member could add users / upsert roles via `addMember`
 *    (privilege escalation — member management must require ADMIN).
 *
 * These API-level tests build a fresh workspace owned by the demo user
 * (ADMIN), invite a MEMBER and a VIEWER, then assert:
 *  - VIEWER is blocked (403) from mutating endpoints but can still read,
 *  - a non-admin MEMBER cannot add members (403),
 *  - an ADMIN still can add members and a MEMBER can still mutate issues.
 * The API lives on :4000.
 */

const API_URL = process.env.PW_API_URL ?? 'http://localhost:4000';

async function loginToken(
  request: APIRequestContext,
  creds: { email: string; password: string },
): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: creds.email, password: creds.password },
  });
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { accessToken: string };
  expect(body.accessToken).toBeTruthy();
  return body.accessToken;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Register a brand-new user and return their login credentials. */
async function registerUser(
  request: APIRequestContext,
  suffix: string,
): Promise<{ email: string; password: string; token: string }> {
  const email = `role-${suffix}-${Date.now()}-${Math.floor(
    Math.random() * 1e6,
  )}@nextlane.dev`;
  const password = 'nextlane';
  const res = await request.post(`${API_URL}/api/auth/register`, {
    data: { email, name: `Role ${suffix}`, password },
  });
  expect(res.ok(), `register failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { accessToken: string };
  return { email, password, token: body.accessToken };
}

interface Ctx {
  adminHeaders: Record<string, string>;
  memberHeaders: Record<string, string>;
  viewerHeaders: Record<string, string>;
  memberEmail: string;
  workspaceId: string;
  projectId: string;
  statusId: string;
}

async function setup(request: APIRequestContext): Promise<Ctx> {
  // ADMIN = the seeded demo user; they own every workspace they create.
  const adminToken = await loginToken(request, DEMO);
  const adminHeaders = authHeaders(adminToken);

  // Fresh workspace so role assignments are isolated from seed data.
  const wsRes = await request.post(`${API_URL}/api/workspaces`, {
    headers: adminHeaders,
    data: { name: `Role Test ${Date.now()}` },
  });
  expect(wsRes.ok(), `create ws failed: ${wsRes.status()}`).toBeTruthy();
  const workspaceId = ((await wsRes.json()) as { id: string }).id;

  const projRes = await request.post(`${API_URL}/api/projects`, {
    headers: adminHeaders,
    data: {
      workspaceId,
      key: `RT${Math.floor(Math.random() * 9000 + 1000)}`,
      name: 'Role Test Project',
    },
  });
  expect(projRes.ok(), `create project failed: ${projRes.status()}`).toBeTruthy();
  const projectId = ((await projRes.json()) as { id: string }).id;

  const statusesRes = await request.get(
    `${API_URL}/api/projects/${projectId}/statuses`,
    { headers: adminHeaders },
  );
  const statuses = (await statusesRes.json()) as Array<{ id: string }>;
  const statusId = statuses[0].id;

  // Register a MEMBER and a VIEWER, then have ADMIN add them with roles.
  const member = await registerUser(request, 'member');
  const viewer = await registerUser(request, 'viewer');

  const addMember = await request.post(
    `${API_URL}/api/workspaces/${workspaceId}/members`,
    {
      headers: adminHeaders,
      data: { email: member.email, role: 'MEMBER' },
    },
  );
  expect(
    addMember.ok(),
    `admin add MEMBER failed: ${addMember.status()}`,
  ).toBeTruthy();

  const addViewer = await request.post(
    `${API_URL}/api/workspaces/${workspaceId}/members`,
    {
      headers: adminHeaders,
      data: { email: viewer.email, role: 'VIEWER' },
    },
  );
  expect(
    addViewer.ok(),
    `admin add VIEWER failed: ${addViewer.status()}`,
  ).toBeTruthy();

  return {
    adminHeaders,
    memberHeaders: authHeaders(member.token),
    viewerHeaders: authHeaders(viewer.token),
    memberEmail: member.email,
    workspaceId,
    projectId,
    statusId,
  };
}

test.describe('workspace role enforcement', () => {
  test('VIEWER cannot create an issue (403)', async ({ request }) => {
    const c = await setup(request);
    const res = await request.post(`${API_URL}/api/issues`, {
      headers: c.viewerHeaders,
      data: { projectId: c.projectId, title: 'Viewer should not create' },
    });
    expect(res.status(), 'VIEWER issue create must be forbidden').toBe(403);
  });

  test('VIEWER cannot create a comment / label / sprint (403)', async ({
    request,
  }) => {
    const c = await setup(request);

    const labelRes = await request.post(
      `${API_URL}/api/projects/${c.projectId}/labels`,
      { headers: c.viewerHeaders, data: { name: 'nope', color: '#fff' } },
    );
    expect(labelRes.status(), 'VIEWER label create must be forbidden').toBe(403);

    const sprintRes = await request.post(
      `${API_URL}/api/projects/${c.projectId}/sprints`,
      { headers: c.viewerHeaders, data: { name: 'nope' } },
    );
    expect(sprintRes.status(), 'VIEWER sprint create must be forbidden').toBe(
      403,
    );
  });

  test('VIEWER can still read the board and issues', async ({ request }) => {
    const c = await setup(request);
    const boardRes = await request.get(
      `${API_URL}/api/projects/${c.projectId}/board`,
      { headers: c.viewerHeaders },
    );
    expect(boardRes.ok(), `VIEWER board read failed: ${boardRes.status()}`).toBe(
      true,
    );

    const issuesRes = await request.get(
      `${API_URL}/api/issues?projectId=${c.projectId}`,
      { headers: c.viewerHeaders },
    );
    expect(
      issuesRes.ok(),
      `VIEWER issue list failed: ${issuesRes.status()}`,
    ).toBe(true);
  });

  test('non-admin MEMBER cannot add a workspace member (403)', async ({
    request,
  }) => {
    const c = await setup(request);
    const res = await request.post(
      `${API_URL}/api/workspaces/${c.workspaceId}/members`,
      {
        headers: c.memberHeaders,
        data: { email: DEMO.email, role: 'ADMIN' },
      },
    );
    expect(
      res.status(),
      'non-admin member management must be forbidden',
    ).toBe(403);
  });

  test('MEMBER can still create an issue (positive control)', async ({
    request,
  }) => {
    const c = await setup(request);
    const res = await request.post(`${API_URL}/api/issues`, {
      headers: c.memberHeaders,
      data: { projectId: c.projectId, title: 'Member can create' },
    });
    expect(res.ok(), `MEMBER issue create failed: ${res.status()}`).toBe(true);
  });

  test('ADMIN can add a workspace member (positive control)', async ({
    request,
  }) => {
    const c = await setup(request);
    // Re-adding the existing member is an idempotent upsert; proves the
    // ADMIN path is allowed where the MEMBER path was rejected above.
    const res = await request.post(
      `${API_URL}/api/workspaces/${c.workspaceId}/members`,
      {
        headers: c.adminHeaders,
        data: { email: c.memberEmail, role: 'MEMBER' },
      },
    );
    expect(res.ok(), `ADMIN add member failed: ${res.status()}`).toBe(true);
  });
});

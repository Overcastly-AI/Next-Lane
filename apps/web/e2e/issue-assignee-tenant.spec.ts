import { test, expect, type APIRequestContext } from '@playwright/test';
import { DEMO } from './helpers';

/**
 * Security regression coverage for cross-tenant assignee injection on issue
 * create & update. Before this fix, `IssuesService.create`/`update` wrote
 * `assigneeId` verbatim without checking the user belonged to the project's
 * workspace — any authenticated user from any tenant could be set as assignee
 * on another tenant's issue.
 *
 * These tests register a fresh "outsider" user (who gets their own separate
 * workspace and is NOT a co-member of the demo workspace), then assert that
 * assigning the outsider to a demo-project issue is rejected, while assigning a
 * real co-member (the demo user) succeeds. The API lives on :4000.
 */

const API_URL = process.env.PW_API_URL ?? 'http://localhost:4000';

async function loginToken(
  request: APIRequestContext,
  creds = DEMO,
): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: creds.email, password: creds.password },
  });
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { accessToken: string };
  expect(body.accessToken).toBeTruthy();
  return body.accessToken;
}

interface Ctx {
  headers: Record<string, string>;
  projectId: string;
  issueId: string;
  demoUserId: string;
  outsiderUserId: string;
}

async function setup(request: APIRequestContext): Promise<Ctx> {
  const token = await loginToken(request);
  const headers = { Authorization: `Bearer ${token}` };

  const meRes = await request.get(`${API_URL}/api/auth/me`, { headers });
  expect(meRes.ok(), `me failed: ${meRes.status()}`).toBeTruthy();
  const demoUserId = ((await meRes.json()) as { id: string }).id;

  // A fresh workspace + project owned by the demo user (NOT the seeded demo
  // project), so the positive-control mutations never pollute the demo. The
  // demo user is the project's own co-member (a legitimate assignee).
  const wsRes = await request.post(`${API_URL}/api/workspaces`, {
    headers,
    data: { name: `Assignee Test ${Date.now()}` },
  });
  expect(wsRes.ok(), `create ws failed: ${wsRes.status()}`).toBeTruthy();
  const workspaceId = ((await wsRes.json()) as { id: string }).id;

  const projRes = await request.post(`${API_URL}/api/projects`, {
    headers,
    data: {
      workspaceId,
      key: `AT${Math.floor(Math.random() * 9000 + 1000)}`,
      name: 'Assignee Test Project',
    },
  });
  expect(projRes.ok(), `create project failed: ${projRes.status()}`).toBeTruthy();
  const projectId = ((await projRes.json()) as { id: string }).id;

  // An issue in the project to mutate.
  const issueRes = await request.post(`${API_URL}/api/issues`, {
    headers,
    data: { projectId, title: 'Issue under assignee test' },
  });
  expect(issueRes.ok(), `create issue failed: ${issueRes.status()}`).toBeTruthy();
  const issueId = ((await issueRes.json()) as { id: string }).id;

  // Register a fresh outsider user. They get their own workspace on register
  // and are NOT a member of the demo workspace.
  const email = `outsider-${Date.now()}-${Math.floor(
    Math.random() * 1e6,
  )}@example.com`;
  const regRes = await request.post(`${API_URL}/api/auth/register`, {
    data: { email, name: 'Outsider User', password: 'outsider-pass' },
  });
  expect(regRes.ok(), `register failed: ${regRes.status()}`).toBeTruthy();
  const reg = (await regRes.json()) as {
    user?: { id: string };
    accessToken: string;
  };
  let outsiderUserId = reg.user?.id ?? '';
  if (!outsiderUserId) {
    const outMe = await request.get(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${reg.accessToken}` },
    });
    outsiderUserId = ((await outMe.json()) as { id: string }).id;
  }
  expect(outsiderUserId, 'outsider user id missing').toBeTruthy();

  return { headers, projectId, issueId, demoUserId, outsiderUserId };
}

test.describe('issue assignee tenant isolation', () => {
  test('rejects creating an issue assigned to a non-co-member', async ({
    request,
  }) => {
    const c = await setup(request);
    const res = await request.post(`${API_URL}/api/issues`, {
      headers: c.headers,
      data: {
        projectId: c.projectId,
        title: 'Should not assign outsider',
        assigneeId: c.outsiderUserId,
      },
    });
    expect(
      [400, 403].includes(res.status()),
      `foreign create assigneeId must be rejected, got ${res.status()}`,
    ).toBeTruthy();
  });

  test('rejects updating an issue assigned to a non-co-member', async ({
    request,
  }) => {
    const c = await setup(request);
    const res = await request.patch(`${API_URL}/api/issues/${c.issueId}`, {
      headers: c.headers,
      data: { assigneeId: c.outsiderUserId },
    });
    expect(
      [400, 403].includes(res.status()),
      `foreign update assigneeId must be rejected, got ${res.status()}`,
    ).toBeTruthy();
  });

  test('allows assigning a real co-member on update', async ({ request }) => {
    const c = await setup(request);
    const res = await request.patch(`${API_URL}/api/issues/${c.issueId}`, {
      headers: c.headers,
      data: { assigneeId: c.demoUserId },
    });
    expect(
      res.ok(),
      `co-member assignment failed: ${res.status()}`,
    ).toBeTruthy();
    const body = (await res.json()) as { assignee?: { id: string } | null };
    expect(body.assignee?.id).toBe(c.demoUserId);
  });

  test('allows unassign (null) on update', async ({ request }) => {
    const c = await setup(request);
    const res = await request.patch(`${API_URL}/api/issues/${c.issueId}`, {
      headers: c.headers,
      data: { assigneeId: null },
    });
    expect(res.ok(), `unassign failed: ${res.status()}`).toBeTruthy();
    const body = (await res.json()) as { assignee?: { id: string } | null };
    expect(body.assignee ?? null).toBeNull();
  });
});

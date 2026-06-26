import { test, expect, type APIRequestContext } from '@playwright/test';
import { DEMO } from './helpers';

/**
 * Security regression coverage for cross-project (cross-tenant) id injection on
 * issue update & move. Before this fix, `IssuesService.update`/`move` only
 * checked that the caller was a member of the issue's OWN project, then wrote
 * `statusId`/`sprintId`/`parentId`/`beforeId`/`afterId` verbatim. A user who is
 * a member of two projects (A and B) could attach an issue in project A to
 * project B's status/sprint/parent, corrupting B's board, or reorder against a
 * foreign issue and leak B's rank ordering.
 *
 * These tests create a second project B (the demo user is a member of both),
 * then assert that every cross-project reference is rejected with 400 while
 * legitimate same-project references still succeed. The API lives on :4000.
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
  workspaceId: string;
  // Project A: the seeded demo project the issue under test lives in.
  projectA: string;
  issueA: string;
  statusA: string;
  // Project B: a second project in a fresh workspace, foreign to A.
  projectB: string;
  statusB: string;
  sprintB: string;
  issueB: string;
}

async function setup(request: APIRequestContext): Promise<Ctx> {
  const token = await loginToken(request);
  const headers = { Authorization: `Bearer ${token}` };

  // Project A = seeded NL project.
  const wsRes = await request.get(`${API_URL}/api/workspaces`, { headers });
  expect(wsRes.ok(), `workspaces failed: ${wsRes.status()}`).toBeTruthy();
  const workspaces = (await wsRes.json()) as Array<{ id: string }>;
  const workspaceId = workspaces[0].id;

  const projRes = await request.get(
    `${API_URL}/api/projects?workspaceId=${workspaceId}`,
    { headers },
  );
  const projects = (await projRes.json()) as Array<{ id: string; key: string }>;
  const projectA = (projects.find((p) => p.key === 'NL') ?? projects[0]).id;

  const statusesARes = await request.get(
    `${API_URL}/api/projects/${projectA}/statuses`,
    { headers },
  );
  const statusesA = (await statusesARes.json()) as Array<{ id: string }>;
  const statusA = statusesA[0].id;

  // An existing issue in A to mutate.
  const issuesARes = await request.get(
    `${API_URL}/api/issues?projectId=${projectA}`,
    { headers },
  );
  const issuesA = (await issuesARes.json()) as Array<{ id: string }>;
  expect(issuesA[0], 'no seeded issue in project A').toBeTruthy();
  const issueA = issuesA[0].id;

  // Project B = a brand-new project in a fresh workspace. The demo user is a
  // member of both, which is exactly the privilege the old code mis-trusted.
  const newWsRes = await request.post(`${API_URL}/api/workspaces`, {
    headers,
    data: { name: `Tenant Test ${Date.now()}` },
  });
  expect(newWsRes.ok(), `create ws failed: ${newWsRes.status()}`).toBeTruthy();
  const newWs = (await newWsRes.json()) as { id: string };

  const newProjRes = await request.post(`${API_URL}/api/projects`, {
    headers,
    data: {
      workspaceId: newWs.id,
      key: `TT${Math.floor(Math.random() * 9000 + 1000)}`,
      name: 'Tenant Test Project B',
    },
  });
  expect(
    newProjRes.ok(),
    `create project B failed: ${newProjRes.status()}`,
  ).toBeTruthy();
  const projectB = ((await newProjRes.json()) as { id: string }).id;

  const statusesBRes = await request.get(
    `${API_URL}/api/projects/${projectB}/statuses`,
    { headers },
  );
  const statusesB = (await statusesBRes.json()) as Array<{ id: string }>;
  const statusB = statusesB[0].id;

  const sprintBRes = await request.post(
    `${API_URL}/api/projects/${projectB}/sprints`,
    { headers, data: { name: 'Sprint B' } },
  );
  expect(
    sprintBRes.ok(),
    `create sprint B failed: ${sprintBRes.status()}`,
  ).toBeTruthy();
  const sprintB = ((await sprintBRes.json()) as { id: string }).id;

  const issueBRes = await request.post(`${API_URL}/api/issues`, {
    headers,
    data: { projectId: projectB, title: 'Foreign issue in B' },
  });
  expect(
    issueBRes.ok(),
    `create issue B failed: ${issueBRes.status()}`,
  ).toBeTruthy();
  const issueB = ((await issueBRes.json()) as { id: string }).id;

  return {
    headers,
    workspaceId,
    projectA,
    issueA,
    statusA,
    projectB,
    statusB,
    sprintB,
    issueB,
  };
}

test.describe('issue update/move tenant ownership', () => {
  test('rejects updating an issue with a foreign statusId', async ({
    request,
  }) => {
    const c = await setup(request);
    const res = await request.patch(`${API_URL}/api/issues/${c.issueA}`, {
      headers: c.headers,
      data: { statusId: c.statusB },
    });
    expect(res.status(), 'foreign statusId must be rejected').toBe(400);
  });

  test('rejects updating an issue with a foreign sprintId', async ({
    request,
  }) => {
    const c = await setup(request);
    const res = await request.patch(`${API_URL}/api/issues/${c.issueA}`, {
      headers: c.headers,
      data: { sprintId: c.sprintB },
    });
    expect(res.status(), 'foreign sprintId must be rejected').toBe(400);
  });

  test('rejects updating an issue with a foreign parentId', async ({
    request,
  }) => {
    const c = await setup(request);
    const res = await request.patch(`${API_URL}/api/issues/${c.issueA}`, {
      headers: c.headers,
      data: { parentId: c.issueB },
    });
    expect(res.status(), 'foreign parentId must be rejected').toBe(400);
  });

  test('rejects moving an issue onto a foreign statusId', async ({
    request,
  }) => {
    const c = await setup(request);
    const res = await request.post(`${API_URL}/api/issues/${c.issueA}/move`, {
      headers: c.headers,
      data: { statusId: c.statusB },
    });
    expect(res.status(), 'foreign move statusId must be rejected').toBe(400);
  });

  test('rejects moving an issue relative to a foreign beforeId', async ({
    request,
  }) => {
    const c = await setup(request);
    const res = await request.post(`${API_URL}/api/issues/${c.issueA}/move`, {
      headers: c.headers,
      data: { statusId: c.statusA, beforeId: c.issueB },
    });
    expect(res.status(), 'foreign beforeId must be rejected').toBe(400);
  });

  test('still allows a legitimate same-project update', async ({ request }) => {
    const c = await setup(request);
    const res = await request.patch(`${API_URL}/api/issues/${c.issueA}`, {
      headers: c.headers,
      data: { statusId: c.statusA, title: 'Same-project update OK' },
    });
    expect(res.ok(), `same-project update failed: ${res.status()}`).toBeTruthy();
    const body = (await res.json()) as { title: string };
    expect(body.title).toBe('Same-project update OK');
  });

  test('still allows a legitimate same-project move', async ({ request }) => {
    const c = await setup(request);
    const res = await request.post(`${API_URL}/api/issues/${c.issueA}/move`, {
      headers: c.headers,
      data: { statusId: c.statusA },
    });
    expect(res.ok(), `same-project move failed: ${res.status()}`).toBeTruthy();
  });
});

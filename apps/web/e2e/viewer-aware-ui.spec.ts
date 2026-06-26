import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { DEMO, login } from './helpers';

/**
 * ITEM A — VIEWER-aware UI.
 *
 * Roles are enforced server-side (VIEWER gets 403 on mutations) but the UI used
 * to render every edit/create affordance to VIEWERs, who then hit a confusing
 * 403 toast. These tests build a fresh workspace + project owned by the demo
 * ADMIN, add a freshly-registered VIEWER, then drive the real UI as each role:
 *  - VIEWER: no "+ Create issue", no "+ Add column", a "View only" hint, and the
 *    issue drawer shows no Delete and disabled fields.
 *  - ADMIN: still sees create/add affordances (positive control).
 *
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
  return ((await res.json()) as { accessToken: string }).accessToken;
}

interface Fixture {
  viewer: { email: string; password: string };
  workspaceId: string;
  projectId: string;
  firstIssueKey: string;
}

/** Seed a workspace + project + one issue, with the demo user as ADMIN and a
 *  brand-new VIEWER added. Returns the viewer creds and ids needed to navigate. */
async function seed(request: APIRequestContext): Promise<Fixture> {
  const adminToken = await loginToken(request, DEMO);
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };

  const wsRes = await request.post(`${API_URL}/api/workspaces`, {
    headers: adminHeaders,
    data: { name: `Viewer UI ${Date.now()}` },
  });
  expect(wsRes.ok()).toBeTruthy();
  const workspaceId = ((await wsRes.json()) as { id: string }).id;

  const projRes = await request.post(`${API_URL}/api/projects`, {
    headers: adminHeaders,
    data: {
      workspaceId,
      key: `VU${Math.floor(Math.random() * 9000 + 1000)}`,
      name: 'Viewer UI Project',
    },
  });
  expect(projRes.ok()).toBeTruthy();
  const projectId = ((await projRes.json()) as { id: string }).id;

  // One issue so the drawer + board have content to inspect.
  const issueRes = await request.post(`${API_URL}/api/issues`, {
    headers: adminHeaders,
    data: { projectId, title: 'Seed issue for viewer test' },
  });
  expect(issueRes.ok()).toBeTruthy();
  const firstIssueKey = ((await issueRes.json()) as { key: string }).key;

  // Register + add a VIEWER.
  const email = `viewerui-${Date.now()}-${Math.floor(Math.random() * 1e6)}@nextlane.dev`;
  const password = 'nextlane';
  const reg = await request.post(`${API_URL}/api/auth/register`, {
    data: { email, name: 'Viewer UI', password },
  });
  expect(reg.ok()).toBeTruthy();

  const add = await request.post(
    `${API_URL}/api/workspaces/${workspaceId}/members`,
    { headers: adminHeaders, data: { email, role: 'VIEWER' } },
  );
  expect(add.ok(), `add VIEWER failed: ${add.status()}`).toBeTruthy();

  return { viewer: { email, password }, workspaceId, projectId, firstIssueKey };
}

async function gotoBoard(page: Page, projectId: string): Promise<void> {
  await page.goto(`/projects/${projectId}/board`);
  // A column header confirms the board rendered.
  await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });
}

test.describe('VIEWER-aware UI', () => {
  test('VIEWER sees no create/edit affordances on the board', async ({
    page,
    request,
  }) => {
    const f = await seed(request);
    await login(page, f.viewer);
    await gotoBoard(page, f.projectId);

    // Read-only hint present; create/add controls absent.
    await expect(page.getByTestId('readonly-hint').first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: /create issue/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /add column/i }),
    ).toHaveCount(0);

    // Opening an issue: drawer is read-only (no Delete, status select disabled).
    await page.getByText(f.firstIssueKey).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('readonly-hint')).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: /^delete$/i }),
    ).toHaveCount(0);
    await expect(dialog.locator('#d-status')).toBeDisabled();
  });

  test('ADMIN still sees create + add affordances (positive control)', async ({
    page,
    request,
  }) => {
    const f = await seed(request);
    await login(page, DEMO);
    await gotoBoard(page, f.projectId);

    await expect(page.getByTestId('readonly-hint')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /create issue/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /add column/i }).first(),
    ).toBeVisible();
  });

  test('VIEWER sees no create-sprint on the backlog; ADMIN does', async ({
    page,
    request,
  }) => {
    const f = await seed(request);

    await login(page, f.viewer);
    await page.goto(`/projects/${f.projectId}/backlog`);
    await expect(
      page.getByRole('heading', { level: 1, name: /backlog/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('readonly-hint')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /create sprint/i }),
    ).toHaveCount(0);

    // Positive control as ADMIN.
    await login(page, DEMO);
    await page.goto(`/projects/${f.projectId}/backlog`);
    await expect(
      page.getByRole('button', { name: /create sprint/i }),
    ).toBeVisible({ timeout: 15_000 });
  });
});

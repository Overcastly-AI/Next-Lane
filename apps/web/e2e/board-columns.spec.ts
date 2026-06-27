import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { DEMO, login } from './helpers';

/**
 * Project Settings — column (status) management lives on the settings page now
 * (moved off the board). These tests drive the real Settings UI:
 *  - add a column in Settings and confirm it appears on the board,
 *  - rename it,
 *  - block deletion while it holds an issue (toast),
 *  - delete an empty column,
 *  - edit the project name,
 *  - VIEWER sees the page read-only.
 *
 * Each test seeds its own workspace + project so it does not depend on (or
 * pollute) seed data or other specs. The API lives on :4000.
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
  workspaceId: string;
  projectId: string;
  projectName: string;
  viewer: { email: string; password: string };
}

/** Seed a fresh workspace + project owned by the demo ADMIN, plus a VIEWER. */
async function seed(request: APIRequestContext): Promise<Fixture> {
  const adminToken = await loginToken(request, DEMO);
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };

  const wsRes = await request.post(`${API_URL}/api/workspaces`, {
    headers: adminHeaders,
    data: { name: `Settings ${Date.now()}` },
  });
  expect(wsRes.ok()).toBeTruthy();
  const workspaceId = ((await wsRes.json()) as { id: string }).id;

  const projectName = 'Settings Project';
  const projRes = await request.post(`${API_URL}/api/projects`, {
    headers: adminHeaders,
    data: {
      workspaceId,
      key: `ST${Math.floor(Math.random() * 9000 + 1000)}`,
      name: projectName,
    },
  });
  expect(projRes.ok()).toBeTruthy();
  const projectId = ((await projRes.json()) as { id: string }).id;

  // Register + add a VIEWER for the read-only check.
  const email = `settingsviewer-${Date.now()}-${Math.floor(Math.random() * 1e6)}@nextlane.dev`;
  const password = 'nextlane';
  const reg = await request.post(`${API_URL}/api/auth/register`, {
    data: { email, name: 'Settings Viewer', password },
  });
  expect(reg.ok()).toBeTruthy();
  const add = await request.post(
    `${API_URL}/api/workspaces/${workspaceId}/members`,
    { headers: adminHeaders, data: { email, role: 'VIEWER' } },
  );
  expect(add.ok(), `add VIEWER failed: ${add.status()}`).toBeTruthy();

  return { workspaceId, projectId, projectName, viewer: { email, password } };
}

async function gotoSettings(page: Page, projectId: string): Promise<void> {
  await page.goto(`/projects/${projectId}/settings`);
  await expect(
    page.getByRole('heading', { level: 1, name: /settings/i }),
  ).toBeVisible({ timeout: 15_000 });
}

test.describe('Project settings — columns', () => {
  test('add (shows on board), rename, guard delete, delete empty', async ({
    page,
    request,
  }) => {
    const f = await seed(request);
    await login(page, DEMO);
    await gotoSettings(page, f.projectId);

    const stamp = Date.now();
    const colName = `QA Col ${stamp}`;
    const renamed = `QA Renamed ${stamp}`;
    const emptyCol = `QA Empty ${stamp}`;

    // --- Add a column in Settings -------------------------------------------
    await page.getByRole('button', { name: /^\+ Add column$/i }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // pressSequentially guards focus retention while typing.
    await dialog.getByLabel('Name').pressSequentially(colName, { delay: 10 });
    await dialog.getByLabel('Category').selectOption({ label: 'In Progress' });
    await dialog.getByRole('button', { name: /^Add column$/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(colName).first()).toBeVisible({
      timeout: 10_000,
    });

    // --- It appears on the board --------------------------------------------
    await page.goto(`/projects/${f.projectId}/board`);
    await expect(page.getByText(colName).first()).toBeVisible({
      timeout: 15_000,
    });

    // --- Rename it from Settings --------------------------------------------
    await gotoSettings(page, f.projectId);
    await page.getByRole('button', { name: `Edit ${colName}` }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const nameField = dialog.getByLabel('Name');
    await nameField.fill('');
    await nameField.pressSequentially(renamed, { delay: 10 });
    await dialog.getByRole('button', { name: /^Save$/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(renamed).first()).toBeVisible({
      timeout: 10_000,
    });

    // --- Put an issue in the renamed column (via the board) -----------------
    await page.goto(`/projects/${f.projectId}/board`);
    const issueTitle = `QA col issue ${stamp}`;
    // A column exposes two add-issue affordances (header icon + empty-state
    // dashed button) sharing the same accessible name; the header one is first.
    await page
      .getByRole('button', { name: new RegExp(`Add issue to ${renamed}`, 'i') })
      .first()
      .click();
    const issueDialog = page.getByRole('dialog');
    await expect(issueDialog).toBeVisible();
    await issueDialog.getByLabel('Title').pressSequentially(issueTitle, {
      delay: 10,
    });
    await issueDialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText(issueTitle).first()).toBeVisible({
      timeout: 10_000,
    });

    // --- Deleting the non-empty column is blocked with a toast --------------
    await gotoSettings(page, f.projectId);
    await page.getByRole('button', { name: `Delete ${renamed}` }).click();
    let confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /Delete column/i }).click();
    await expect(page.getByText(/move or delete its issues first/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(confirm).toBeHidden();
    await expect(page.getByText(renamed).first()).toBeVisible();
    // Dismiss the error toast so it doesn't intercept the next click.
    const errorToast = page.locator('[data-toast][data-variant="error"]');
    await errorToast
      .getByRole('button', { name: /dismiss notification/i })
      .click();
    await expect(errorToast).toBeHidden();

    // --- Add an empty column and delete it successfully ---------------------
    await page.getByRole('button', { name: /^\+ Add column$/i }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Name').pressSequentially(emptyCol, { delay: 10 });
    await dialog.getByRole('button', { name: /^Add column$/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(emptyCol).first()).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: `Delete ${emptyCol}` }).click();
    confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /Delete column/i }).click();
    await expect(page.getByText(/deleted/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(emptyCol)).toHaveCount(0);
  });

  test('edit project name from Settings', async ({ page, request }) => {
    const f = await seed(request);
    await login(page, DEMO);
    await gotoSettings(page, f.projectId);

    const newName = `Renamed Project ${Date.now()}`;
    const nameField = page.getByLabel('Name', { exact: true }).first();
    await nameField.fill('');
    await nameField.pressSequentially(newName, { delay: 10 });
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText(/project details saved/i)).toBeVisible({
      timeout: 10_000,
    });

    // The key field stays read-only.
    await expect(page.getByLabel('Key', { exact: true })).toBeDisabled();
  });

  test('VIEWER sees Settings read-only', async ({ page, request }) => {
    const f = await seed(request);
    await login(page, f.viewer);
    await gotoSettings(page, f.projectId);

    await expect(page.getByTestId('readonly-hint')).toBeVisible();
    // No add/save/archive affordances for a VIEWER.
    await expect(
      page.getByRole('button', { name: /add column/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /save changes/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /archive project/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /add label/i }),
    ).toHaveCount(0);
    // The name field is disabled (read-only).
    await expect(page.getByLabel('Name', { exact: true }).first()).toBeDisabled();
  });
});

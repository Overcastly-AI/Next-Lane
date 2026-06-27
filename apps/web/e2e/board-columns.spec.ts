import { test, expect, type Page } from '@playwright/test';
import {
  login,
  setupIsolatedProject,
  registerNewUser,
  addWorkspaceMember,
} from './helpers';

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
 * Each test seeds its own workspace + project via setupIsolatedProject so it
 * does not depend on (or pollute) the shared demo account or other specs.
 */

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
    const ctx = await setupIsolatedProject(page, request, {
      label: 'col-crud',
      projectName: 'Settings Project',
      openBoard: false,
    });
    await gotoSettings(page, ctx.project.id);

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
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(colName).first()).toBeVisible({
      timeout: 15_000,
    });

    // --- Rename it from Settings --------------------------------------------
    await gotoSettings(page, ctx.project.id);
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
    await page.goto(`/projects/${ctx.project.id}/board`);
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
    await gotoSettings(page, ctx.project.id);
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
    const ctx = await setupIsolatedProject(page, request, {
      label: 'col-rename',
      projectName: 'Settings Project',
      openBoard: false,
    });
    await gotoSettings(page, ctx.project.id);

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
    // Register the ADMIN (workspace owner) via isolation, then add a fresh VIEWER.
    const ctx = await setupIsolatedProject(page, request, {
      label: 'col-viewer-admin',
      openBoard: false,
    });

    const viewer = await registerNewUser(request, 'col-viewer');
    await addWorkspaceMember(
      request,
      ctx.token,
      ctx.workspaceId,
      viewer.email,
      'VIEWER',
    );

    // Log in as the VIEWER.
    await login(page, { email: viewer.email, password: viewer.password });
    await gotoSettings(page, ctx.project.id);

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

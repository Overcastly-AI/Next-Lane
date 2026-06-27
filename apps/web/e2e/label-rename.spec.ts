/**
 * e2e tests for label rename / edit.
 *
 * Coverage:
 * - Rename via Project Settings → Labels section → Edit button
 * - Recolor via same flow
 * - Renamed label propagates to board card chips + the drawer label picker
 * - VIEWER sees no edit affordance in Settings
 * - Mobile viewport for rename flow
 */
import { test, expect, type Page } from '@playwright/test';
import {
  setupIsolatedProject,
  addWorkspaceMember,
  registerNewUser,
  createIssue,
  openProjectBoard,
  API_URL,
} from './helpers';

const MOBILE = { width: 390, height: 844 };

async function goToSettings(page: Page, projectId: string): Promise<void> {
  await page.goto(`/projects/${projectId}/settings`);
  await expect(
    page.getByRole('heading', { name: /settings/i }).first(),
  ).toBeVisible({ timeout: 15_000 });
}

async function findLabelRow(page: Page, labelName: string) {
  return page
    .getByTestId('settings-label-row')
    .filter({ hasText: labelName })
    .first();
}

test.describe('Label rename / edit — desktop', () => {
  test('rename a label via Settings and confirm it updates on the board card', async ({
    page,
    request,
  }) => {
    const { token, project, workspaceId } = await setupIsolatedProject(
      page,
      request,
      { label: 'rename', labels: ['original-name'] },
    );

    // Create an issue and assign the label to it via the API.
    const issue = await createIssue(request, token, project.id, {
      title: `QA rename label ${Date.now()}`,
    });

    // Attach the label to the issue directly via API.
    const labelsRes = await request.get(
      `${API_URL}/api/projects/${project.id}/labels`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const labels = (await labelsRes.json()) as Array<{
      id: string;
      name: string;
    }>;
    const label = labels.find((l) => l.name === 'original-name');
    expect(label).toBeDefined();
    await request.post(`${API_URL}/api/issues/${issue.id}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { labelId: label!.id },
    });

    // Navigate to Settings and rename the label.
    await goToSettings(page, project.id);

    const row = await findLabelRow(page, 'original-name');
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /edit label/i }).click();

    const editForm = page.getByTestId('edit-label-form');
    await expect(editForm).toBeVisible();

    const nameInput = editForm.getByLabel('Label name');
    await nameInput.selectText();
    await nameInput.pressSequentially('renamed-label', { delay: 30 });

    await editForm.getByRole('button', { name: /save/i }).click();

    // The edit form should close and the renamed label should appear.
    await expect(editForm).not.toBeVisible({ timeout: 10_000 });
    await expect(await findLabelRow(page, 'renamed-label')).toBeVisible({
      timeout: 10_000,
    });
    // Old name should be gone.
    await expect(page.getByText('original-name')).toHaveCount(0, {
      timeout: 5_000,
    });

    // Navigate to the board and confirm the chip shows the renamed label.
    await openProjectBoard(page, project.id);
    const card = page.getByText(issue.title ?? 'QA rename label').first();
    await expect(card).toBeVisible({ timeout: 10_000 });

    // The card should contain the renamed label chip.
    const cardContainer = page
      .locator('div', { hasText: issue.title ?? 'QA rename label' })
      .filter({ has: page.getByText('renamed-label') });
    await expect(cardContainer.first()).toBeVisible({ timeout: 10_000 });
  });

  test('change a label color via Settings', async ({ page, request }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'recolor',
      labels: ['color-test'],
    });

    await goToSettings(page, project.id);

    const row = await findLabelRow(page, 'color-test');
    await row.getByRole('button', { name: /edit label/i }).click();

    const editForm = page.getByTestId('edit-label-form');
    await expect(editForm).toBeVisible();

    // Pick a different swatch (red = #ef4444).
    await editForm.getByRole('button', { name: '#ef4444' }).click();
    await editForm.getByRole('button', { name: /save/i }).click();

    await expect(editForm).not.toBeVisible({ timeout: 10_000 });
    // The label row should still be visible (not deleted).
    await expect(await findLabelRow(page, 'color-test')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('cancel edit discards changes', async ({ page, request }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'cancel-edit',
      labels: ['keep-me'],
    });

    await goToSettings(page, project.id);

    const row = await findLabelRow(page, 'keep-me');
    await row.getByRole('button', { name: /edit label/i }).click();

    const editForm = page.getByTestId('edit-label-form');
    await expect(editForm).toBeVisible();

    const nameInput = editForm.getByLabel('Label name');
    await nameInput.selectText();
    await nameInput.pressSequentially('discarded', { delay: 20 });

    await editForm.getByRole('button', { name: /cancel/i }).click();

    // Form gone; original name still present.
    await expect(editForm).not.toBeVisible({ timeout: 5_000 });
    await expect(await findLabelRow(page, 'keep-me')).toBeVisible();
    await expect(page.getByText('discarded')).toHaveCount(0);
  });

  test('VIEWER sees no edit button on label rows', async ({
    page,
    request,
  }) => {
    // Set up isolated project and capture the owner token.
    const ctx = await setupIsolatedProject(page, request, {
      label: 'viewer-check',
      labels: ['view-only'],
    });

    // Register a VIEWER and add them to the owner's workspace using the owner token.
    const viewer = await registerNewUser(request, 'viewer-lbl');
    await addWorkspaceMember(
      request,
      ctx.token,
      ctx.workspaceId,
      viewer.email,
      'VIEWER',
    );

    // Log in as the viewer.
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(viewer.email);
    await page.getByLabel(/password/i).fill(viewer.password);
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    await goToSettings(page, ctx.project.id);

    // VIEWER sees the "View only" hint.
    await expect(page.getByTestId('readonly-hint')).toBeVisible();

    // The label row exists (viewable) but has no Edit or Delete buttons.
    const row = await findLabelRow(page, 'view-only');
    await expect(row).toBeVisible();
    await expect(
      row.getByRole('button', { name: /edit label/i }),
    ).toHaveCount(0);
    await expect(
      row.getByRole('button', { name: /delete label/i }),
    ).toHaveCount(0);
  });

  test('renamed label updates in the drawer label picker', async ({
    page,
    request,
  }) => {
    const issueTitle = `QA picker rename ${Date.now()}`;
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'picker-rename',
      labels: ['picker-label'],
    });

    // Create an issue with a known title.
    await createIssue(request, token, project.id, { title: issueTitle });

    // Rename the label via Settings.
    await goToSettings(page, project.id);
    const row = await findLabelRow(page, 'picker-label');
    await row.getByRole('button', { name: /edit label/i }).click();
    const editForm = page.getByTestId('edit-label-form');
    const nameInput = editForm.getByLabel('Label name');
    await nameInput.selectText();
    await nameInput.pressSequentially('picker-renamed', { delay: 30 });
    await editForm.getByRole('button', { name: /save/i }).click();
    await expect(editForm).not.toBeVisible({ timeout: 10_000 });

    // Navigate to the board and open the issue drawer.
    await openProjectBoard(page, project.id);
    const card = page.getByText(issueTitle).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    // Wait for drawer URL param to appear first, then find the dialog.
    await expect(page).toHaveURL(/issue=/, { timeout: 15_000 });
    const drawer = page.getByRole('dialog').last();
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    await drawer.getByRole('button', { name: 'Edit' }).first().click();

    const picker = page.getByRole('dialog', { name: 'Edit labels' });
    await expect(picker).toBeVisible({ timeout: 10_000 });

    // The renamed label should appear in the picker, not the old name.
    await expect(
      picker.getByRole('menuitemcheckbox', { name: /picker-renamed/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(picker.getByText('picker-label')).toHaveCount(0);
  });
});

test.describe('Label rename / edit — mobile', () => {
  test.use({ viewport: MOBILE });

  test('rename a label on mobile', async ({ page, request }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'mobile-rename',
      labels: ['mobile-label'],
    });

    await goToSettings(page, project.id);

    const row = await findLabelRow(page, 'mobile-label');
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /edit label/i }).click();

    const editForm = page.getByTestId('edit-label-form');
    await expect(editForm).toBeVisible();

    const nameInput = editForm.getByLabel('Label name');
    await nameInput.selectText();
    await nameInput.pressSequentially('mobile-renamed', { delay: 30 });

    await editForm.getByRole('button', { name: /save/i }).click();

    await expect(editForm).not.toBeVisible({ timeout: 10_000 });
    await expect(await findLabelRow(page, 'mobile-renamed')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('mobile-label')).toHaveCount(0, {
      timeout: 5_000,
    });
  });
});

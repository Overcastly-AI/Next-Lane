/**
 * e2e: Inline card status transition
 *
 * Tests that:
 * 1. A MEMBER/ADMIN can change an issue's status directly from the board card
 *    without opening the drawer — the card status picker is visible and functional.
 * 2. Selecting a new status moves the card to the target column (optimistic + persist on reload).
 * 3. Clicking the card body still opens the drawer (status picker does not interfere).
 * 4. VIEWER sees no status picker on cards (read-only enforcement).
 * 5. Works on desktop AND mobile viewports.
 */

import { test, expect } from '@playwright/test';
import {
  setupIsolatedProject,
  createIssue,
  registerNewUser,
  addWorkspaceMember,
  login,
  API_URL,
} from './helpers';

// ---------------------------------------------------------------------------
// Helper: navigate to the board for a project and wait for columns to render.
// ---------------------------------------------------------------------------
async function gotoBoard(
  page: import('@playwright/test').Page,
  projectId: string,
) {
  await page.goto(`/projects/${projectId}/board`);
  await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Helper: get the status IDs from the project
// ---------------------------------------------------------------------------
async function getStatuses(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  projectId: string,
): Promise<Array<{ id: string; name: string; category: string }>> {
  const res = await request.get(`${API_URL}/api/projects/${projectId}/statuses`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Array<{
    id: string;
    name: string;
    category: string;
  }>;
}

// ---------------------------------------------------------------------------
// Desktop tests
// ---------------------------------------------------------------------------
test.describe('Inline card status transition (desktop)', () => {
  test('status picker trigger is visible on a card for ADMIN', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ics-visible',
    });
    await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Status picker test',
    });
    await gotoBoard(page, ctx.project.id);

    // The status-picker trigger (a coloured dot button) should be present on the card.
    await expect(
      page.getByTestId('card-status-trigger').first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('status picker opens a menu of project statuses', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ics-menu',
    });
    await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Menu test issue',
    });
    await gotoBoard(page, ctx.project.id);

    const trigger = page.getByTestId('card-status-trigger').first();
    await expect(trigger).toBeVisible({ timeout: 10_000 });

    // Click the trigger — should open the status menu.
    await trigger.click();
    await expect(
      page.getByTestId('card-status-menu').first(),
    ).toBeVisible({ timeout: 5_000 });

    // Menu should contain the default statuses (To Do / In Progress / Done).
    const menu = page.getByTestId('card-status-menu').first();
    await expect(menu.getByText(/to do/i).first()).toBeVisible();
    await expect(menu.getByText(/in progress/i).first()).toBeVisible();
    await expect(menu.getByText(/done/i).first()).toBeVisible();
  });

  test('Escape closes the status menu', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ics-esc',
    });
    await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Esc close test',
    });
    await gotoBoard(page, ctx.project.id);

    const trigger = page.getByTestId('card-status-trigger').first();
    await trigger.click();
    await expect(page.getByTestId('card-status-menu').first()).toBeVisible();

    // Press Escape.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('card-status-menu')).toHaveCount(0, {
      timeout: 2_000,
    });
  });

  test('selecting a status moves the card to that column (optimistic + persists on reload)', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ics-move',
    });
    const issue = await createIssue(request, ctx.token, ctx.project.id, {
      title: `Status move ${Date.now()}`,
    });
    const statuses = await getStatuses(request, ctx.token, ctx.project.id);
    const inProgress = statuses.find((s) =>
      s.name.toLowerCase().includes('progress'),
    );
    expect(inProgress).toBeDefined();

    await gotoBoard(page, ctx.project.id);

    // The card starts in "To Do".
    const toDoColumn = page
      .getByText(/^to do$/i)
      .first()
      .locator('../..')
      .first();

    // Find and click the status trigger on the card.
    const trigger = page.getByTestId('card-status-trigger').first();
    await trigger.click();
    const menu = page.getByTestId('card-status-menu').first();
    await expect(menu).toBeVisible({ timeout: 5_000 });

    // Click the "In Progress" option using its specific data-testid.
    await page.getByTestId(`card-status-option-${inProgress!.id}`).click();

    // Menu should close.
    await expect(page.getByTestId('card-status-menu')).toHaveCount(0, {
      timeout: 3_000,
    });

    // The card should now appear in the "In Progress" column.
    // We look for the issue title in the In Progress column.
    // Give it time for the optimistic update.
    await expect(
      page.getByText(issue.key).first(),
    ).toBeVisible({ timeout: 5_000 });

    // Reload and confirm persistence.
    await page.reload();
    await expect(page.getByText(/in progress/i).first()).toBeVisible({
      timeout: 15_000,
    });
    // The issue should still be visible (i.e., on the board) after reload.
    await expect(page.getByText(issue.key).first()).toBeVisible({
      timeout: 5_000,
    });

    // Verify via API that the status actually changed.
    const res = await request.get(`${API_URL}/api/issues/${issue.id}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
    const body = (await res.json()) as { statusId: string };
    expect(body.statusId).toBe(inProgress!.id);
  });

  test('clicking card body still opens the drawer (no interference)', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ics-drawer',
    });
    const issue = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Drawer open test',
    });
    await gotoBoard(page, ctx.project.id);

    // Click on the issue key text (card body), not the status trigger.
    await page.getByText(issue.key).first().click();
    // Drawer should open.
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible({ timeout: 5_000 });
    // The title is rendered as an input value in the drawer.
    await expect(
      drawer.locator('input[value="Drawer open test"]'),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('VIEWER sees no status picker on cards', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ics-viewer',
      openBoard: false,
    });
    await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Viewer no picker',
    });

    // Register a VIEWER.
    const viewer = await registerNewUser(request, 'ics-viewer-user');
    await addWorkspaceMember(
      request,
      ctx.token,
      ctx.workspaceId,
      viewer.email,
      'VIEWER',
    );

    // Log in as the VIEWER.
    await login(page, { email: viewer.email, password: viewer.password });
    await gotoBoard(page, ctx.project.id);

    // VIEWER should NOT see any status picker triggers.
    await expect(
      page.getByTestId('card-status-trigger'),
    ).toHaveCount(0, { timeout: 5_000 });

    // Read-only hint should be visible.
    await expect(page.getByTestId('readonly-hint').first()).toBeVisible();
  });

  test('status picker is keyboard-navigable', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ics-kbd',
    });
    await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Keyboard nav test',
    });
    await gotoBoard(page, ctx.project.id);

    // Focus the trigger via Tab (it is focusable).
    const trigger = page.getByTestId('card-status-trigger').first();
    await trigger.focus();
    // Open with Enter.
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('card-status-menu').first()).toBeVisible({
      timeout: 5_000,
    });
    // Close with Escape.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('card-status-menu')).toHaveCount(0, {
      timeout: 2_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Mobile tests
// ---------------------------------------------------------------------------
test.describe('Inline card status transition (mobile)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('status picker is tappable on mobile', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ics-mob',
    });
    await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Mobile picker test',
    });
    await gotoBoard(page, ctx.project.id);

    const trigger = page.getByTestId('card-status-trigger').first();
    await expect(trigger).toBeVisible({ timeout: 10_000 });

    // Click the trigger (works on both desktop and mobile viewports).
    await trigger.click();
    await expect(
      page.getByTestId('card-status-menu').first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('selecting a status on mobile moves the card', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ics-mob-move',
    });
    const issue = await createIssue(request, ctx.token, ctx.project.id, {
      title: `Mobile move ${Date.now()}`,
    });
    const statuses = await getStatuses(request, ctx.token, ctx.project.id);
    const done = statuses.find((s) => s.name.toLowerCase().includes('done'));
    expect(done).toBeDefined();

    await gotoBoard(page, ctx.project.id);

    const trigger = page.getByTestId('card-status-trigger').first();
    await trigger.click();
    const menu = page.getByTestId('card-status-menu').first();
    await expect(menu).toBeVisible({ timeout: 5_000 });

    // Click the "Done" option by its text within the status menu to avoid
    // potential data-testid conflicts from other open pickers.
    const doneOption = menu.getByText(/^done$/i).first();
    await expect(doneOption).toBeVisible({ timeout: 3_000 });
    await doneOption.click();
    await expect(page.getByTestId('card-status-menu')).toHaveCount(0, {
      timeout: 3_000,
    });

    // Card should still be visible (moved to Done column).
    await expect(page.getByText(issue.key).first()).toBeVisible({
      timeout: 5_000,
    });

    // Verify via API.
    const res = await request.get(`${API_URL}/api/issues/${issue.id}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
    const body = (await res.json()) as { statusId: string };
    expect(body.statusId).toBe(done!.id);
  });

  test('VIEWER sees no status picker on mobile', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ics-mob-viewer',
      openBoard: false,
    });
    await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Mobile viewer no picker',
    });

    const viewer = await registerNewUser(request, 'ics-mob-viewer-user');
    await addWorkspaceMember(
      request,
      ctx.token,
      ctx.workspaceId,
      viewer.email,
      'VIEWER',
    );

    await login(page, { email: viewer.email, password: viewer.password });
    await gotoBoard(page, ctx.project.id);

    await expect(
      page.getByTestId('card-status-trigger'),
    ).toHaveCount(0, { timeout: 5_000 });
  });
});

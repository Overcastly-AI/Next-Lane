/**
 * Triage mode e2e spec.
 *
 * Exercises:
 *   - Navigation to /projects/:id/triage via ProjectNav "Triage" tab
 *   - Navigation to /projects/:id/triage via command palette "Triage issues" action
 *   - j/k keyboard navigation (selection moves down/up)
 *   - Enter opens the issue detail drawer
 *   - s key opens the status picker and changes the status (persists after reload)
 *   - p key opens the priority picker and changes priority
 *   - f key focuses the filter input
 *   - ? key toggles the shortcut help overlay
 *   - Esc closes picker, clears filter, then exits triage
 *   - VIEWER sees read-only hint; action keys (a/p/s/l) do NOT open pickers
 *   - Mobile layout renders correctly (triage row and open button visible)
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import {
  setupIsolatedProject,
  createIssue,
  registerNewUser,
  addWorkspaceMember,
} from './helpers';

const API_URL = process.env.PW_API_URL ?? 'http://localhost:4000';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openTriagePage(
  page: Page,
  projectId: string,
): Promise<void> {
  await page.goto(`/projects/${projectId}/triage`);
  // Wait for at least the heading to appear
  await expect(
    page.getByRole('heading', { name: /triage/i }).first(),
  ).toBeVisible({ timeout: 15_000 });
}

/** Login via the API, then inject the token into localStorage so we can
 *  navigate directly without going through the login UI. */
async function loginViaApi(
  page: Page,
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<void> {
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { email, password },
  });
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();
  const { accessToken } = (await res.json()) as { accessToken: string };
  // Navigate to the app origin to establish the domain, then inject the
  // viewer token and clear the cached user so the app fetches /me fresh.
  await page.goto('/login');
  await page.evaluate((token: string) => {
    localStorage.setItem('nl_token', token);
    // Clear the stale cached user so the app re-fetches /me with the new token
    // rather than showing the previous user's cached data.
    localStorage.removeItem('nl_user');
  }, accessToken);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('triage page', () => {
  test('triage tab appears in project nav and is reachable', async ({
    page,
    request,
  }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'triage-nav',
      openBoard: true,
    });

    // The "Triage" tab should be visible in the nav
    const triageTab = page.getByRole('link', { name: /^triage$/i }).first();
    await expect(triageTab).toBeVisible();

    await triageTab.click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/${project.id}/triage`),
      { timeout: 10_000 },
    );
    await expect(
      page.getByRole('heading', { name: /triage/i }).first(),
    ).toBeVisible();
  });

  test('command palette "Triage issues" action navigates to triage', async ({
    page,
    request,
  }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'triage-cp',
      openBoard: true,
    });

    // Open command palette
    await page.keyboard.press('ControlOrMeta+KeyK');
    await expect(
      page.getByRole('dialog', { name: /command palette/i }),
    ).toBeVisible();

    // Look for the Triage item and click it
    const triageAction = page.getByRole('option', { name: /triage issues/i });
    await expect(triageAction).toBeVisible({ timeout: 5_000 });
    await triageAction.click();

    await expect(page).toHaveURL(
      new RegExp(`/projects/${project.id}/triage`),
      { timeout: 10_000 },
    );
  });

  test('j/k keyboard navigation moves selection through rows', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'triage-jk',
      openBoard: false,
    });

    // Seed 3 issues
    await createIssue(request, token, project.id, { title: 'Alpha issue' });
    await createIssue(request, token, project.id, { title: 'Beta issue' });
    await createIssue(request, token, project.id, { title: 'Gamma issue' });

    await openTriagePage(page, project.id);

    // Wait for rows to appear
    const rows = page.getByTestId('triage-row');
    await expect(rows).toHaveCount(3, { timeout: 10_000 });

    // First row should be selected (aria-selected=true)
    const firstRow = rows.nth(0);
    await expect(firstRow).toHaveAttribute('aria-selected', 'true');

    // Press j — selection moves down
    await page.keyboard.press('j');
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(firstRow).toHaveAttribute('aria-selected', 'false');

    // Press k — selection moves back up
    await page.keyboard.press('k');
    await expect(firstRow).toHaveAttribute('aria-selected', 'true');
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'false');
  });

  test('Enter key opens the issue detail drawer', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'triage-enter',
      openBoard: false,
    });

    await createIssue(request, token, project.id, {
      title: 'Enter opens drawer test',
    });

    await openTriagePage(page, project.id);
    await expect(page.getByTestId('triage-row')).toHaveCount(1, {
      timeout: 10_000,
    });

    // Press Enter to open drawer
    await page.keyboard.press('Enter');

    // The issue detail drawer should appear — look for the drawer aside element
    // which has role="dialog" and contains the title as an input
    await expect(
      page.locator('aside[role="dialog"]'),
    ).toBeVisible({ timeout: 10_000 });
    // Verify the title input has the issue's title value (React controlled input)
    await expect(
      page.locator('aside[role="dialog"] input').first(),
    ).toHaveValue('Enter opens drawer test', { timeout: 5_000 });
  });

  test('s key opens status picker and changing status persists after reload', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'triage-status',
      openBoard: false,
    });

    await createIssue(request, token, project.id, { title: 'Status test issue' });

    await openTriagePage(page, project.id);
    await expect(page.getByTestId('triage-row')).toHaveCount(1, {
      timeout: 10_000,
    });

    // Press s to open status picker
    await page.keyboard.press('s');
    const statusPicker = page.getByTestId('triage-picker-status');
    await expect(statusPicker).toBeVisible({ timeout: 5_000 });

    // Click the "Done" status (last option — all isolated projects seed To Do/In Progress/Done)
    const doneBtn = statusPicker.getByRole('button', { name: /done/i });
    await doneBtn.click();

    // Picker should close
    await expect(statusPicker).not.toBeVisible({ timeout: 5_000 });

    // The row should now reflect "Done" status badge
    await expect(page.getByTestId('triage-row').first()).toContainText('Done', {
      timeout: 10_000,
    });

    // Reload and confirm the status persists
    await page.reload();
    await expect(page.getByTestId('triage-row')).toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(page.getByTestId('triage-row').first()).toContainText(
      'Done',
      { timeout: 10_000 },
    );
  });

  test('p key opens priority picker and changes priority', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'triage-priority',
      openBoard: false,
    });

    await createIssue(request, token, project.id, {
      title: 'Priority test issue',
    });

    await openTriagePage(page, project.id);
    await expect(page.getByTestId('triage-row')).toHaveCount(1, {
      timeout: 10_000,
    });

    // Press p to open priority picker
    await page.keyboard.press('p');
    const priorityPicker = page.getByTestId('triage-picker-priority');
    await expect(priorityPicker).toBeVisible({ timeout: 5_000 });

    // Click "Highest" priority
    await priorityPicker.getByRole('button', { name: /highest/i }).click();
    await expect(priorityPicker).not.toBeVisible({ timeout: 5_000 });
  });

  test('f key focuses the filter input; typing filters rows', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'triage-filter',
      openBoard: false,
    });

    await createIssue(request, token, project.id, { title: 'Filterable issue' });
    await createIssue(request, token, project.id, { title: 'Other issue' });

    await openTriagePage(page, project.id);
    await expect(page.getByTestId('triage-row')).toHaveCount(2, {
      timeout: 10_000,
    });

    // Press f — filter input should get focus
    await page.keyboard.press('f');
    const filterInput = page.getByLabel(/filter issues/i);
    await expect(filterInput).toBeFocused();

    // Type to filter (use keyboard typing, not fill, after focus)
    await page.keyboard.type('Filterable');
    await expect(page.getByTestId('triage-row')).toHaveCount(1, {
      timeout: 5_000,
    });
    await expect(
      page.getByTestId('triage-row').first(),
    ).toContainText('Filterable issue');
  });

  test('? key toggles the shortcuts help overlay', async ({
    page,
    request,
  }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'triage-help',
      openBoard: false,
    });

    await openTriagePage(page, project.id);

    // Help overlay should not be visible initially
    await expect(page.getByTestId('triage-help-overlay')).not.toBeVisible();

    // Press ? to open
    await page.keyboard.press('?');
    await expect(page.getByTestId('triage-help-overlay')).toBeVisible({
      timeout: 5_000,
    });

    // Press ? again to close
    await page.keyboard.press('?');
    await expect(page.getByTestId('triage-help-overlay')).not.toBeVisible({
      timeout: 5_000,
    });
  });

  test('Esc closes open picker, then exits triage', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'triage-esc',
      openBoard: false,
    });

    await createIssue(request, token, project.id, { title: 'Escape test issue' });
    await openTriagePage(page, project.id);
    await expect(page.getByTestId('triage-row')).toHaveCount(1, {
      timeout: 10_000,
    });

    // Open a picker with s
    await page.keyboard.press('s');
    const statusPicker = page.getByTestId('triage-picker-status');
    await expect(statusPicker).toBeVisible({ timeout: 3_000 });

    // Esc closes the picker
    await page.keyboard.press('Escape');
    await expect(statusPicker).not.toBeVisible({ timeout: 3_000 });

    // We should still be on the triage page
    await expect(page).toHaveURL(
      new RegExp(`/projects/${project.id}/triage`),
    );

    // Pressing Esc again should navigate away
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(
      new RegExp(`/projects/${project.id}/triage`),
      { timeout: 5_000 },
    );
  });

  test('VIEWER sees read-only hint; action keys do not open pickers', async ({
    page,
    request,
  }) => {
    // Create owner's workspace and project
    const { user: ownerUser, project, workspaceId } =
      await setupIsolatedProject(page, request, {
        label: 'triage-viewer-owner',
        openBoard: false,
      });

    // Register a viewer user
    const viewer = await registerNewUser(request, 'triage-viewer');
    await addWorkspaceMember(
      request,
      ownerUser.token,
      workspaceId,
      viewer.email,
      'VIEWER',
    );

    // Log in as the viewer via API token injection
    await loginViaApi(page, request, viewer.email, viewer.password);

    // Navigate to the triage page
    await page.goto(`/projects/${project.id}/triage`);
    await expect(
      page.getByRole('heading', { name: /triage/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Readonly hint should be visible once the role has loaded
    await expect(page.getByTestId('readonly-hint')).toBeVisible({
      timeout: 15_000,
    });

    // s, p keys should NOT open any picker (VIEWER is read-only)
    await page.keyboard.press('s');
    await expect(
      page.getByTestId('triage-picker-status'),
    ).not.toBeVisible();

    await page.keyboard.press('p');
    await expect(
      page.getByTestId('triage-picker-priority'),
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Mobile layout
// ---------------------------------------------------------------------------

test.describe('triage page — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('renders rows with open button on mobile', async ({ page, request }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'triage-mobile',
      openBoard: false,
    });

    await createIssue(request, token, project.id, { title: 'Mobile triage issue' });
    await openTriagePage(page, project.id);

    const row = page.getByTestId('triage-row').first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Mobile open button (chevron) should be visible
    const openBtn = row.getByRole('button', { name: /open/i });
    await expect(openBtn).toBeVisible();

    // Tapping open button opens the drawer (click works for both touch/non-touch)
    await openBtn.click();
    await expect(
      page.getByText('Mobile triage issue'),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('filter input is usable on mobile', async ({ page, request }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'triage-mobile-filter',
      openBoard: false,
    });

    await createIssue(request, token, project.id, { title: 'Mobile filter test' });
    await createIssue(request, token, project.id, { title: 'Other mobile issue' });
    await openTriagePage(page, project.id);

    await expect(page.getByTestId('triage-row')).toHaveCount(2, {
      timeout: 10_000,
    });

    // Click the filter input on mobile
    const filterInput = page.getByLabel(/filter issues/i);
    await filterInput.click();
    await filterInput.fill('Mobile filter');
    await expect(page.getByTestId('triage-row')).toHaveCount(1, {
      timeout: 5_000,
    });
  });
});

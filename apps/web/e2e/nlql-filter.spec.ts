/**
 * e2e: NLQL query bar + saved filters on the board.
 *
 * Tests that:
 * - Typing a valid NLQL query narrows the board to matching cards.
 * - Typing an invalid query shows an error and leaves the list unchanged.
 * - A saved filter can be created, then reloaded after page refresh to
 *   repopulate the query and filter the board.
 * - Works on desktop (1280x800) and mobile (375x812).
 *
 * Uses isolated projects so the shared demo is never polluted.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupIsolatedProject, API_URL } from './helpers';

interface IsolatedCtx {
  token: string;
  projectId: string;
}

/**
 * Seed an isolated project with issues of known priorities so the NLQL filter
 * has something deterministic to narrow.
 */
async function seedPriorityIssues(
  request: APIRequestContext,
  ctx: IsolatedCtx,
): Promise<{ highTitle: string; lowTitle: string }> {
  const stamp = Date.now();
  const highTitle = `QA HIGH ${stamp}`;
  const lowTitle = `QA LOW ${stamp}`;

  async function post(data: Record<string, unknown>) {
    const res = await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { projectId: ctx.projectId, ...data },
    });
    expect(res.ok(), `seed issue failed: ${res.status()}`).toBeTruthy();
  }

  await post({ title: highTitle, type: 'TASK', priority: 'HIGH' });
  await post({ title: lowTitle, type: 'TASK', priority: 'LOW' });

  return { highTitle, lowTitle };
}

// ---------------------------------------------------------------------------
// Desktop tests (default 1280x800 from playwright config)
// ---------------------------------------------------------------------------

test.describe('NLQL filter – desktop', () => {
  test('valid query narrows board to matching cards', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'nlql-valid',
    });
    const { highTitle, lowTitle } = await seedPriorityIssues(request, {
      token: ctx.token,
      projectId: ctx.project.id,
    });

    // Both issues visible before filtering.
    await expect(page.getByText(highTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(lowTitle).first()).toBeVisible({
      timeout: 10_000,
    });

    // Type a valid NLQL query.
    const queryInput = page.getByTestId('nlql-query-input');
    await queryInput.click();
    // Type character by character to simulate real user input.
    await queryInput.pressSequentially('priority = HIGH', { delay: 30 });

    // Error should NOT appear.
    await expect(page.getByTestId('nlql-error')).toHaveCount(0);

    // HIGH issue visible; LOW issue hidden.
    await expect(page.getByText(highTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(lowTitle)).toHaveCount(0, { timeout: 10_000 });
  });

  test('invalid query shows error and leaves list unchanged', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'nlql-invalid',
    });
    const { highTitle, lowTitle } = await seedPriorityIssues(request, {
      token: ctx.token,
      projectId: ctx.project.id,
    });

    // Both issues visible.
    await expect(page.getByText(highTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(lowTitle).first()).toBeVisible({
      timeout: 10_000,
    });

    // Type an incomplete/invalid query.
    const queryInput = page.getByTestId('nlql-query-input');
    await queryInput.click();
    await queryInput.pressSequentially('priority = ', { delay: 30 });

    // Error message should appear.
    await expect(page.getByTestId('nlql-error')).toBeVisible({ timeout: 5_000 });

    // Both issues still visible (invalid query = no filter applied).
    await expect(page.getByText(highTitle).first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(lowTitle).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('save a filter, reload, select it from the dropdown — query repopulates and filters', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'nlql-save',
    });
    const { highTitle, lowTitle } = await seedPriorityIssues(request, {
      token: ctx.token,
      projectId: ctx.project.id,
    });

    // Wait for issues to appear.
    await expect(page.getByText(highTitle).first()).toBeVisible({
      timeout: 10_000,
    });

    // Type a valid query.
    const queryInput = page.getByTestId('nlql-query-input');
    await queryInput.click();
    await queryInput.pressSequentially('priority = HIGH', { delay: 30 });

    // Save button should be enabled.
    const saveBtn = page.getByTestId('saved-filter-save');
    await expect(saveBtn).not.toBeDisabled({ timeout: 3_000 });
    await saveBtn.click();

    // Save modal should appear.
    const modal = page.getByRole('dialog', { name: /save filter/i });
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Enter a name and confirm.
    await modal.getByLabel('Filter name').fill('High priority issues');
    await modal.getByRole('button', { name: /^save$/i }).click();

    // Modal closes.
    await expect(modal).toHaveCount(0, { timeout: 5_000 });

    // Clear the query input.
    await page.getByLabel('Clear query').click();
    await expect(queryInput).toHaveValue('');

    // Both issues visible after clearing.
    await expect(page.getByText(highTitle).first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(lowTitle).first()).toBeVisible({
      timeout: 5_000,
    });

    // Reload the page.
    await page.reload();
    await expect(page.getByText(highTitle).first()).toBeVisible({
      timeout: 15_000,
    });

    // Open the saved filter dropdown and select the saved filter.
    const filterSelect = page.getByTestId('saved-filter-select');
    await filterSelect.click();
    await page
      .getByRole('menu', { name: /saved filters menu/i })
      .getByRole('menuitem', { name: /high priority issues/i })
      .click();

    // Query bar should be populated with the saved query.
    await expect(queryInput).toHaveValue('priority = HIGH', { timeout: 5_000 });

    // Board should be filtered: HIGH visible, LOW hidden.
    await expect(page.getByText(highTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(lowTitle)).toHaveCount(0, { timeout: 10_000 });
  });

  test('saved filter dropdown shows existing filters with shared badge', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'nlql-shared',
    });
    await seedPriorityIssues(request, {
      token: ctx.token,
      projectId: ctx.project.id,
    });

    // Create a shared filter via API.
    const stamp = Date.now();
    const filterName = `Shared filter ${stamp}`;
    const createRes = await request.post(
      `${API_URL}/api/projects/${ctx.project.id}/saved-filters`,
      {
        headers: { Authorization: `Bearer ${ctx.token}` },
        data: { name: filterName, query: 'priority = HIGH', shared: true },
      },
    );
    expect(createRes.ok(), `create filter failed: ${createRes.status()}`).toBeTruthy();

    // Reload so the query cache picks up the new filter.
    await page.reload();
    await expect(page.getByText(/to do/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Open the saved filters dropdown.
    await page.getByTestId('saved-filter-select').click();
    const menu = page.getByRole('menu', { name: /saved filters menu/i });
    await expect(menu).toBeVisible({ timeout: 5_000 });

    // The filter should appear with a "shared" badge. Exact match so the badge
    // isn't confused with the filter NAME (which contains the word "Shared").
    await expect(menu.getByText(filterName)).toBeVisible({ timeout: 5_000 });
    await expect(menu.getByText('shared', { exact: true })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('owner can delete their own saved filter', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'nlql-delete',
    });

    // Create a filter via API.
    const stamp = Date.now();
    const filterName = `Delete me ${stamp}`;
    const createRes = await request.post(
      `${API_URL}/api/projects/${ctx.project.id}/saved-filters`,
      {
        headers: { Authorization: `Bearer ${ctx.token}` },
        data: { name: filterName, query: 'priority = HIGH', shared: false },
      },
    );
    expect(createRes.ok()).toBeTruthy();

    // Reload to populate the cache.
    await page.reload();
    await expect(page.getByText(/to do/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Open the dropdown.
    await page.getByTestId('saved-filter-select').click();
    const menu = page.getByRole('menu', { name: /saved filters menu/i });
    await expect(menu.getByText(filterName)).toBeVisible({ timeout: 5_000 });

    // Click the delete button for this filter.
    await menu
      .getByRole('button', { name: new RegExp(`Delete filter ${filterName}`, 'i') })
      .click();

    // ConfirmDialog (alertdialog) should appear.
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible({ timeout: 5_000 });
    await confirmDialog.getByRole('button', { name: /delete/i }).click();

    // After deletion, confirm dialog closes and filter is gone from dropdown.
    await expect(confirmDialog).toHaveCount(0, { timeout: 5_000 });
    await page.getByTestId('saved-filter-select').click();
    const menu2 = page.getByRole('menu', { name: /saved filters menu/i });
    await expect(menu2.getByText(filterName)).toHaveCount(0, { timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Mobile tests (375x812)
// ---------------------------------------------------------------------------

test.describe('NLQL filter – mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('NLQL query input is accessible on mobile', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'nlql-mobile-vis' });
    const queryInput = page.getByTestId('nlql-query-input');
    await expect(queryInput).toBeVisible({ timeout: 10_000 });
  });

  test('valid query filters cards on mobile', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'nlql-mobile-filter',
    });
    const { highTitle, lowTitle } = await seedPriorityIssues(request, {
      token: ctx.token,
      projectId: ctx.project.id,
    });

    await expect(page.getByText(highTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(lowTitle).first()).toBeVisible({
      timeout: 10_000,
    });

    const queryInput = page.getByTestId('nlql-query-input');
    await queryInput.click();
    await queryInput.pressSequentially('priority = HIGH', { delay: 30 });

    await expect(page.getByTestId('nlql-error')).toHaveCount(0);
    await expect(page.getByText(highTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(lowTitle)).toHaveCount(0, { timeout: 10_000 });
  });

  test('invalid query shows error on mobile', async ({ page, request }) => {
    await setupIsolatedProject(page, request, {
      label: 'nlql-mobile-err',
    });

    const queryInput = page.getByTestId('nlql-query-input');
    await queryInput.click();
    await queryInput.pressSequentially('priority = ', { delay: 30 });

    await expect(page.getByTestId('nlql-error')).toBeVisible({
      timeout: 5_000,
    });
  });
});

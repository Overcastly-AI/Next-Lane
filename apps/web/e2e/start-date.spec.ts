import { test, expect } from '@playwright/test';
import { setupIsolatedProject, API_URL } from './helpers';

/**
 * E2E tests for start date on issues (mirrors due-date.spec.ts).
 * Covers: setting a start date in the drawer, reload-persist, and clearing.
 * The board card face intentionally does NOT surface start date (only due
 * date has a card chip today) — these specs stay drawer-scoped.
 */

test.describe('Start date', () => {
  test('set a start date in the drawer — persists after re-opening', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'startdate' });

    // Create an issue.
    const title = `Start date e2e ${Date.now()}`;
    await page.getByRole('button', { name: /\+ Create issue/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByRole('button', { name: 'Create' }).click();

    // Click the card to open the drawer.
    await page.getByText(title).first().click();

    // Set a start date via the date input.
    const startDate = '2026-06-01';
    const startDateInput = page.getByLabel('Start date', { exact: true });
    await expect(startDateInput).toBeVisible();
    await startDateInput.fill(startDate);
    // Trigger the onChange (change event fires on fill for date inputs).
    await startDateInput.dispatchEvent('change');

    // Give the PATCH a moment to land, then close and re-open the drawer to
    // confirm the value round-tripped through the server (not just local state).
    await expect(page.getByRole('button', { name: /clear start date/i })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByText(title).first().click();

    await expect(page.getByLabel('Start date', { exact: true })).toHaveValue(startDate);
  });

  test('clear the start date via the X button in the drawer', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'clear-start' });

    // Create an issue with a start date via the API.
    const issueTitle = `Clear start e2e ${Date.now()}`;
    const issueRes = await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: {
        projectId: ctx.project.id,
        title: issueTitle,
        startDate: '2026-05-01',
      },
    });
    expect(issueRes.ok(), `create issue failed: ${issueRes.status()}`).toBeTruthy();

    await page.reload();
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });

    // Open the drawer.
    await page.getByText(issueTitle).first().click();

    const startDateInput = page.getByLabel('Start date', { exact: true });
    await expect(startDateInput).toHaveValue('2026-05-01');

    // The "Clear start date" button should be visible when a date is set.
    const clearBtn = page.getByRole('button', { name: /clear start date/i });
    await expect(clearBtn).toBeVisible({ timeout: 10_000 });
    await clearBtn.click();

    await expect(startDateInput).toHaveValue('');

    // Close and re-open — confirm the clear persisted server-side.
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByText(issueTitle).first().click();
    await expect(page.getByLabel('Start date', { exact: true })).toHaveValue('');
  });

  test('start date persists after a full page reload', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'persist-start',
    });

    // Create an issue with both a start date and a later due date.
    const issueTitle = `Persist start e2e ${Date.now()}`;
    const issueRes = await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: {
        projectId: ctx.project.id,
        title: issueTitle,
        startDate: '2026-03-01',
        dueDate: '2026-03-25',
      },
    });
    expect(issueRes.ok()).toBeTruthy();

    // Reload the board, then open the drawer to verify both dates survived.
    await page.reload();
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });

    await page.getByText(issueTitle).first().click();
    await expect(page.getByLabel('Start date', { exact: true })).toHaveValue('2026-03-01');
    await expect(page.getByLabel('Due date', { exact: true })).toHaveValue('2026-03-25');
  });

  test('rejects a start date after the existing due date with a clear error', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'invalid-range',
    });

    const issueTitle = `Invalid range e2e ${Date.now()}`;
    const issueRes = await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: {
        projectId: ctx.project.id,
        title: issueTitle,
        dueDate: '2026-01-10',
      },
    });
    expect(issueRes.ok()).toBeTruthy();

    await page.reload();
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });
    await page.getByText(issueTitle).first().click();

    // Attempt to set a start date AFTER the existing due date — should be rejected.
    const startDateInput = page.getByLabel('Start date', { exact: true });
    await startDateInput.fill('2026-02-01');
    await startDateInput.dispatchEvent('change');

    await expect(
      page.getByText(/startDate must be on or before dueDate/i),
    ).toBeVisible({ timeout: 10_000 });
  });
});

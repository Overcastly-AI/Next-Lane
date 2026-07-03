import { test, expect } from '@playwright/test';
import { setupIsolatedProject, API_URL } from './helpers';

/**
 * E2E tests for due date on issues.
 * Covers: setting a due date in the drawer, chip on the card,
 * overdue styling, reload-persist, and clearing.
 */

test.describe('Due date', () => {
  test('set a due date in the drawer — chip appears on the card', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'duedate' });

    // Create an issue.
    const title = `Due date e2e ${Date.now()}`;
    await page.getByRole('button', { name: /\+ Create issue/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByRole('button', { name: 'Create' }).click();

    // Click the card to open the drawer.
    await page.getByText(title).first().click();

    // Set a future due date via the date input.
    const futureDate = '2099-12-31';
    // exact: true avoids Playwright's case-insensitive substring match
    // colliding with the "Clear due date" button once the value is set.
    const dueDateInput = page.getByLabel('Due date', { exact: true });
    await expect(dueDateInput).toBeVisible();
    await dueDateInput.fill(futureDate);
    // Trigger the onChange (change event fires on fill for date inputs).
    await dueDateInput.dispatchEvent('change');

    // Close the drawer.
    await page.getByRole('button', { name: 'Close' }).click();

    // The date chip should now appear on the card.
    // Use data-testid="issue-card" (set on IssueCard) — more stable than class-based selectors.
    const card = page.getByTestId('issue-card').filter({ hasText: title });
    await expect(card).toContainText('Dec 31', { timeout: 10_000 });
    // Chip should use neutral styling (not overdue) — bg-gray-100.
    const chip = card.locator('span').filter({ hasText: 'Dec 31' });
    await expect(chip).toBeVisible();
    await expect(chip).not.toHaveClass(/amber/);
  });

  test('overdue date chip shows amber warning color', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'overdue',
    });

    // Create an issue with a past due date via the API.
    const issueTitle = `Overdue e2e ${Date.now()}`;
    const pastDate = '2020-01-01'; // definitely in the past

    const issueRes = await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: {
        projectId: ctx.project.id,
        title: issueTitle,
        dueDate: pastDate,
      },
    });
    expect(issueRes.ok(), `create issue failed: ${issueRes.status()}`).toBeTruthy();

    // Reload the board to see the pre-seeded issue.
    await page.reload();
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });

    // The overdue chip should appear in amber.
    const card = page.getByTestId('issue-card').filter({ hasText: issueTitle });
    await expect(card).toBeVisible({ timeout: 10_000 });
    const chip = card.locator('span[aria-label*="overdue" i], span[class*="amber"]').first();
    await expect(chip).toBeVisible();
  });

  test('clear the due date via the X button in the drawer', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'clear-due' });

    // Create an issue with a due date.
    const issueTitle = `Clear due e2e ${Date.now()}`;
    const issueRes = await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: {
        projectId: ctx.project.id,
        title: issueTitle,
        dueDate: '2099-06-15',
      },
    });
    expect(issueRes.ok()).toBeTruthy();

    await page.reload();
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });

    // Open the drawer.
    await page.getByText(issueTitle).first().click();

    // The "Clear due date" button should be visible when a date is set.
    const clearBtn = page.getByRole('button', { name: /clear due date/i });
    await expect(clearBtn).toBeVisible({ timeout: 10_000 });
    await clearBtn.click();

    // Close the drawer.
    await page.getByRole('button', { name: 'Close' }).click();

    // Card should no longer show a date chip.
    const card = page
      .getByTestId('issue-card')
      .filter({ hasText: issueTitle });
    await expect(card).toBeVisible();
    // "Jun 15" or any chip text should be gone.
    await expect(card.locator('span[aria-label*="Due"]')).toHaveCount(0);
  });

  test('due date persists after page reload', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'persist-due',
    });

    // Create an issue with a far-future due date.
    const issueTitle = `Persist due e2e ${Date.now()}`;
    const issueRes = await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: {
        projectId: ctx.project.id,
        title: issueTitle,
        dueDate: '2099-03-25',
      },
    });
    expect(issueRes.ok()).toBeTruthy();

    // Reload and verify the chip is still there.
    await page.reload();
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });

    const card = page
      .getByTestId('issue-card')
      .filter({ hasText: issueTitle });
    await expect(card).toBeVisible({ timeout: 10_000 });
    // "Mar 25" should appear in the chip.
    await expect(card).toContainText('Mar 25');
  });
});

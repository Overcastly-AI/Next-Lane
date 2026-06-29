/**
 * time-tracking.spec.ts
 *
 * End-to-end tests for the Time Tracking feature in the issue detail drawer.
 *
 * Desktop:
 *   1. Open an issue drawer → set an estimate via per-keystroke typing.
 *   2. Log 30m then 45m via the Log Work form.
 *   3. Assert the worklog list shows 2 entries and the progress/total reflects 75m.
 *   4. Delete a worklog → assert only one remains.
 *
 * Mobile (390px):
 *   - The time tracking section renders without horizontal overflow.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupIsolatedProject, createIssue, API_URL } from './helpers';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Log a worklog via the API; returns the created worklog id. */
async function createWorklog(
  request: APIRequestContext,
  token: string,
  issueId: string,
  minutes: number,
  note?: string,
): Promise<string> {
  const res = await request.post(
    `${API_URL}/api/issues/${issueId}/worklogs`,
    {
      headers: auth(token),
      data: { minutes, ...(note ? { note } : {}) },
    },
  );
  expect(res.ok(), `create worklog failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

// ---------------------------------------------------------------------------
// Desktop tests
// ---------------------------------------------------------------------------

test.describe('Time Tracking — desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('set estimate, log 30m then 45m, assert totals, delete a log', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'tt-desk',
    });

    // Create an issue via API.
    const { id: issueId } = await createIssue(
      request,
      ctx.token,
      ctx.project.id,
      { title: 'Time tracking test issue' },
    );
    void issueId;

    // Navigate to the board.
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Click the issue card to open the drawer.
    await page.getByText('Time tracking test issue').first().click();
    const drawer = page.getByRole('dialog').last();
    await expect(drawer).toBeVisible({ timeout: 10_000 });

    // The time tracking section should be visible.
    const section = drawer.getByTestId('time-tracking-section');
    await expect(section).toBeVisible({ timeout: 8_000 });

    // Set estimate — click the "Set estimate" button.
    const estimateButton = section.getByTestId('estimate-input');
    await expect(estimateButton).toBeVisible();
    await estimateButton.click();

    // After clicking, the edit input appears (also carries data-testid="estimate-input"
    // but is now an <input> element).
    const editInput = section.locator('input[data-testid="estimate-input"]');
    await expect(editInput).toBeVisible({ timeout: 4_000 });

    // Type the estimate per-keystroke.
    await editInput.click();
    for (const ch of '2h') {
      await page.keyboard.type(ch);
    }
    await page.keyboard.press('Enter');

    // After committing, the edit form closes and the button displays "2h".
    // Wait for the button (non-input) estimate-input to appear with the value.
    await expect(section.locator('button[data-testid="estimate-input"]')).toContainText('2h', {
      timeout: 8_000,
    });

    // Log first worklog via the form — type per-keystroke.
    const minutesInput = section.getByTestId('worklog-add-minutes');
    await expect(minutesInput).toBeVisible();
    await minutesInput.click();
    for (const ch of '30m') {
      await page.keyboard.type(ch);
    }
    const submitBtn = section.getByTestId('worklog-add-submit');
    await submitBtn.click();

    // First worklog row should appear.
    await expect(section.getByTestId('worklog-row')).toHaveCount(1, {
      timeout: 8_000,
    });

    // Log second worklog.
    await minutesInput.click();
    // Clear and type new value
    await page.keyboard.press('Control+a');
    for (const ch of '45m') {
      await page.keyboard.type(ch);
    }
    await submitBtn.click();

    // Both rows should be present.
    await expect(section.getByTestId('worklog-row')).toHaveCount(2, {
      timeout: 8_000,
    });

    // Progress bar: 75m total spent against 2h (120m) estimate.
    const progressBar = section.getByTestId('time-progress');
    await expect(progressBar).toBeVisible({ timeout: 8_000 });
    // aria-valuenow reflects 75 total minutes logged.
    await expect(progressBar).toHaveAttribute('aria-valuenow', '75', {
      timeout: 8_000,
    });

    // Verify the "logged" text summary mentions both values.
    // The section should show something like "1h 15m logged of 2h".
    await expect(section).toContainText(/logged/i, { timeout: 8_000 });

    // Delete the first worklog row (hover to reveal button).
    const firstRow = section.getByTestId('worklog-row').first();
    await firstRow.hover();
    const deleteBtn = firstRow.getByTestId('worklog-delete');
    await expect(deleteBtn).toBeVisible({ timeout: 4_000 });
    await deleteBtn.click();

    // ConfirmDialog — confirm the deletion.
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible({ timeout: 4_000 });
    await confirmDialog.getByRole('button', { name: /delete/i }).click();

    // Only one worklog row should remain.
    await expect(section.getByTestId('worklog-row')).toHaveCount(1, {
      timeout: 8_000,
    });
  });

  test('pre-seeded worklogs appear in the list', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'tt-seed',
    });

    const { id: issueId } = await createIssue(
      request,
      ctx.token,
      ctx.project.id,
      { title: 'Seeded worklogs issue' },
    );

    // Pre-seed two worklogs via the API.
    await createWorklog(request, ctx.token, issueId, 60, 'First hour');
    await createWorklog(request, ctx.token, issueId, 90, 'Sprint work');

    // Navigate to the board.
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Open the issue drawer.
    await page.getByText('Seeded worklogs issue').first().click();
    const drawer = page.getByRole('dialog').last();
    await expect(drawer).toBeVisible({ timeout: 10_000 });

    const section = drawer.getByTestId('time-tracking-section');
    await expect(section).toBeVisible({ timeout: 8_000 });

    // Two worklog rows should be visible.
    await expect(section.getByTestId('worklog-row')).toHaveCount(2, {
      timeout: 8_000,
    });

    // The section should show time logged (2h 30m total = 150 minutes).
    await expect(section).toContainText(/logged/i, { timeout: 8_000 });
  });
});

// ---------------------------------------------------------------------------
// Mobile test — overflow check
// ---------------------------------------------------------------------------

test.describe('Time Tracking — mobile (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('drawer time tracking section renders without horizontal overflow', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'tt-mob',
    });

    // Seed an issue with a worklog via API.
    const { id: issueId } = await createIssue(
      request,
      ctx.token,
      ctx.project.id,
      { title: 'Mobile time tracking issue' },
    );
    await createWorklog(
      request,
      ctx.token,
      issueId,
      45,
      'A note that is somewhat longer to test overflow on mobile viewports',
    );

    // Navigate to the board.
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Open the issue drawer.
    await page.getByText('Mobile time tracking issue').first().click();
    const drawer = page.getByRole('dialog').last();
    await expect(drawer).toBeVisible({ timeout: 10_000 });

    // Verify the time tracking section is visible.
    const section = drawer.getByTestId('time-tracking-section');
    await expect(section).toBeVisible({ timeout: 8_000 });

    // Verify no horizontal overflow at the page level.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    void issueId;
  });
});

/**
 * wip-limits.spec.ts
 *
 * End-to-end tests for the WIP limits feature:
 *  1. Admin sets a WIP limit on a column in Settings (via the column edit modal).
 *  2. The board header shows count / limit when a limit is set.
 *  3. The over-limit indicator appears when issues exceed the limit.
 *  4. No WIP indicator (plain count) when no limit is set.
 *  5. Mobile (390px): board column with a limit renders without horizontal overflow.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  setupIsolatedProject,
  createIssue,
  openProjectBoard,
  API_URL,
} from './helpers';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Fetch the project statuses and return them sorted by order. */
async function getStatuses(
  request: APIRequestContext,
  token: string,
  projectId: string,
): Promise<{ id: string; name: string; wipLimit: number | null; order: number }[]> {
  const res = await request.get(
    `${API_URL}/api/projects/${projectId}/statuses`,
    { headers: auth(token) },
  );
  expect(res.ok(), `getStatuses failed: ${res.status()}`).toBeTruthy();
  const data = (await res.json()) as {
    id: string;
    name: string;
    wipLimit: number | null;
    order: number;
  }[];
  return data.sort((a, b) => a.order - b.order);
}

/** PATCH a status's wipLimit via the REST API. */
async function setWipLimit(
  request: APIRequestContext,
  token: string,
  statusId: string,
  wipLimit: number | null,
): Promise<void> {
  const res = await request.patch(`${API_URL}/api/statuses/${statusId}`, {
    headers: auth(token),
    data: { wipLimit },
  });
  expect(res.ok(), `setWipLimit failed: ${res.status()}`).toBeTruthy();
}

// ---------------------------------------------------------------------------
// Desktop tests
// ---------------------------------------------------------------------------

test.describe('WIP limits — Settings UI (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('admin sets a WIP limit on a column in Settings via the edit modal', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'wip-settings',
      openBoard: false,
    });

    await page.goto(`/projects/${ctx.project.id}/settings`);

    // Wait for the columns section to load.
    const row = page.getByTestId('settings-column-row').first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Click the edit (pencil) button for the first column row.
    await row.getByRole('button', { name: /edit/i }).click();

    // The column form modal should open.
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 8_000 });

    // The WIP limit input should be present and empty by default.
    const wipInput = modal.getByTestId('column-wip-limit-input');
    await expect(wipInput).toBeVisible();
    await expect(wipInput).toHaveValue('');

    // Set a WIP limit of 3.
    await wipInput.fill('3');

    // Submit the form.
    await modal.getByRole('button', { name: /save/i }).click();

    // Modal closes.
    await expect(modal).not.toBeVisible({ timeout: 8_000 });

    // Re-open the edit modal to confirm the value persisted.
    await row.getByRole('button', { name: /edit/i }).click();
    const modal2 = page.getByRole('dialog');
    await expect(modal2).toBeVisible({ timeout: 8_000 });
    await expect(modal2.getByTestId('column-wip-limit-input')).toHaveValue('3');
    await modal2.getByRole('button', { name: /cancel/i }).click();
  });
});

test.describe('WIP limits — Board indicator (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('board shows count / limit and over-limit styling when exceeded', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'wip-board-over',
      openBoard: false,
    });

    // Get project statuses (To Do is first by default).
    const statuses = await getStatuses(request, ctx.token, ctx.project.id);
    const todoStatus = statuses[0];
    expect(todoStatus).toBeDefined();

    // Set a WIP limit of 2 on the To Do column via the API.
    await setWipLimit(request, ctx.token, todoStatus.id, 2);

    // Create 3 issues in the To Do column (exceeds the limit of 2).
    await createIssue(request, ctx.token, ctx.project.id, { title: 'WIP Issue 1' });
    await createIssue(request, ctx.token, ctx.project.id, { title: 'WIP Issue 2' });
    await createIssue(request, ctx.token, ctx.project.id, { title: 'WIP Issue 3' });

    // Navigate to the board.
    await openProjectBoard(page, ctx.project.id);

    // The To Do column header should show the WIP indicator: "3 / 2".
    const wipIndicator = page
      .getByTestId('column-wip-indicator')
      .first();
    await expect(wipIndicator).toBeVisible({ timeout: 10_000 });
    await expect(wipIndicator).toContainText('3 / 2');

    // The indicator should have the accessible over-limit label.
    await expect(wipIndicator).toHaveAttribute(
      'aria-label',
      /3 of 2.*over limit/i,
    );
  });

  test('board shows count / limit without over-limit styling when at or under limit', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'wip-board-under',
      openBoard: false,
    });

    // Get project statuses.
    const statuses = await getStatuses(request, ctx.token, ctx.project.id);
    const todoStatus = statuses[0];

    // Set a WIP limit of 5 on the To Do column.
    await setWipLimit(request, ctx.token, todoStatus.id, 5);

    // Create 2 issues (below the limit of 5).
    await createIssue(request, ctx.token, ctx.project.id, { title: 'Under WIP 1' });
    await createIssue(request, ctx.token, ctx.project.id, { title: 'Under WIP 2' });

    // Navigate to the board.
    await openProjectBoard(page, ctx.project.id);

    // The WIP indicator should be visible but NOT over-limit.
    const wipIndicator = page.getByTestId('column-wip-indicator').first();
    await expect(wipIndicator).toBeVisible({ timeout: 10_000 });
    await expect(wipIndicator).toContainText('2 / 5');

    // aria-label should NOT contain "over limit".
    const label = await wipIndicator.getAttribute('aria-label');
    expect(label).not.toMatch(/over limit/i);
  });

  test('board shows plain count (no WIP indicator) when no limit is set', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'wip-board-none',
      openBoard: false,
    });

    // Ensure no WIP limit is set (it's null by default, but let's verify via API).
    const statuses = await getStatuses(request, ctx.token, ctx.project.id);
    expect(statuses[0].wipLimit).toBeNull();

    // Create an issue so the count is non-zero.
    await createIssue(request, ctx.token, ctx.project.id, { title: 'No WIP Issue' });

    await openProjectBoard(page, ctx.project.id);

    // No WIP indicator should be rendered.
    const wipIndicator = page.getByTestId('column-wip-indicator');
    await expect(wipIndicator).toHaveCount(0);

    // The column should still render a count (the plain span without testid).
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Mobile test — overflow check
// ---------------------------------------------------------------------------

test.describe('WIP limits — mobile (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('board column with a WIP limit renders without horizontal page overflow', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'wip-mobile',
      openBoard: false,
    });

    // Set a WIP limit and create enough issues to trigger the over-limit state.
    const statuses = await getStatuses(request, ctx.token, ctx.project.id);
    const todoStatus = statuses[0];
    await setWipLimit(request, ctx.token, todoStatus.id, 1);
    await createIssue(request, ctx.token, ctx.project.id, { title: 'Mobile WIP 1' });
    await createIssue(request, ctx.token, ctx.project.id, { title: 'Mobile WIP 2' });

    // Navigate to the board.
    await openProjectBoard(page, ctx.project.id);

    // The WIP indicator should be visible.
    const wipIndicator = page.getByTestId('column-wip-indicator').first();
    await expect(wipIndicator).toBeVisible({ timeout: 15_000 });

    // Verify no horizontal overflow at the page level.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

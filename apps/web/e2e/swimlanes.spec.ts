/**
 * swimlanes.spec.ts
 *
 * Board group-by (swimlanes): selecting a dimension splits the board into
 * horizontal lanes, the choice persists in the URL, and None restores the
 * flat board. No cross-lane corruption; no mobile page overflow.
 */

import { test, expect } from '@playwright/test';
import { setupIsolatedProject, createIssue, API_URL } from './helpers';

test.describe('Board swimlanes (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('group by issue type renders lanes, persists in URL, None restores flat board', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'swim' });
    // One TASK (default) and one BUG → two "Issue type" lanes.
    await createIssue(request, ctx.token, ctx.project.id, { title: 'A task' });
    await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { projectId: ctx.project.id, title: 'A bug', type: 'BUG' },
    });

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });

    // No lanes by default.
    await expect(page.getByTestId('swimlane-lane')).toHaveCount(0);

    // Group by Issue type.
    await page.getByTestId('swimlane-groupby').click();
    await page.getByRole('menuitemradio', { name: /issue type/i }).click();

    await expect(page).toHaveURL(/[?&]group=type/, { timeout: 8_000 });
    await expect(page.getByTestId('swimlane-lane')).toHaveCount(2, {
      timeout: 8_000,
    });
    await expect(page.getByTestId('swimlane-lane-header').first()).toBeVisible();

    // Persist across reload.
    await page.reload();
    await expect(page.getByTestId('swimlane-lane')).toHaveCount(2, {
      timeout: 15_000,
    });

    // Back to None → flat board, no lanes.
    await page.getByTestId('swimlane-groupby').click();
    await page.getByRole('menuitemradio', { name: /^none$/i }).click();
    await expect(page.getByTestId('swimlane-lane')).toHaveCount(0, {
      timeout: 8_000,
    });
    await expect(page).not.toHaveURL(/[?&]group=/);
  });
});

test.describe('Board swimlanes (mobile)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('grouped board has no horizontal page overflow on mobile', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'swim-mob' });
    await createIssue(request, ctx.token, ctx.project.id, { title: 'm1' });
    await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { projectId: ctx.project.id, title: 'm2', type: 'BUG' },
    });

    await page.goto(`/projects/${ctx.project.id}/board?group=type`);
    await expect(page.getByTestId('swimlane-lane').first()).toBeVisible({
      timeout: 15_000,
    });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

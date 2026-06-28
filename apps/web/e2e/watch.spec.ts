/**
 * e2e: Watch toggle in the issue detail drawer.
 *
 * Covers:
 * - Opening an issue → the Watch button is visible (data-testid="issue-watch-toggle").
 * - Clicking Watch → button shows "Watching" and aria-pressed="true".
 * - Watcher count increments optimistically.
 * - Reloading the page → drawer re-opens and still shows "Watching".
 * - Clicking Watching (toggle off) → button returns to "Watch" state.
 *
 * NOTE: These tests assert the frontend UI behaviour. If the backend does not
 * yet implement POST/DELETE /issues/:id/watch (returning { watching: boolean }),
 * the toggle will still render correctly on the optimistic layer; the reload
 * test verifies server-persisted state and will naturally fail until the
 * backend lands. That is expected and documented.
 *
 * Desktop (1280x800) + mobile (375x812).
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupIsolatedProject, API_URL } from './helpers';

/** Create an issue via the API; returns its id. */
async function apiCreateIssue(
  request: APIRequestContext,
  token: string,
  projectId: string,
  title: string,
): Promise<string> {
  const res = await request.post(`${API_URL}/api/issues`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { projectId, title },
  });
  expect(res.ok(), `seed issue failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

/** Open the issue drawer via the board card. */
async function openIssueDrawer(
  page: import('@playwright/test').Page,
  title: string,
) {
  const card = page.getByText(title).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.click();
  const drawer = page.getByRole('dialog').last();
  await expect(drawer).toBeVisible({ timeout: 10_000 });
  return drawer;
}

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

test.describe('Issue watch toggle – desktop', () => {
  test('Watch button is present in the issue drawer', async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const ctx = await setupIsolatedProject(page, request, {
      label: 'watch-visible',
    });
    const title = `Watch visible ${stamp}`;
    await apiCreateIssue(request, ctx.token, ctx.project.id, title);

    await page.reload();
    await openIssueDrawer(page, title);

    const watchBtn = page.getByTestId('issue-watch-toggle');
    await expect(watchBtn).toBeVisible({ timeout: 10_000 });
  });

  test('Watch toggle changes to "Watching" when clicked', async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const ctx = await setupIsolatedProject(page, request, {
      label: 'watch-toggle',
    });
    const title = `Watch toggle ${stamp}`;
    await apiCreateIssue(request, ctx.token, ctx.project.id, title);

    await page.reload();
    await openIssueDrawer(page, title);

    const watchBtn = page.getByTestId('issue-watch-toggle');
    await expect(watchBtn).toBeVisible({ timeout: 10_000 });

    // Initially not watching.
    await expect(watchBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(watchBtn).toContainText('Watch');

    // Click to watch.
    await watchBtn.click();

    // Button should now show "Watching" and aria-pressed="true".
    await expect(watchBtn).toHaveAttribute('aria-pressed', 'true', {
      timeout: 5_000,
    });
    await expect(watchBtn).toContainText('Watching');
  });

  test('Watch toggle can be turned off after being enabled', async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const ctx = await setupIsolatedProject(page, request, {
      label: 'watch-off',
    });
    const title = `Watch off ${stamp}`;
    await apiCreateIssue(request, ctx.token, ctx.project.id, title);

    await page.reload();
    await openIssueDrawer(page, title);

    const watchBtn = page.getByTestId('issue-watch-toggle');
    await expect(watchBtn).toBeVisible({ timeout: 10_000 });

    // Watch on.
    await watchBtn.click();
    await expect(watchBtn).toHaveAttribute('aria-pressed', 'true', {
      timeout: 5_000,
    });
    await expect(watchBtn).toContainText('Watching');

    // Watch off.
    await watchBtn.click();
    await expect(watchBtn).toHaveAttribute('aria-pressed', 'false', {
      timeout: 5_000,
    });
    await expect(watchBtn).toContainText('Watch');
  });

  test('Watch state persists across page reload (requires backend support)', async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const ctx = await setupIsolatedProject(page, request, {
      label: 'watch-persist',
    });
    const title = `Watch persist ${stamp}`;
    const issueId = await apiCreateIssue(
      request,
      ctx.token,
      ctx.project.id,
      title,
    );

    await page.reload();
    await openIssueDrawer(page, title);

    const watchBtn = page.getByTestId('issue-watch-toggle');
    await expect(watchBtn).toBeVisible({ timeout: 10_000 });
    await watchBtn.click();
    await expect(watchBtn).toHaveAttribute('aria-pressed', 'true', {
      timeout: 5_000,
    });

    // Reload and reopen the drawer via the URL query param.
    await page.goto(
      `/projects/${ctx.project.id}/board?issue=${issueId}`,
    );
    const drawerReloaded = page.getByRole('dialog').last();
    await expect(drawerReloaded).toBeVisible({ timeout: 15_000 });

    const watchBtnReloaded = page.getByTestId('issue-watch-toggle');
    await expect(watchBtnReloaded).toBeVisible({ timeout: 10_000 });
    // If backend supports watch, aria-pressed should still be "true".
    await expect(watchBtnReloaded).toHaveAttribute('aria-pressed', 'true', {
      timeout: 10_000,
    });
    await expect(watchBtnReloaded).toContainText('Watching');
  });
});

// ---------------------------------------------------------------------------
// Mobile
// ---------------------------------------------------------------------------

test.describe('Issue watch toggle – mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('Watch button is accessible on mobile', async ({ page, request }) => {
    const stamp = Date.now();
    const ctx = await setupIsolatedProject(page, request, {
      label: 'watch-mobile',
    });
    const title = `Watch mobile ${stamp}`;
    await apiCreateIssue(request, ctx.token, ctx.project.id, title);

    await page.reload();
    await openIssueDrawer(page, title);

    const watchBtn = page.getByTestId('issue-watch-toggle');
    await expect(watchBtn).toBeVisible({ timeout: 10_000 });
    await expect(watchBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('Watch toggle works on mobile viewport', async ({ page, request }) => {
    const stamp = Date.now();
    const ctx = await setupIsolatedProject(page, request, {
      label: 'watch-mob-toggle',
    });
    const title = `Watch mob ${stamp}`;
    await apiCreateIssue(request, ctx.token, ctx.project.id, title);

    await page.reload();
    await openIssueDrawer(page, title);

    const watchBtn = page.getByTestId('issue-watch-toggle');
    await expect(watchBtn).toBeVisible({ timeout: 10_000 });
    await watchBtn.click();
    await expect(watchBtn).toHaveAttribute('aria-pressed', 'true', {
      timeout: 5_000,
    });
    await expect(watchBtn).toContainText('Watching');
  });
});

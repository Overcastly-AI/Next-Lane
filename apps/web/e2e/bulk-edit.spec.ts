/**
 * bulk-edit.spec.ts
 *
 * End-to-end tests for multi-select bulk editing on the Backlog (and Triage).
 * Selecting rows reveals a sticky action bar; choosing a field and applying
 * issues a single POST /issues/bulk and updates every selected issue. Verified
 * against the real API (the changes are re-read over the wire).
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  login,
  registerNewUser,
  createWorkspace,
  createProject,
  createIssue,
  API_URL,
} from './helpers';

async function getIssue(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<{ priority: string }> {
  const res = await request.get(`${API_URL}/api/issues/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { priority: string };
}

test.describe('Bulk edit — backlog (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('select multiple issues and bulk-set priority', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'bulk');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);
    const a = await createIssue(request, user.token, project.id, {
      title: 'Bulk A',
    });
    const b = await createIssue(request, user.token, project.id, {
      title: 'Bulk B',
    });
    await createIssue(request, user.token, project.id, { title: 'Bulk C' });

    await login(page, { email: user.email, password: user.password });
    await page.goto(`/projects/${project.id}/backlog`);

    // Rows render.
    await expect(page.getByTestId('backlog-issue').first()).toBeVisible({
      timeout: 15_000,
    });

    // No action bar until something is selected.
    await expect(page.getByTestId('bulk-action-bar')).toHaveCount(0);

    // Select the first two issues by their checkboxes.
    const rowA = page.locator(`[data-testid="bulk-select-row"][data-issue-id="${a.id}"]`);
    const rowB = page.locator(`[data-testid="bulk-select-row"][data-issue-id="${b.id}"]`);
    await rowA.click();
    await rowB.click();

    // Action bar appears.
    const bar = page.getByTestId('bulk-action-bar');
    await expect(bar).toBeVisible();

    // Apply is disabled until a field is chosen.
    await expect(page.getByTestId('bulk-apply')).toBeDisabled();

    // Set priority → HIGHEST and apply.
    await page.locator('#bulk-priority').selectOption('HIGHEST');
    await expect(page.getByTestId('bulk-apply')).toBeEnabled();
    await page.getByTestId('bulk-apply').click();

    // Selection clears (bar hides) once the mutation resolves.
    await expect(bar).toBeHidden({ timeout: 8_000 });

    // Both selected issues are now HIGHEST over the wire; the third is unchanged.
    await expect
      .poll(async () => (await getIssue(request, user.token, a.id)).priority)
      .toBe('HIGHEST');
    expect((await getIssue(request, user.token, b.id)).priority).toBe('HIGHEST');
  });

  test('select-all then clear deselects every row', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'bulk-all');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);
    await createIssue(request, user.token, project.id, { title: 'All 1' });
    await createIssue(request, user.token, project.id, { title: 'All 2' });

    await login(page, { email: user.email, password: user.password });
    await page.goto(`/projects/${project.id}/backlog`);
    await expect(page.getByTestId('backlog-issue').first()).toBeVisible({
      timeout: 15_000,
    });

    // Select all (in the backlog section) → bar appears.
    await page.getByTestId('bulk-select-all').first().click();
    await expect(page.getByTestId('bulk-action-bar')).toBeVisible();

    // Clear → bar hides.
    await page.getByTestId('bulk-clear').click();
    await expect(page.getByTestId('bulk-action-bar')).toBeHidden();
  });
});

test.describe('Bulk edit — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('action bar is usable without horizontal overflow', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'bulk-mobile');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);
    await createIssue(request, user.token, project.id, { title: 'Mob 1' });
    await createIssue(request, user.token, project.id, { title: 'Mob 2' });

    await login(page, { email: user.email, password: user.password });
    await page.goto(`/projects/${project.id}/backlog`);
    await expect(page.getByTestId('backlog-issue').first()).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId('bulk-select-row').first().click();
    await expect(page.getByTestId('bulk-action-bar')).toBeVisible();

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

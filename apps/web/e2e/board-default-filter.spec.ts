/**
 * e2e: Per-board default filter.
 *
 * A board can carry an always-applied NLQL filter (Board.filterQuery) so a
 * dedicated board (e.g. "Epics") only ever shows matching issues without the
 * user re-applying filters every time. Covers desktop + mobile:
 *  - Set the default filter via Board settings (general tab).
 *  - The board scopes to it (non-matching issues hidden) + indicator shown.
 *  - Clearing it shows everything again.
 *
 * Uses isolated projects so the shared demo is never polluted.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupIsolatedProject, API_URL } from './helpers';

async function seed(
  request: APIRequestContext,
  token: string,
  projectId: string,
): Promise<{ epicTitle: string; taskTitle: string }> {
  const stamp = Date.now();
  const epicTitle = `Epic item ${stamp}`;
  const taskTitle = `Task item ${stamp}`;
  async function post(data: Record<string, unknown>) {
    const res = await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { projectId, ...data },
    });
    expect(res.ok(), `seed failed: ${res.status()}`).toBeTruthy();
  }
  await post({ title: epicTitle, type: 'EPIC' });
  await post({ title: taskTitle, type: 'TASK' });
  return { epicTitle, taskTitle };
}

async function setDefaultFilter(
  page: import('@playwright/test').Page,
  query: string,
) {
  await page.getByTestId('board-switcher').click();
  await page.getByTestId('board-settings-button').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  const input = page.getByTestId('board-default-filter');
  await input.click();
  await input.fill('');
  if (query) {
    await input.pressSequentially(query, { delay: 15 });
  }
  // Always dismiss the autocomplete dropdown (it opens on focus even when empty)
  // so it doesn't overlay the Save button.
  await input.press('Escape');
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 5000 });
}

test.describe('board default filter', () => {
  test('scopes the board to its filter and shows an indicator', async ({
    page,
    request,
    isMobile,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'board-filter',
      projectName: 'Board Default Filter',
    });
    const { epicTitle, taskTitle } = await seed(request, ctx.token, ctx.project.id);

    await page.reload();
    await expect(page.getByText(epicTitle).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(taskTitle).first()).toBeVisible({ timeout: 10000 });

    await setDefaultFilter(page, 'type = EPIC');

    // The board is now scoped: epic stays, task is hidden, indicator appears.
    await expect(page.getByTestId('board-filter-indicator')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('board-filter-indicator')).toContainText('type = EPIC');
    await expect(page.getByText(epicTitle).first()).toBeVisible();
    await expect(page.getByText(taskTitle)).toHaveCount(0);

    // Clearing the filter brings everything back.
    await setDefaultFilter(page, '');
    await expect(page.getByTestId('board-filter-indicator')).toHaveCount(0, { timeout: 8000 });
    await expect(page.getByText(taskTitle).first()).toBeVisible({ timeout: 8000 });

    void isMobile;
  });
});

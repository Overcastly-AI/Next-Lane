/**
 * filter-persistence.spec.ts
 *
 * Board filter state is persisted to the URL so it survives reload and is
 * shareable: the NLQL query and quick-filter presets restore from the URL.
 */

import { test, expect } from '@playwright/test';
import { setupIsolatedProject, createIssue } from './helpers';

test.describe('Board filter URL persistence (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('NLQL query is written to the URL and restored on reload', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'fp-nlql' });
    await createIssue(request, ctx.token, ctx.project.id, { title: 'Persist me' });

    await page.goto(`/projects/${ctx.project.id}/board`);
    const input = page.getByTestId('nlql-query-input');
    await expect(input).toBeVisible({ timeout: 15_000 });

    await input.fill('priority = HIGH');
    // URL picks up the query (q param).
    await expect(page).toHaveURL(/[?&]q=/, { timeout: 8_000 });

    // Reload — the query is restored from the URL into the input.
    await page.reload();
    await expect(page.getByTestId('nlql-query-input')).toHaveValue(
      'priority = HIGH',
      { timeout: 15_000 },
    );
  });

  test('a quick-filter preset persists across reload', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'fp-preset' });
    await createIssue(request, ctx.token, ctx.project.id, { title: 'x' });

    await page.goto(`/projects/${ctx.project.id}/board`);
    const chip = page.getByTestId('quick-filter-high-priority');
    await expect(chip).toBeVisible({ timeout: 15_000 });

    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/[?&]presets=/, { timeout: 8_000 });

    await page.reload();
    await expect(
      page.getByTestId('quick-filter-high-priority'),
    ).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  });

  test('a shared URL with filters opens pre-filtered', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'fp-share' });
    await createIssue(request, ctx.token, ctx.project.id, { title: 'y' });

    // Open the board via a link that already carries a filter.
    await page.goto(
      `/projects/${ctx.project.id}/board?q=${encodeURIComponent('priority = HIGH')}`,
    );
    await expect(page.getByTestId('nlql-query-input')).toHaveValue(
      'priority = HIGH',
      { timeout: 15_000 },
    );
  });
});

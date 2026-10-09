/**
 * filter-persistence.spec.ts
 *
 * Board filter state is persisted to the URL so it survives reload and is
 * shareable: the NLQL query and quick-filter presets restore from the URL.
 */

import { test, expect } from '@playwright/test';
import { setupIsolatedProject, createIssue } from './helpers';
import { openFilterPanel, openQueryBar } from './board-toolbar';

test.describe('Board filter URL persistence (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('NLQL query is written to the URL and restored on reload', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'fp-nlql' });
    await createIssue(request, ctx.token, ctx.project.id, { title: 'Persist me' });

    await page.goto(`/projects/${ctx.project.id}/board`);
    // The query bar opens behind the toolbar's "Query" toggle...
    await expect(page.getByTestId('board-query-toggle')).toBeVisible({ timeout: 15_000 });
    const input = await openQueryBar(page);

    await input.fill('priority = HIGH');
    // URL picks up the query (q param).
    await expect(page).toHaveURL(/[?&]q=/, { timeout: 8_000 });

    // Reload — the query is restored from the URL into the input, and the bar
    // opens by itself (an applied query is never hidden).
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
    await expect(page.getByTestId('board-filter-trigger')).toBeVisible({ timeout: 15_000 });
    await openFilterPanel(page);
    const chip = page.getByTestId('quick-filter-high-priority');
    await expect(chip).toBeVisible();

    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/[?&]presets=/, { timeout: 8_000 });

    await page.reload();
    // The trigger carries the active count; the chip inside keeps its state.
    await expect(page.getByTestId('board-filter-count')).toHaveText('1', { timeout: 15_000 });
    await openFilterPanel(page);
    await expect(
      page.getByTestId('quick-filter-high-priority'),
    ).toHaveAttribute('aria-pressed', 'true');
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

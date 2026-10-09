/**
 * e2e: board mobile ergonomics (GA bugs #15 + #20).
 *
 * At 393px: every board control must expose a >=40x40 HIT area (a ::before may
 * widen a small visual) and nothing in the toolbar may be clipped by the
 * right edge. "Hit area" is measured the way a finger works: elementFromPoint
 * at the corners of a 40x40 box around the control's centre must resolve to
 * the control itself.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { setupIsolatedProject, createIssue } from './helpers';

test.use({ viewport: { width: 393, height: 852 } });

async function hitArea(page: Page, loc: Locator): Promise<boolean> {
  const handle = await loc.elementHandle();
  expect(handle).not.toBeNull();
  return page.evaluate((el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return [[-19, -19], [19, -19], [-19, 19], [19, 19], [0, 0]].every(([dx, dy]) => {
      const hit = document.elementFromPoint(cx + dx, cy + dy);
      return !!hit && (hit === el || el.contains(hit));
    });
  }, handle);
}

test.describe('board mobile tap targets and toolbar fit (393px)', () => {
  test('controls have >=40px hit areas and the toolbar is not clipped', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'tap' });
    await createIssue(request, ctx.token, ctx.project.id, { title: 'Tap target card' });
    await page.reload();
    await expect(page.getByTestId('issue-card').first()).toBeVisible({ timeout: 15_000 });

    const vw = 393;
    // Toolbar: search + Filter + Create fully inside the viewport (no right-edge clip).
    for (const loc of [
      page.getByPlaceholder('Search cards…'),
      page.getByTestId('board-filter-trigger'),
      page.getByRole('button', { name: /\+ Create issue/ }),
    ]) {
      const b = await loc.boundingBox();
      expect(b).not.toBeNull();
      expect(b!.x).toBeGreaterThanOrEqual(0);
      expect(b!.x + b!.width).toBeLessThanOrEqual(vw + 0.5);
      expect(b!.height).toBeGreaterThanOrEqual(39.5);
    }
    // No page-level horizontal overflow.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Filter chips / strip controls: >=40px tall.
    for (const id of ['swimlane-groupby', 'board-query-toggle']) {
      const b = await page.getByTestId(id).boundingBox();
      expect(b!.height, id).toBeGreaterThanOrEqual(39.5);
    }

    // Card status trigger + column "+" + icon tools: 40x40 hit areas.
    const trigger = page.getByTestId('card-status-trigger').first();
    expect(await hitArea(page, trigger), 'card status trigger hit area').toBe(true);
    const add = page.getByRole('button', { name: /^Add issue to To Do$/ }).first();
    expect(await hitArea(page, add), 'column + hit area').toBe(true);
    for (const id of ['export-csv', 'import-csv', 'board-select-toggle']) {
      const loc = page.getByTestId(id);
      await loc.scrollIntoViewIfNeeded();
      const b = await loc.boundingBox();
      expect(b!.width, id).toBeGreaterThanOrEqual(39.5);
      expect(b!.height, id).toBeGreaterThanOrEqual(39.5);
    }
  });

  test('filter popover options are 40px tall on touch', async ({ page, request }) => {
    await setupIsolatedProject(page, request, { label: 'tap-filter' });
    await page.getByTestId('board-filter-trigger').click();
    const chip = page.getByTestId('quick-filter-high-priority');
    const b = await chip.boundingBox();
    expect(b!.height).toBeGreaterThanOrEqual(39.5);
    // Escape closes without toggling anything.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Filters' })).toHaveCount(0);
    await expect(page.getByTestId('board-filter-count')).toHaveCount(0);
  });
});

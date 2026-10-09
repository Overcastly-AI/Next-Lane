/**
 * Planning surfaces (Backlog + Triage) share one shell/row vocabulary.
 * Regression guards for the GA design pass: no horizontal overflow at 393px,
 * real padding on Triage, identical ProjectNav tab set, >=44px rows, usable
 * hit areas, and a prefilled sprint name.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupIsolatedProject, createIssue } from './helpers';

const LONG = 'A reasonably long issue title that should still show most of its text';

async function offscreen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll('main *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > vw + 1 || r.left < -1);
      })
      .map((el) => `${el.tagName}.${(el as HTMLElement).className}`.slice(0, 80));
  });
}

test.describe('backlog + triage layout', () => {
  test('backlog header and rows fit the viewport', async ({ page, request }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'list-layout-b',
      openBoard: false,
    });
    await createIssue(request, token, project.id, { title: LONG });
    await page.goto(`/projects/${project.id}/backlog`);
    const h1 = page.getByRole('heading', { level: 1, name: 'Backlog' });
    await expect(h1).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('backlog-issue').first()).toBeVisible();

    expect(await offscreen(page)).toEqual([]);
    const vw = page.viewportSize()!.width;
    await expect(page.getByRole('button', { name: '+ Create sprint' })).toBeVisible();
    const create = await page.getByRole('button', { name: '+ Create sprint' }).boundingBox();
    expect(create!.x + create!.width).toBeLessThanOrEqual(vw);

    const row = page.getByTestId('backlog-issue').first();
    const rowBox = await row.boundingBox();
    expect(rowBox!.height).toBeGreaterThanOrEqual(44);
    // Title keeps a readable share of the row (was ~10 chars on mobile).
    const title = await row.getByText(LONG).boundingBox();
    expect(title!.width).toBeGreaterThanOrEqual(vw < 500 ? 150 : 240);

    // Move menu is an icon button with a real hit area.
    const move = await row.getByRole('button', { name: /move to/i }).boundingBox();
    expect(move!.width).toBeGreaterThanOrEqual(vw < 500 ? 40 : 32);
    expect(move!.height).toBeGreaterThanOrEqual(vw < 500 ? 40 : 32);
  });

  test('empty backlog collapses to a one-line row; sprint name is prefilled', async ({
    page,
    request,
  }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'list-layout-e',
      openBoard: false,
    });
    await page.goto(`/projects/${project.id}/backlog`);
    const empty = page.getByTestId('section-backlog').getByTestId('section-empty');
    await expect(empty).toContainText('Nothing unplanned', { timeout: 15_000 });
    expect((await empty.boundingBox())!.height).toBeLessThan(60);

    await page.getByRole('button', { name: '+ Create sprint' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Name')).toHaveValue('Sprint 1');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId('section-sprint')).toContainText('Sprint 1');
  });

  test('triage uses the standard shell with real padding', async ({ page, request }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'list-layout-t',
      openBoard: false,
    });
    await createIssue(request, token, project.id, { title: LONG });
    await page.goto(`/projects/${project.id}/triage`);
    const row = page.getByTestId('triage-row').first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    expect(await offscreen(page)).toEqual([]);
    const card = await row.locator('xpath=ancestor::section[1]').boundingBox();
    expect(card!.x).toBeGreaterThanOrEqual(12);
    const vw = page.viewportSize()!.width;
    expect(card!.x + card!.width).toBeLessThanOrEqual(vw - 12 + 1);
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // Same ProjectNav tab set as Backlog (Docs used to be missing).
    const nav = page.locator('nav[aria-label="Project navigation"]');
    await expect(nav.getByRole('link', { name: 'Docs', exact: true })).toBeAttached();
    await expect(nav.getByRole('link', { name: 'Triage', exact: true })).toBeAttached();
  });
});

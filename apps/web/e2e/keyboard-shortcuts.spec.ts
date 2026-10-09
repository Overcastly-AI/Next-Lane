import { test, expect } from '@playwright/test';
import {
  login,
  registerNewUser,
  createWorkspace,
  createProject,
  createIssue,
} from './helpers';

/**
 * Global keyboard shortcuts + "?" cheat-sheet. Desktop only — there is no
 * hardware keyboard on the mobile project.
 */
test.describe('Keyboard shortcuts (desktop)', () => {
  test.skip(({ isMobile }) => isMobile, 'keyboard shortcuts are desktop-only');

  async function setup(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
    const user = await registerNewUser(request, 'kbd');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);
    for (const t of ['Kbd One', 'Kbd Two', 'Kbd Three']) {
      await createIssue(request, user.token, project.id, { title: t });
    }
    await login(page, { email: user.email, password: user.password });
    await page.goto(`/projects/${project.id}/board`);
    await expect(page.getByTestId('issue-card').first()).toBeVisible({ timeout: 15_000 });
    return project;
  }

  test('? opens the cheat-sheet and Escape closes it', async ({ page, request }) => {
    await setup(page, request);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('?');
    const dlg = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dlg).toBeVisible();
    for (const g of ['Global', 'Board & Backlog', 'Issue']) {
      await expect(dlg.getByRole('heading', { name: g })).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  });

  test('typing in a field never triggers shortcuts', async ({ page, request }) => {
    await setup(page, request);
    const search = page.getByPlaceholder('Search cards…');
    await search.click();
    await search.pressSequentially('cgj?k/');
    await expect(search).toHaveValue('cgj?k/');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/board(\?|$)/);
  });

  test('/ focuses search; g-then-l/b/d/r navigate', async ({ page, request }) => {
    const project = await setup(page, request);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    await expect(page.getByPlaceholder('Search cards…')).toBeFocused();
    await page.locator('body').click({ position: { x: 5, y: 5 } });

    await page.keyboard.press('g');
    await page.keyboard.press('l');
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/backlog`));
    await page.keyboard.press('g');
    await page.keyboard.press('d');
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/dashboards`));
    await page.keyboard.press('g');
    await page.keyboard.press('r');
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/roadmap`));
    await page.keyboard.press('g');
    await page.keyboard.press('b');
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/board`));
  });

  test('c opens the create-issue modal; shortcuts pause while it is open', async ({ page, request }) => {
    await setup(page, request);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('c');
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  });

  test('j/k move a visible focus ring; Enter opens the issue (board)', async ({ page, request }) => {
    await setup(page, request);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    const cards = page.locator('[data-nav-item]');
    await page.keyboard.press('j');
    await expect(cards.nth(0)).toBeFocused();
    await page.keyboard.press('j');
    await expect(cards.nth(1)).toBeFocused();
    // Visible focus ring (ring utility paints a box-shadow).
    const shadow = await cards.nth(1).evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe('none');
    await page.keyboard.press('k');
    await expect(cards.nth(0)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/issue=/);
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('j/k and Enter work on the backlog', async ({ page, request }) => {
    const project = await setup(page, request);
    await page.goto(`/projects/${project.id}/backlog`);
    await expect(page.getByTestId('backlog-issue').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('j');
    await expect(page.locator('[data-nav-item]').first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('palette "Keyboard shortcuts" command opens the cheat-sheet', async ({ page, request }) => {
    await setup(page, request);
    await page.keyboard.press('Control+k');
    await expect(page.getByLabel('Search issues, pages, and projects')).toBeFocused();
    await page.getByRole('option', { name: /Keyboard shortcuts/ }).click();
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  });
});

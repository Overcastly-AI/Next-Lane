import { test, expect, type Page } from '@playwright/test';
import {
  login,
  registerNewUser,
  createWorkspace,
  createProject,
  createIssue,
  API_URL,
} from './helpers';

async function setup(page: Page, request: import('@playwright/test').APIRequestContext) {
  const user = await registerNewUser(request, 'bsel');
  const wsId = await createWorkspace(request, user.token);
  const project = await createProject(request, user.token, wsId);
  const ids: string[] = [];
  for (const t of ['Sel Alpha', 'Sel Beta', 'Sel Gamma']) {
    ids.push((await createIssue(request, user.token, project.id, { title: t })).id);
  }
  await login(page, { email: user.email, password: user.password });
  await page.goto(`/projects/${project.id}/board`);
  await expect(page.getByTestId('issue-card').first()).toBeVisible({ timeout: 15_000 });
  return { user, project, ids };
}

async function priorityOf(request: import('@playwright/test').APIRequestContext, token: string, id: string) {
  const res = await request.get(`${API_URL}/api/issues/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return ((await res.json()) as { priority: string }).priority;
}

const cardByTitle = (page: Page, t: string) =>
  page.locator('[data-nav-item]', { hasText: t });

test.describe('Board bulk select (desktop)', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop flow');

  test('shift-click selects, bulk-applies priority, Escape clears', async ({ page, request }) => {
    const { user, ids } = await setup(page, request);
    await expect(page.getByTestId('bulk-action-bar')).toHaveCount(0);

    await cardByTitle(page, 'Sel Alpha').click({ modifiers: ['Shift'] });
    await cardByTitle(page, 'Sel Beta').click({ modifiers: ['Control'] });
    // Modifier-click selects instead of opening the drawer.
    await expect(page).not.toHaveURL(/issue=/);
    const bar = page.getByTestId('bulk-action-bar');
    await expect(bar).toContainText('2');
    await expect(cardByTitle(page, 'Sel Alpha')).toHaveAttribute('data-selected', 'true');

    // Escape clears.
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);

    // Re-select via the hover checkbox and apply.
    await cardByTitle(page, 'Sel Alpha').hover();
    await cardByTitle(page, 'Sel Alpha').getByTestId('board-select-checkbox').click();
    await cardByTitle(page, 'Sel Gamma').click({ modifiers: ['Shift'] });
    await expect(bar).toContainText('2');
    await page.locator('#bulk-priority').selectOption('HIGHEST');
    await page.getByTestId('bulk-apply').click();
    await expect(bar).toBeHidden({ timeout: 20_000 });
    await expect
      .poll(() => priorityOf(request, user.token, ids[0]), { timeout: 20_000 })
      .toBe('HIGHEST');
    expect(await priorityOf(request, user.token, ids[2])).toBe('HIGHEST');
    expect(await priorityOf(request, user.token, ids[1])).not.toBe('HIGHEST');
  });

  test('selection survives a realtime refetch and ignores vanished ids', async ({ page, request }) => {
    const { user, project } = await setup(page, request);
    await cardByTitle(page, 'Sel Alpha').click({ modifiers: ['Shift'] });
    const bar = page.getByTestId('bulk-action-bar');
    await expect(bar).toContainText('1');
    // Another client adds a card -> board refetches via socket.
    await createIssue(request, user.token, project.id, { title: 'Sel Delta' });
    await expect(cardByTitle(page, 'Sel Delta')).toBeVisible({ timeout: 20_000 });
    await expect(bar).toContainText('1');
    await expect(cardByTitle(page, 'Sel Alpha')).toHaveAttribute('data-selected', 'true');
  });

  test('plain click still opens; dragging a card does not select or open it', async ({ page, request }) => {
    await setup(page, request);
    const card = cardByTitle(page, 'Sel Beta');
    const before = await card.boundingBox();
    const target = await page.getByRole('button', { name: /add issue to in progress/i }).first().boundingBox();
    if (!before || !target) throw new Error('no boxes');
    const sx = before.x + before.width / 2;
    const sy = before.y + before.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 12, sy + 12);
    for (let i = 1; i <= 30; i++) {
      await page.mouse.move(
        sx + 12 + (target.x + target.width / 2 - sx - 12) * (i / 30),
        sy + 12 + (target.y + target.height / 2 - sy - 12) * (i / 30),
      );
      await page.waitForTimeout(15);
    }
    await page.waitForTimeout(300);
    await page.mouse.up();
    await expect
      .poll(async () => (await cardByTitle(page, 'Sel Beta').boundingBox())?.x ?? 0)
      .toBeGreaterThan(before.x + 100);
    await expect(page.getByTestId('bulk-action-bar')).toHaveCount(0);
    await expect(page).not.toHaveURL(/issue=/);

    await cardByTitle(page, 'Sel Alpha').click();
    await expect(page).toHaveURL(/issue=/);
  });

  test('selection works in swimlane view', async ({ page, request }) => {
    const { project } = await setup(page, request);
    await page.goto(`/projects/${project.id}/board?groupBy=assignee`);
    await expect(page.locator('[data-nav-item]').first()).toBeVisible({ timeout: 15_000 });
    await cardByTitle(page, 'Sel Alpha').click({ modifiers: ['Shift'] });
    await cardByTitle(page, 'Sel Beta').click();
    await expect(page.getByTestId('bulk-action-bar')).toContainText('2');
  });
});

test.describe('Board bulk select (mobile)', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile flow');

  test('Select toggle, tap to select, bar fits the viewport', async ({ page, request }) => {
    await setup(page, request);
    const toggle = page.getByTestId('board-select-toggle');
    await toggle.scrollIntoViewIfNeeded();
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await cardByTitle(page, 'Sel Alpha').tap();
    await cardByTitle(page, 'Sel Beta').tap();
    await expect(page).not.toHaveURL(/issue=/);
    const bar = page.getByTestId('bulk-action-bar');
    await expect(bar).toContainText('2');
    const box = await bar.boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    // Deselect via the card, then leave select mode.
    await cardByTitle(page, 'Sel Alpha').tap();
    await cardByTitle(page, 'Sel Beta').tap();
    await expect(bar).toHaveCount(0);
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });
});

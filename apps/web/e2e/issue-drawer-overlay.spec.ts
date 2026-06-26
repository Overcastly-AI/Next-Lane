import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import {
  API_URL,
  createLabel,
  openProjectBoard,
  setupIsolatedProject,
  type IsolatedContext,
} from './helpers';

/**
 * Covers the issue-drawer UI-review fixes:
 *  - Labels render via the shared Badge primitive (accessible contrast),
 *    not the old raw-color inline chip.
 *  - The drawer behaves as a first-class overlay: body scroll-lock while
 *    open, Esc-to-close, and focus moved into the drawer (focus trap).
 *
 * Runs against an isolated per-test project (own user + workspace) seeded with a
 * red "bug" label (#ef4444) on one issue, so it never reads or pollutes the demo.
 */

/** Provision an isolated project with one issue carrying a red "bug" label. */
async function seedBugLabeledIssue(
  page: Page,
  request: APIRequestContext,
): Promise<IsolatedContext> {
  const ctx = await setupIsolatedProject(page, request, {
    label: 'drawer',
    openBoard: false,
  });
  const labelId = await createLabel(
    request,
    ctx.token,
    ctx.project.id,
    'bug',
    '#ef4444',
  );
  const issueRes = await request.post(`${API_URL}/api/issues`, {
    headers: { Authorization: `Bearer ${ctx.token}` },
    data: { projectId: ctx.project.id, title: 'Drawer bug card' },
  });
  expect(issueRes.ok(), `create issue failed: ${issueRes.status()}`).toBeTruthy();
  const issueId = ((await issueRes.json()) as { id: string }).id;
  const attach = await request.post(
    `${API_URL}/api/issues/${issueId}/labels`,
    {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { labelId },
    },
  );
  expect(attach.ok(), `attach label failed: ${attach.status()}`).toBeTruthy();
  await openProjectBoard(page, ctx.project.id);
  return ctx;
}

/** Open the board card carrying the "bug" label and wait for the drawer. */
async function openLabeledCard(
  page: Page,
  request: APIRequestContext,
): Promise<void> {
  await seedBugLabeledIssue(page, request);
  const labelOnCard = page.getByText('bug', { exact: true }).first();
  await expect(labelOnCard).toBeVisible({ timeout: 10_000 });
  await labelOnCard.click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('Issue drawer overlay', () => {
  test('labels render legibly via Badge (darkened text, not raw light color)', async ({
    page,
    request,
  }) => {
    await openLabeledCard(page, request);

    const drawer = page.getByRole('dialog');
    const labelBadge = drawer.getByText('bug', { exact: true }).last();
    await expect(labelBadge).toBeVisible();

    const { color, background } = await labelBadge.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.color, background: cs.backgroundColor };
    });

    const parse = (v: string): number[] =>
      (v.match(/[\d.]+/g) ?? []).map(Number);
    const [tr, tg, tb] = parse(color);

    // Badge darkens the raw label color (#ef4444) for the text instead of using
    // it verbatim — this is the contrast fix. Each channel is scaled down (~0.65),
    // so the text is strictly darker than the raw label color on every channel.
    expect(tr).toBeLessThan(0xef);
    expect(tg).toBeLessThan(0x44);
    expect(tb).toBeLessThan(0x44);
    // And it is NOT the old illegible "raw color as text" chip.
    expect(color).not.toBe('rgb(239, 68, 68)');

    // Background is a translucent tint (rgba w/ alpha < 1), distinct from the text.
    expect(background).toMatch(/rgba\(.*0\.\d+\)/);
    expect(background).not.toBe(color);
  });

  test('opening the drawer locks body scroll; closing restores it', async ({
    page,
    request,
  }) => {
    await seedBugLabeledIssue(page, request);
    const before = await page.evaluate(() => document.body.style.overflow);

    const labelOnCard = page.getByText('bug', { exact: true }).first();
    await expect(labelOnCard).toBeVisible({ timeout: 10_000 });
    await labelOnCard.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const whileOpen = await page.evaluate(() => document.body.style.overflow);
    expect(whileOpen).toBe('hidden');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    const afterClose = await page.evaluate(() => document.body.style.overflow);
    expect(afterClose).toBe(before);
  });

  test('Escape closes the drawer', async ({ page, request }) => {
    await openLabeledCard(page, request);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('focus moves into the drawer when opened (focus trap)', async ({
    page,
    request,
  }) => {
    await openLabeledCard(page, request);
    const focusedInsideDrawer = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return !!dialog && !!document.activeElement && dialog.contains(document.activeElement);
    });
    expect(focusedInsideDrawer).toBe(true);
  });
});

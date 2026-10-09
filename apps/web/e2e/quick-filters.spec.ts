/**
 * e2e: Quick-filter preset chips on the board toolbar.
 *
 * Covers:
 * - "High priority" chip → board shows only HIGH / HIGHEST cards; toggle off → all return.
 * - "My issues" chip → board narrows to the current user's assigned cards.
 * - "Unresolved" chip → DONE-category cards are hidden.
 * - "Recently updated" chip renders and is accessible.
 * - Chips are accessible on both desktop (1280x800) and mobile (375x812).
 *
 * Each test creates an isolated tenant so state never leaks to the demo project.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupIsolatedProject, API_URL } from './helpers';
import { openFilterPanel } from './board-toolbar';

/** Quick-filter chips live in the Filter popover; open it, return the chip. */
async function qf(page: import('@playwright/test').Page, key: string) {
  await openFilterPanel(page);
  return page.getByTestId(`quick-filter-${key}`);
}

interface IsoCtx {
  token: string;
  projectId: string;
  userId: string;
}

/** Create an issue via the API with arbitrary fields. */
async function apiCreateIssue(
  request: APIRequestContext,
  ctx: IsoCtx,
  data: Record<string, unknown>,
): Promise<{ id: string; title: string }> {
  const res = await request.post(`${API_URL}/api/issues`, {
    headers: { Authorization: `Bearer ${ctx.token}` },
    data: { projectId: ctx.projectId, title: 'placeholder', ...data },
  });
  expect(res.ok(), `seed issue failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; title: string };
  return { id: body.id, title: body.title as string };
}

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

test.describe('Quick-filter presets – desktop', () => {
  test('chip buttons are visible in the toolbar', async ({ page, request }) => {
    await setupIsolatedProject(page, request, { label: 'qf-visible' });
    await expect(
      (await qf(page, 'my-issues')),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      (await qf(page, 'high-priority')),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      (await qf(page, 'unresolved')),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      (await qf(page, 'recent')),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('"High priority" shows only HIGH/HIGHEST cards; toggle off restores all', async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const ctx = await setupIsolatedProject(page, request, {
      label: 'qf-high',
    });
    const isoCtx: IsoCtx = {
      token: ctx.token,
      projectId: ctx.project.id,
      userId: ctx.user.userId,
    };

    const highTitle = `HIGH issue ${stamp}`;
    const medTitle = `MEDIUM issue ${stamp}`;
    const lowTitle = `LOW issue ${stamp}`;

    await apiCreateIssue(request, isoCtx, {
      title: highTitle,
      priority: 'HIGH',
    });
    await apiCreateIssue(request, isoCtx, {
      title: medTitle,
      priority: 'MEDIUM',
    });
    await apiCreateIssue(request, isoCtx, {
      title: lowTitle,
      priority: 'LOW',
    });

    // Reload so the seeded issues appear.
    await page.reload();
    await expect(page.getByText(highTitle).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(medTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(lowTitle).first()).toBeVisible({
      timeout: 10_000,
    });

    // Activate "High priority" preset.
    const chip = (await qf(page, 'high-priority'));
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');

    // HIGH card visible; MEDIUM + LOW hidden.
    await expect(page.getByText(highTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(medTitle)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(lowTitle)).toHaveCount(0, { timeout: 10_000 });

    // Toggle off — all cards return.
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText(medTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(lowTitle).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('"My issues" narrows board to current user\'s assigned cards', async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const ctx = await setupIsolatedProject(page, request, {
      label: 'qf-my',
    });
    const isoCtx: IsoCtx = {
      token: ctx.token,
      projectId: ctx.project.id,
      userId: ctx.user.userId,
    };

    const myTitle = `My issue ${stamp}`;
    const otherTitle = `Other issue ${stamp}`;

    // Create one issue assigned to the current user, one unassigned.
    await apiCreateIssue(request, isoCtx, {
      title: myTitle,
      assigneeId: ctx.user.userId,
    });
    await apiCreateIssue(request, isoCtx, {
      title: otherTitle,
    });

    await page.reload();
    await expect(page.getByText(myTitle).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(otherTitle).first()).toBeVisible({
      timeout: 10_000,
    });

    // Activate "My issues".
    const chip = (await qf(page, 'my-issues'));
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');

    // Only my issue is visible.
    await expect(page.getByText(myTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(otherTitle)).toHaveCount(0, {
      timeout: 10_000,
    });

    // Toggle off — other issue returns.
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText(otherTitle).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('"Unresolved" hides cards whose status category is DONE', async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const ctx = await setupIsolatedProject(page, request, {
      label: 'qf-unresolved',
    });
    const isoCtx: IsoCtx = {
      token: ctx.token,
      projectId: ctx.project.id,
      userId: ctx.user.userId,
    };

    // The default project seed includes "To Do", "In Progress", "Done" statuses.
    // Get the statuses so we can find the Done status id.
    const statusesRes = await request.get(
      `${API_URL}/api/projects/${ctx.project.id}/statuses`,
      { headers: { Authorization: `Bearer ${ctx.token}` } },
    );
    const statuses = (await statusesRes.json()) as Array<{
      id: string;
      name: string;
      category: string;
    }>;
    const doneStatus = statuses.find((s) => s.category === 'DONE');

    const doneTitle = `Done issue ${stamp}`;
    const todoTitle = `Todo issue ${stamp}`;

    await apiCreateIssue(request, isoCtx, { title: todoTitle });
    if (doneStatus) {
      await apiCreateIssue(request, isoCtx, {
        title: doneTitle,
        statusId: doneStatus.id,
      });
    }

    await page.reload();
    await expect(page.getByText(todoTitle).first()).toBeVisible({
      timeout: 15_000,
    });

    // Activate "Unresolved".
    const chip = (await qf(page, 'unresolved'));
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');

    // Todo issue still visible; Done issue hidden (if doneStatus was found).
    await expect(page.getByText(todoTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    if (doneStatus) {
      await expect(page.getByText(doneTitle)).toHaveCount(0, {
        timeout: 10_000,
      });
    }
  });

  test('presets compose with manual priority filter (AND semantics)', async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const ctx = await setupIsolatedProject(page, request, {
      label: 'qf-compose',
    });
    const isoCtx: IsoCtx = {
      token: ctx.token,
      projectId: ctx.project.id,
      userId: ctx.user.userId,
    };

    const myHighTitle = `My High ${stamp}`;
    const myLowTitle = `My Low ${stamp}`;
    const otherHighTitle = `Other High ${stamp}`;

    await apiCreateIssue(request, isoCtx, {
      title: myHighTitle,
      priority: 'HIGH',
      assigneeId: ctx.user.userId,
    });
    await apiCreateIssue(request, isoCtx, {
      title: myLowTitle,
      priority: 'LOW',
      assigneeId: ctx.user.userId,
    });
    await apiCreateIssue(request, isoCtx, {
      title: otherHighTitle,
      priority: 'HIGH',
    });

    await page.reload();
    await expect(page.getByText(myHighTitle).first()).toBeVisible({
      timeout: 15_000,
    });

    // Both "My issues" and "High priority" presets active → only myHighTitle.
    await (await qf(page, 'my-issues')).click();
    await (await qf(page, 'high-priority')).click();

    await expect(page.getByText(myHighTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(myLowTitle)).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.getByText(otherHighTitle)).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Mobile
// ---------------------------------------------------------------------------

test.describe('Quick-filter presets – mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('chips are accessible on mobile viewport', async ({ page, request }) => {
    await setupIsolatedProject(page, request, { label: 'qf-mobile' });
    await expect(
      (await qf(page, 'my-issues')),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      (await qf(page, 'high-priority')),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('"High priority" works on mobile', async ({ page, request }) => {
    const stamp = Date.now();
    const ctx = await setupIsolatedProject(page, request, {
      label: 'qf-high-mobile',
    });
    const isoCtx: IsoCtx = {
      token: ctx.token,
      projectId: ctx.project.id,
      userId: ctx.user.userId,
    };

    const highTitle = `HIGH mob ${stamp}`;
    const medTitle = `MED mob ${stamp}`;

    await apiCreateIssue(request, isoCtx, { title: highTitle, priority: 'HIGH' });
    await apiCreateIssue(request, isoCtx, { title: medTitle, priority: 'MEDIUM' });

    await page.reload();
    await expect(page.getByText(highTitle).first()).toBeVisible({
      timeout: 15_000,
    });

    const chip = (await qf(page, 'high-priority'));
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');

    await expect(page.getByText(highTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(medTitle)).toHaveCount(0, { timeout: 10_000 });
  });

  // ── Regression coverage for Pass 12's P2: chips clipped past the right edge ──
  //
  // The chips used to sit in a row that overflowed the 393px viewport with no
  // scroll cue ("Recently updated" cut to "Rec…"). They now live in the Filter
  // popover, which is viewport-clamped: every chip must be fully on-screen.
  test('"Recently updated" is fully inside the viewport at 393px', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'qf-scroll' });

    const panel = await openFilterPanel(page);
    const row = panel.getByRole('group', { name: 'Quick filters' });
    await expect(row).toBeVisible({ timeout: 10_000 });

    const viewport = page.viewportSize()!;
    for (const key of ['my-issues', 'high-priority', 'unresolved', 'recent']) {
      const chip = page.getByTestId(`quick-filter-${key}`);
      await expect(chip).toBeVisible();
      const box = await chip.boundingBox();
      expect(box, key).not.toBeNull();
      expect(box!.x, key).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, key).toBeLessThanOrEqual(viewport.width + 1);
    }
  });

  // ── Regression coverage for Pass 12's P3: "Group by" chip wraps to 2 lines ──
  test('"Group by" chip stays single-line at 393px, matching sibling filter chips', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'qf-groupby-wrap' });

    const groupByBtn = page.getByTestId('swimlane-groupby');
    await expect(groupByBtn).toBeVisible({ timeout: 10_000 });
    const box = await groupByBtn.boundingBox();
    expect(box).not.toBeNull();
    // A single-line 14px chip button is ~36px tall; two-line wrap roughly
    // doubles that. Assert it stays in the single-line range.
    expect(box!.height).toBeLessThan(44);
  });
});

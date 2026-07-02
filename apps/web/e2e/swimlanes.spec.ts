/**
 * swimlanes.spec.ts
 *
 * Board group-by (swimlanes): selecting a dimension splits the board into
 * horizontal lanes, the choice persists in the URL, and None restores the
 * flat board. No cross-lane corruption; no mobile page overflow.
 *
 * Also covers Swimlanes v2 ("Kanban sections by field"): Component, Sprint,
 * Labels, and per-project custom SELECT fields as additional group-by
 * dimensions, plus the per-board "Default grouping" setting.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  setupIsolatedProject,
  createIssue,
  API_URL,
  paintedDistinctColorCount,
} from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Create a custom field via the API. Returns the created definition id. */
async function createCustomField(
  request: APIRequestContext,
  token: string,
  projectId: string,
  body: { name: string; type: string; options?: string[] },
): Promise<string> {
  const res = await request.post(
    `${API_URL}/api/projects/${projectId}/custom-fields`,
    { headers: authHeaders(token), data: body },
  );
  expect(res.ok(), `create custom field failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

/** Create a project component via the API. Returns its id. */
async function createComponent(
  request: APIRequestContext,
  token: string,
  projectId: string,
  name: string,
): Promise<string> {
  const res = await request.post(
    `${API_URL}/api/projects/${projectId}/components`,
    { headers: authHeaders(token), data: { name } },
  );
  expect(res.ok(), `create component failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

/** Patch an issue via the API (set componentId / customFields / etc). */
async function patchIssue(
  request: APIRequestContext,
  token: string,
  issueId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const res = await request.patch(`${API_URL}/api/issues/${issueId}`, {
    headers: authHeaders(token),
    data,
  });
  expect(res.ok(), `patch issue failed: ${res.status()}`).toBeTruthy();
}

test.describe('Board swimlanes (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('group by issue type renders lanes, persists in URL, None restores flat board', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'swim' });
    // One TASK (default) and one BUG → two "Issue type" lanes.
    await createIssue(request, ctx.token, ctx.project.id, { title: 'A task' });
    await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { projectId: ctx.project.id, title: 'A bug', type: 'BUG' },
    });

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });

    // No lanes by default.
    await expect(page.getByTestId('swimlane-lane')).toHaveCount(0);

    // Group by Issue type.
    await page.getByTestId('swimlane-groupby').click();
    await page.getByRole('menuitemradio', { name: /issue type/i }).click();

    await expect(page).toHaveURL(/[?&]group=type/, { timeout: 8_000 });
    await expect(page.getByTestId('swimlane-lane')).toHaveCount(2, {
      timeout: 8_000,
    });
    await expect(page.getByTestId('swimlane-lane-header').first()).toBeVisible();

    // Persist across reload.
    await page.reload();
    await expect(page.getByTestId('swimlane-lane')).toHaveCount(2, {
      timeout: 15_000,
    });

    // Back to None → flat board, no lanes.
    await page.getByTestId('swimlane-groupby').click();
    await page.getByRole('menuitemradio', { name: /^none$/i }).click();
    await expect(page.getByTestId('swimlane-lane')).toHaveCount(0, {
      timeout: 8_000,
    });
    await expect(page).not.toHaveURL(/[?&]group=/);
  });

  // ── Swimlanes v2: Component dimension ────────────────────────────────────

  test('group by component renders a lane per component plus "No component"', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'swim-comp' });
    const componentId = await createComponent(request, ctx.token, ctx.project.id, 'Backend');
    const withComponent = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Has a component',
    });
    await createIssue(request, ctx.token, ctx.project.id, { title: 'No component' });
    await patchIssue(request, ctx.token, withComponent.id, { componentId });

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('swimlane-groupby').click();
    await page.getByRole('menuitemradio', { name: /^component$/i }).click();

    await expect(page).toHaveURL(/[?&]group=component/, { timeout: 8_000 });
    await expect(page.getByTestId('swimlane-lane')).toHaveCount(2, { timeout: 8_000 });
    await expect(
      page.getByTestId('swimlane-lane-header').filter({ hasText: 'Backend' }),
    ).toBeVisible();
    await expect(
      page.getByTestId('swimlane-lane-header').filter({ hasText: 'No component' }),
    ).toBeVisible();

    await page.screenshot({ path: '/tmp/nav-shots/swimlanes-component.png' });
  });

  // ── Swimlanes v2: custom SELECT field dimension ──────────────────────────

  test('group by a custom SELECT field renders lanes incl. "None"', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'swim-cf' });
    const fieldId = await createCustomField(request, ctx.token, ctx.project.id, {
      name: 'Severity',
      type: 'SELECT',
      options: ['Low', 'High'],
    });
    const low = await createIssue(request, ctx.token, ctx.project.id, { title: 'Low sev' });
    const high = await createIssue(request, ctx.token, ctx.project.id, { title: 'High sev' });
    await createIssue(request, ctx.token, ctx.project.id, { title: 'No sev value' });
    await patchIssue(request, ctx.token, low.id, { customFields: { [fieldId]: 'Low' } });
    await patchIssue(request, ctx.token, high.id, { customFields: { [fieldId]: 'High' } });

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('swimlane-groupby').click();
    await page.getByRole('menuitemradio', { name: 'Severity' }).click();

    await expect(page).toHaveURL(/[?&]group=cf(%3A|:)/, { timeout: 8_000 });
    // Low, High, and "None" (no value set) → 3 lanes.
    await expect(page.getByTestId('swimlane-lane')).toHaveCount(3, { timeout: 8_000 });
    await expect(
      page.getByTestId('swimlane-lane-header').filter({ hasText: 'Low' }),
    ).toBeVisible();
    await expect(
      page.getByTestId('swimlane-lane-header').filter({ hasText: 'High' }),
    ).toBeVisible();
    await expect(
      page.getByTestId('swimlane-lane-header').filter({ hasText: 'None' }),
    ).toBeVisible();

    // Reload persists the cf:<id> dimension.
    await page.reload();
    await expect(page.getByTestId('swimlane-lane')).toHaveCount(3, { timeout: 15_000 });

    await page.screenshot({ path: '/tmp/nav-shots/swimlanes-customfield.png' });
  });

  // ── Swimlanes v2: per-board default grouping ─────────────────────────────

  test('per-board default grouping applies on fresh load; ?group= URL override wins; persists on reload', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'swim-default' });
    await createIssue(request, ctx.token, ctx.project.id, { title: 'A task' });
    await request.post(`${API_URL}/api/issues`, {
      headers: authHeaders(ctx.token),
      data: { projectId: ctx.project.id, title: 'A bug', type: 'BUG' },
    });

    // Set the board's default grouping through the real Board settings UI
    // (exercises the "board-default-groupby" select, not just the API).
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('board-switcher').click();
    const boardRow = page.getByTestId('board-switcher-option').first();
    await boardRow.hover();
    await boardRow.locator('..').getByTestId('board-settings-button').click();
    const dialog = page.getByRole('dialog', { name: 'Board settings' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByTestId('board-default-groupby').selectOption('type');
    await dialog.getByRole('button', { name: /save/i }).click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // Fresh load, no ?group= param → the per-board default applies.
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByTestId('swimlane-lane')).toHaveCount(2, { timeout: 15_000 });
    await expect(page).not.toHaveURL(/[?&]group=/);

    // Explicit ?group= URL override wins over the board default: both
    // seeded issues are MEDIUM priority → grouping by priority is 1 lane.
    await page.goto(`/projects/${ctx.project.id}/board?group=priority`);
    await expect(page.getByTestId('swimlane-lane')).toHaveCount(1, { timeout: 15_000 });

    // The override persists across reload.
    await page.reload();
    await expect(page.getByTestId('swimlane-lane')).toHaveCount(1, { timeout: 15_000 });
    await expect(page).toHaveURL(/[?&]group=priority/);

    // Explicitly turning grouping off (None) overrides the board default too
    // (a bare "no ?group=" would just re-apply the default).
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByTestId('swimlane-lane')).toHaveCount(2, { timeout: 15_000 });
    await page.getByTestId('swimlane-groupby').click();
    await page.getByRole('menuitemradio', { name: /^none$/i }).click();
    await expect(page.getByTestId('swimlane-lane')).toHaveCount(0, { timeout: 8_000 });
    await expect(page).toHaveURL(/[?&]group=none/);
  });
});

test.describe('Board swimlanes (mobile)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('grouped board has no horizontal page overflow on mobile', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'swim-mob' });
    await createIssue(request, ctx.token, ctx.project.id, { title: 'm1' });
    await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { projectId: ctx.project.id, title: 'm2', type: 'BUG' },
    });

    await page.goto(`/projects/${ctx.project.id}/board?group=type`);
    await expect(page.getByTestId('swimlane-lane').first()).toBeVisible({
      timeout: 15_000,
    });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  // ── Regression coverage for Pass 12's P1: invisible "Group by" dropdown ──
  //
  // The bug this guards against: the menu was DOM-present, `isVisible():
  // true`, with a valid non-zero `boundingBox()` — and STILL painted zero
  // real pixels on a real phone because a clipping ancestor
  // (`overflow-x-clip`) suppressed the compositor's paint of the whole
  // absolutely-positioned box once it extended past the 393px viewport
  // edge. DOM presence + `isVisible()` alone did not catch this; a real
  // rendered-pixel check (below) plus a full-containment boundingBox check
  // are both required, per docs/AUDIT-PRODUCT.md Pass 12's own recommended
  // follow-up ("a visibility-by-composite check, not just a
  // visibility-by-style check").
  test('Group by dropdown menu is fully within the viewport AND paints real, non-blank pixels at 393px', async ({
    page,
    request,
  }) => {
    test.setTimeout(45_000);
    const ctx = await setupIsolatedProject(page, request, { label: 'swim-paint' });
    await createIssue(request, ctx.token, ctx.project.id, { title: 'p1' });
    await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { projectId: ctx.project.id, title: 'p2', type: 'BUG' },
    });

    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });

    const groupByBtn = page.getByTestId('swimlane-groupby');
    await groupByBtn.scrollIntoViewIfNeeded();
    await groupByBtn.click();

    const menu = page.getByRole('menu', { name: 'Group by menu' });
    await expect(menu).toBeVisible({ timeout: 5_000 });

    // 1. Full containment: the panel's box must not extend past the
    //    viewport (the audit's root-cause geometry: 208px-wide panel
    //    anchored at x:279 on a 393px viewport extended 94px off-canvas).
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);

    // 2. Paint-level check: a real screenshot of the menu's own region must
    //    show more than a single flat color — real bordered/text content,
    //    not a fully-suppressed blank paint.
    const distinctColors = await paintedDistinctColorCount(page, menu);
    expect(distinctColors).toBeGreaterThan(5);

    // 3. The functionally-interactive option is also genuinely clickable at
    //    its real screen position (not just DOM-clickable).
    await page.getByRole('menuitemradio', { name: /issue type/i }).click();
    await expect(page.getByTestId('swimlane-lane')).toHaveCount(2, { timeout: 8_000 });

    await page.screenshot({ path: '/tmp/nav-shots/mobile-groupby-fixed.png' });
  });

  test('Priority filter dropdown (shares the same absolute-panel pattern) also paints real pixels at 393px', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'swim-paint-pri' });
    await createIssue(request, ctx.token, ctx.project.id, { title: 'p1' });

    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });

    const priorityBtn = page.getByRole('button', { name: /^priority$/i });
    await priorityBtn.scrollIntoViewIfNeeded();
    await priorityBtn.click();

    const menu = page.getByRole('dialog', { name: 'Filter by priority' });
    await expect(menu).toBeVisible({ timeout: 5_000 });

    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);

    const distinctColors = await paintedDistinctColorCount(page, menu);
    expect(distinctColors).toBeGreaterThan(5);
  });
});

import { test, expect, type Page } from '@playwright/test';
import { setupIsolatedProject, trackApiWrites } from './helpers';

/**
 * pages-qa-extra.spec.ts
 *
 * Independent QA additions to pages.spec.ts, covering flows called out
 * specifically for the review-fix wave (commit 79b6d32 "reorder math, graph
 * perf, wiki-link integrity, authoritative link traversal"):
 *   - root + child hierarchy actually renders nested in the tree
 *   - page-tree reorder (move up/down) lands on the CORRECT final position
 *     with no overshoot / no-op, and persists across reload
 *   - CreatePageModal blocks [ ] | in a title inline (disabled submit + msg)
 *   - the knowledge graph's zoom controls + pan actually move the camera,
 *     including on mobile
 */

async function treeItemTitles(page: Page): Promise<string[]> {
  const mobileToggle = page.getByTestId('page-tree-mobile-toggle');
  const scope = (await mobileToggle.isVisible().catch(() => false))
    ? page.getByTestId('page-tree-mobile-drawer')
    : page.locator('nav[aria-label="Pages"]');
  const rows = scope.locator('[data-testid^="page-tree-item-"]');
  const count = await rows.count();
  const titles: string[] = [];
  for (let i = 0; i < count; i++) {
    // Title text lives in the row's span; strip the "(archived)" suffix if present.
    const text = (await rows.nth(i).innerText()).trim();
    titles.push(text.split('\n')[0]);
  }
  return titles;
}

async function ensureTreeOpen(page: Page): Promise<void> {
  const mobileToggle = page.getByTestId('page-tree-mobile-toggle');
  if (await mobileToggle.isVisible().catch(() => false)) {
    await mobileToggle.click();
    await expect(page.getByTestId('page-tree-mobile-drawer')).toBeVisible();
  }
}

async function moveButton(page: Page, pageId: string, dir: 'up' | 'down') {
  const mobileToggle = page.getByTestId('page-tree-mobile-toggle');
  const scope = (await mobileToggle.isVisible().catch(() => false))
    ? page.getByTestId('page-tree-mobile-drawer')
    : page.locator('nav[aria-label="Pages"]');
  return scope.getByTestId(`page-tree-move-${dir}-${pageId}`);
}

test.describe('Pages QA extra: hierarchy, reorder correctness, title validation, graph pan/zoom', () => {
  test('root + child page hierarchy renders nested in the tree', async ({ page, request }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'pages-hier',
      projectName: 'Pages Hierarchy QA',
    });
    await page.goto(`/projects/${project.id}/pages`);

    await page.getByTestId('page-create-first').click();
    await page.getByTestId('create-page-title-input').pressSequentially('Parent Page', { delay: 15 });
    await page.getByTestId('create-page-submit').click();
    await expect(page.getByTestId('page-title')).toHaveText('Parent Page');

    await ensureTreeOpen(page);
    const mobileToggle = page.getByTestId('page-tree-mobile-toggle');
    const scope = (await mobileToggle.isVisible().catch(() => false))
      ? page.getByTestId('page-tree-mobile-drawer')
      : page.locator('nav[aria-label="Pages"]');

    const parentRow = scope.locator('[data-testid^="page-tree-item-"]').first();
    const parentId = (await parentRow.getAttribute('data-testid'))!.replace('page-tree-item-', '');
    await scope.getByTestId(`page-tree-add-child-${parentId}`).click();

    await expect(page.getByTestId('create-page-title-input')).toBeVisible();
    // "New page under ..." context shown for a child create.
    await expect(page.locator('text=New page under')).toBeVisible();
    await page.getByTestId('create-page-title-input').pressSequentially('Child Page', { delay: 15 });
    await page.getByTestId('create-page-submit').click();
    await expect(page.getByTestId('page-title')).toHaveText('Child Page');
    const childId = page.url().split('/pages/')[1];

    await ensureTreeOpen(page);
    const scope2 = (await mobileToggle.isVisible().catch(() => false))
      ? page.getByTestId('page-tree-mobile-drawer')
      : page.locator('nav[aria-label="Pages"]');

    // Child is auto-expanded under its parent (active page path auto-expands).
    const childRow = scope2.getByTestId(`page-tree-item-${childId}`);
    await expect(childRow).toBeVisible();
    await expect(childRow).toHaveAttribute('aria-level', '2');
    const parentRow2 = scope2.getByTestId(`page-tree-item-${parentId}`);
    await expect(parentRow2).toHaveAttribute('aria-level', '1');
    await expect(parentRow2).toHaveAttribute('aria-expanded', 'true');
  });

  test('reorder: move up/down lands on the exact correct position, no overshoot, no no-op, persists on reload', async ({
    page,
    request,
  }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'pages-reorder',
      projectName: 'Pages Reorder QA',
      openBoard: false,
    });

    // Seed 3 root pages via the API in a known order: Alpha, Beta, Gamma.
    async function apiCreatePage(title: string) {
      const res = await request.post(`http://localhost:4000/api/projects/${project.id}/pages`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title },
      });
      expect(res.ok(), `create page ${title} failed: ${res.status()}`).toBeTruthy();
      return ((await res.json()) as { id: string }).id;
    }
    const alphaId = await apiCreatePage('Alpha');
    const betaId = await apiCreatePage('Beta');
    const gammaId = await apiCreatePage('Gamma');

    // Record the browser's own writes so the reload at the end can't abort a
    // move that hasn't reached the server yet (see `trackApiWrites`).
    const writes = trackApiWrites(page);
    const isMove = (w: { method: string; path: string }) =>
      w.method === 'POST' && /^\/api\/pages\/[^/]+\/move$/.test(w.path);

    // Exactly WHAT each move asked for, so a failure names the request that
    // produced the wrong order instead of leaving the array diff to be
    // reverse-engineered from a CI tail.
    const moveRequests: unknown[] = [];
    page.on('request', (req) => {
      if (!isMove({ method: req.method(), path: new URL(req.url()).pathname })) return;
      moveRequests.push({
        id: new URL(req.url()).pathname.split('/')[3],
        body: req.postDataJSON() as unknown,
      });
    });

    await page.goto(`/projects/${project.id}/pages`);
    await expect(page.getByTestId('page-title')).toBeVisible();
    await ensureTreeOpen(page);

    await expect.poll(() => treeItemTitles(page)).toEqual(['Alpha', 'Beta', 'Gamma']);

    // Move Gamma up once: Alpha, Gamma, Beta.
    await (await moveButton(page, gammaId, 'up')).click();
    await expect.poll(() => treeItemTitles(page)).toEqual(['Alpha', 'Gamma', 'Beta']);

    // Move Gamma up again: Gamma, Alpha, Beta.
    await (await moveButton(page, gammaId, 'up')).click();
    await expect.poll(() => treeItemTitles(page)).toEqual(['Gamma', 'Alpha', 'Beta']);

    // Gamma is now first — its "Move up" affordance must be disabled (no overshoot past top).
    await expect(await moveButton(page, gammaId, 'up')).toBeDisabled();

    // Move Beta up twice from the bottom: Gamma, Beta, Alpha then Beta, Gamma, Alpha.
    await (await moveButton(page, betaId, 'up')).click();
    await expect.poll(() => treeItemTitles(page)).toEqual(['Gamma', 'Beta', 'Alpha']);
    await (await moveButton(page, betaId, 'up')).click();
    await expect.poll(() => treeItemTitles(page)).toEqual(['Beta', 'Gamma', 'Alpha']);
    await expect(await moveButton(page, betaId, 'up')).toBeDisabled();

    // Move Alpha (currently last) down should be disabled (already last).
    await expect(await moveButton(page, alphaId, 'down')).toBeDisabled();
    // Move Alpha up once: Beta, Alpha, Gamma.
    await (await moveButton(page, alphaId, 'up')).click();
    await expect.poll(() => treeItemTitles(page)).toEqual(['Beta', 'Alpha', 'Gamma']);
    // Move it back down: Beta, Gamma, Alpha.
    await (await moveButton(page, alphaId, 'down')).click();
    await expect.poll(() => treeItemTitles(page)).toEqual(['Beta', 'Gamma', 'Alpha']);

    // Every assertion above polls the OPTIMISTIC cache, which updates the
    // moment the click is handled — well before the matching POST /move has
    // been answered (they're queued one behind another by `movePageChain` in
    // api/pages.ts). Reloading straight after therefore aborts the tail of
    // that queue and then blames the app for "losing" the moves; on CI's
    // slower I/O that is exactly what happened, and the post-reload order
    // came back as the pristine seed order.
    //
    // So wait for the server to answer all SIX moves before reloading. This
    // strengthens the test rather than weakening it: the reload + exact-order
    // check below still prove server persistence, and a click the UI swallows
    // now fails loudly as "acked=5/6" instead of an opaque ordering diff.
    await writes.settle({ match: isMove, atLeast: 6 });

    // Server truth FIRST, read straight from the API rather than through the
    // app. This splits the two things the single post-reload check used to
    // conflate: "did the server persist the order" and "does a fresh client
    // render it". When this suite went red they were indistinguishable — the
    // reload came back with the pristine seed order and nothing said whether
    // the ranks or the client was at fault.
    async function serverOrder(): Promise<string[]> {
      const res = await request.get(
        `http://localhost:4000/api/projects/${project.id}/pages/tree`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(res.ok(), `tree read failed: ${res.status()}`).toBeTruthy();
      return ((await res.json()) as { title: string }[]).map((n) => n.title);
    }
    await expect
      .poll(serverOrder, {
        message:
          `server-persisted page order after 6 acked moves. ids: alpha=${alphaId} ` +
          `beta=${betaId} gamma=${gammaId}. requests: ${JSON.stringify(moveRequests)}. ` +
          `responses: ${JSON.stringify(writes.completed.filter(isMove))}`,
      })
      .toEqual(['Beta', 'Gamma', 'Alpha']);

    // Reload — a fresh client must render exactly that order (proves this
    // isn't just an optimistic client-side lie).
    await page.reload();
    await ensureTreeOpen(page);
    await expect.poll(() => treeItemTitles(page)).toEqual(['Beta', 'Gamma', 'Alpha']);
  });

  test('create-page title validation blocks reserved [ ] | characters inline', async ({ page, request }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'pages-title-validate',
      projectName: 'Pages Title Validation QA',
    });
    await page.goto(`/projects/${project.id}/pages`);
    await page.getByTestId('page-create-first').click();

    const input = page.getByTestId('create-page-title-input');
    const submit = page.getByTestId('create-page-submit');

    // Baseline: a clean title enables submit.
    await input.pressSequentially('Clean Title', { delay: 15 });
    await expect(submit).toBeEnabled();

    // Appending a reserved bracket disables submit + shows the inline error.
    await input.pressSequentially(' [oops]', { delay: 15 });
    await expect(submit).toBeDisabled();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.locator('text=Titles can’t contain [ ] or | — they’re reserved for [[wiki-links]].'),
    ).toBeVisible();

    // Clearing back to a clean title re-enables submit.
    await input.fill('');
    await input.pressSequentially('Runbook', { delay: 15 });
    await expect(submit).toBeEnabled();
    await expect(input).toHaveAttribute('aria-invalid', 'false');

    // A pipe character alone also blocks submit.
    await input.fill('');
    await input.pressSequentially('Bad | Title', { delay: 15 });
    await expect(submit).toBeDisabled();

    // Submitting is truly blocked, not just visually — pressing the submit
    // button while invalid must not create a page (no navigation away).
    await submit.click({ force: true }).catch(() => {});
    await expect(page.getByTestId('create-page-title-input')).toBeVisible();
  });

  test('graph view: zoom controls change scale, pan drag moves the camera, renders on mobile', async ({ page, request }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'pages-graph-zoom',
      projectName: 'Pages Graph Zoom QA',
      openBoard: false,
    });

    async function apiCreatePage(title: string, content?: string) {
      const res = await request.post(`http://localhost:4000/api/projects/${project.id}/pages`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title, content },
      });
      expect(res.ok()).toBeTruthy();
      return ((await res.json()) as { id: string }).id;
    }
    const aId = await apiCreatePage('Architecture', 'See [[Onboarding]] and [[Runbook]].');
    await apiCreatePage('Onboarding', 'Back to [[Architecture]].');
    await apiCreatePage('Runbook', 'Back to [[Architecture]].');

    await page.goto(`/projects/${project.id}/pages/graph`);
    const graph = page.getByTestId('page-graph-view');
    await expect(graph).toBeVisible();
    await expect(page.getByTestId(`page-graph-node-${aId}`)).toBeVisible();

    /*
     * The graph fits itself to its content on open, so the resting zoom is
     * whatever framing this viewport needs — 100% on desktop, but ~89% at
     * 393px, where three 108px-wide node boxes don't quite fit side by side.
     * Asserting a hard "100%" here tested the old behaviour (snap to 100%
     * regardless of whether you could see anything); what matters now is that
     * the button RESTORES the fitted view, whatever it is. Capture it.
     */
    const zoomLabel = page.getByTestId('page-graph-zoom-reset');
    // Wait for the layout to SETTLE before reading the baseline. The view
    // fits itself automatically when the force simulation finishes, so a
    // value read (or a zoom applied) while it is still running is overwritten
    // by that settle-fit a moment later. Clicking Fit first is not enough on
    // its own — the automatic fit can still land after it.
    await expect(page.locator('[data-testid^="page-graph-node-"]')).toHaveCount(3, {
      timeout: 15_000,
    });
    await page.waitForTimeout(1500);
    await page.getByTestId('page-graph-zoom-reset').click();
    const fitted = (await zoomLabel.textContent())?.trim() ?? '';
    expect(fitted).toMatch(/^\d+%$/);
    // Fit never magnifies: a graph this small must sit at or below 100%.
    expect(Number.parseInt(fitted, 10)).toBeLessThanOrEqual(100);

    await page.getByTestId('page-graph-zoom-in').click();
    await expect(zoomLabel).not.toHaveText(fitted);
    const zoomedIn = (await zoomLabel.textContent())?.trim() ?? '';
    await page.getByTestId('page-graph-zoom-in').click();
    await expect(zoomLabel).not.toHaveText(zoomedIn);
    await page.getByTestId('page-graph-zoom-reset').click();
    await expect(zoomLabel).toHaveText(fitted);

    // Pan: drag on the canvas background (not on a node button) should move
    // the group's transform. Read the <g> transform before/after. Scoped to
    // the canvas (`page-graph-canvas`) specifically — the top bar's search
    // field also has its own small `<svg>` icon.
    const canvas = page.getByTestId('page-graph-canvas');
    const svg = canvas.locator('svg');
    const box = (await svg.boundingBox())!;
    const groupBefore = await canvas.locator('svg > g').getAttribute('transform');
    await page.mouse.move(box.x + box.width / 2, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + 60, { steps: 5 });
    await page.mouse.up();
    const groupAfter = await canvas.locator('svg > g').getAttribute('transform');
    expect(groupAfter).not.toEqual(groupBefore);
  });
});

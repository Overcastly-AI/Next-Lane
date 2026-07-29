import { test, expect, type Page } from '@playwright/test';
import { setupIsolatedProject } from './helpers';

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

    // Let the last move's POST actually reach the server before reloading.
    // Every assertion above polls the OPTIMISTIC cache, which updates before
    // the write completes, so reloading straight after could abort our own
    // in-flight request and then blame the app for "losing" the move. This
    // waits for our requests, it does not weaken anything: the reload and the
    // exact-order check below still prove the server persisted the order.
    await page.waitForLoadState('networkidle');

    // Reload — the server-persisted rank must match the last client state exactly
    // (proves this isn't just an optimistic client-side lie).
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

    const zoomLabel = page.getByTestId('page-graph-zoom-reset');
    await expect(zoomLabel).toHaveText('100%');
    await page.getByTestId('page-graph-zoom-in').click();
    await expect(zoomLabel).toHaveText('125%');
    await page.getByTestId('page-graph-zoom-in').click();
    await expect(zoomLabel).not.toHaveText('125%');
    await page.getByTestId('page-graph-zoom-reset').click();
    await expect(zoomLabel).toHaveText('100%');

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

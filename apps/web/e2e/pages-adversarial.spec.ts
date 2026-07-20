import { test, expect } from '@playwright/test';
import { setupIsolatedProject } from './helpers';

/**
 * pages-adversarial.spec.ts
 *
 * Adversarial / real-human-behavior QA for the Pages knowledge base:
 * clicking an autocomplete option (not just typing the full title), no
 * focus loss typing a [[wiki-link]] trigger in the MIDDLE of existing text,
 * double-clicking Save, an overlong title's mobile layout, and the
 * "delete a page with children" guard.
 */

test.describe('Pages adversarial QA', () => {
  test('picking a wiki-link autocomplete option by click (mid-sentence, not append-only) inserts correctly with no focus loss', async ({
    page,
    request,
  }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'pages-adv-click',
      projectName: 'Pages Adversarial Click QA',
      openBoard: false,
    });
    async function apiCreatePage(title: string) {
      const res = await request.post(`http://localhost:4000/api/projects/${project.id}/pages`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title },
      });
      expect(res.ok()).toBeTruthy();
      return ((await res.json()) as { id: string }).id;
    }
    const targetId = await apiCreatePage('Architecture');
    await page.goto(`/projects/${project.id}/pages`);
    // The tree isn't empty (Architecture already exists via API seed), so the
    // EmptyState "page-create-first" button never renders — the real
    // affordance here is the sidebar's "New page" root button.
    await expect(page.getByTestId('page-title')).toHaveText('Architecture');
    const mobileToggleForCreate = page.getByTestId('page-tree-mobile-toggle');
    if (await mobileToggleForCreate.isVisible().catch(() => false)) {
      await mobileToggleForCreate.click();
      await page.getByTestId('page-tree-mobile-drawer').getByTestId('page-tree-new-root').click();
    } else {
      await page.locator('nav[aria-label="Pages"]').getByTestId('page-tree-new-root').click();
    }
    await page.getByTestId('create-page-title-input').pressSequentially('Hub', { delay: 15 });
    await page.getByTestId('create-page-submit').click();
    await expect(page.getByTestId('page-title')).toHaveText('Hub');

    await page.getByTestId('page-edit').click();
    const editor = page.getByTestId('page-content-editor');
    await editor.click();

    // Type a full sentence, then move the caret BACK into the middle and
    // insert a [[ trigger there — verifies caret-relative trigger detection,
    // not just "trigger only works when typed at the very end".
    await editor.pressSequentially('See the doc for more info.', { delay: 12 });
    // Move caret to just after "the " (position 8).
    for (let i = 0; i < 'doc for more info.'.length; i++) {
      await page.keyboard.press('ArrowLeft');
    }
    await editor.pressSequentially('[[Arch', { delay: 15 });
    await expect(page.getByTestId('wikilink-picker')).toBeVisible();
    const option = page.getByTestId('wikilink-option-0');
    await expect(option).toContainText('Architecture');

    // Click (mousedown) the option rather than typing the rest — exercises
    // the click-to-insert path, not just Enter/Tab.
    await option.click();
    await expect(page.getByTestId('wikilink-picker')).toHaveCount(0);

    // No focus loss: the textarea should still be focused and further
    // keystrokes should land in it, appending after the inserted link.
    await expect(editor).toBeFocused();
    await editor.pressSequentially(' HERE', { delay: 12 });
    await expect(editor).toHaveValue('See the [[Architecture]] HEREdoc for more info.');

    await page.getByTestId('page-save').click();
    await expect(page.getByTestId('page-save')).toHaveCount(0);

    const resolvedLink = page.locator(`.nl-page-content a[href="#page:${targetId}"]`);
    await expect(resolvedLink).toBeVisible();
    await expect(resolvedLink).toHaveText('Architecture');
  });

  // DEFECT (filed to dev team): a real-human double-click (or fast double-tap
  // on mobile) on Save fires TWO PATCH /pages/:id requests ~1ms apart, because
  // PageEditor.handleSave has no client-side re-entrancy guard and the
  // Save button's `disabled={!dirty || saving}` doesn't flip fast enough to
  // block the second synthetic click in the same event-loop tick (confirmed
  // via request-count instrumentation: 2 PATCH calls from one dblclick).
  // Each PATCH creates a new PageVersion server-side (append-only, so no data
  // loss), but it pollutes version history with an identical duplicate
  // "phantom" version the user never intended, off-by-one from what History
  // shows them ("2 saves" reads as 3 versions). See PageEditor.tsx
  // `handleSave` (apps/web/src/components/pages/PageEditor.tsx) — needs an
  // in-flight guard (e.g. `if (saving) return;` at the top of handleSave, or
  // ignore-if-pending in the mutation call) in addition to the disabled prop.
  test('double-clicking Save does not double-submit or corrupt version history', async ({ page, request }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'pages-adv-dblsave',
      projectName: 'Pages Adversarial DblSave QA',
    });
    await page.goto(`/projects/${project.id}/pages`);
    await page.getByTestId('page-create-first').click();
    await page.getByTestId('create-page-title-input').pressSequentially('Runbook', { delay: 15 });
    await page.getByTestId('create-page-submit').click();
    await expect(page.getByTestId('page-title')).toHaveText('Runbook');

    await page.getByTestId('page-edit').click();
    const editor = page.getByTestId('page-content-editor');
    await editor.click();
    await editor.pressSequentially('Step one. Step two.', { delay: 10 });

    let patchCount = 0;
    page.on('request', (req) => {
      if (req.method() === 'PATCH' && /\/pages\//.test(req.url())) patchCount++;
    });

    const saveBtn = page.getByTestId('page-save');
    // Fire two rapid clicks (dblclick) — the button disables while saving
    // (disabled={!dirty || saving}) so the second click should be a no-op,
    // not a second mutation.
    await saveBtn.dblclick();
    await expect(page.getByTestId('page-save')).toHaveCount(0, { timeout: 10_000 });
    await page.waitForTimeout(500);

    // KNOWN DEFECT: this currently fires 2 PATCH requests (see comment above
    // the test). Asserting the CORRECT behavior here on purpose so this test
    // stays red until PageEditor.handleSave gets a re-entrancy guard.
    expect(patchCount, 'double-click on Save must send exactly one PATCH, not one per click').toBe(1);

    await page.getByTestId('page-open-version-history').click();
    await expect(page.getByTestId('page-version-history-drawer')).toBeVisible();
    // Exactly 2 versions: v1 (create) + v2 (the one save) — NOT 3.
    await expect(page.getByTestId('page-version-row-1')).toBeVisible();
    await expect(page.getByTestId('page-version-row-2')).toBeVisible();
    await expect(page.getByTestId('page-version-row-3')).toHaveCount(0);
  });

  // Companion defect: the SAME missing re-entrancy guard affects
  // CreatePageModal's submit button (see apps/web/src/components/pages/
  // CreatePageModal.tsx `submit()`, called from a `Button` with no in-flight
  // check) — a double-click/double-tap on "Create" creates TWO duplicate
  // pages with the identical title, cluttering the tree.
  test('double-clicking Create does not create duplicate pages', async ({ page, request }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'pages-adv-dblcreate',
      projectName: 'Pages Adversarial DblCreate QA',
    });
    await page.goto(`/projects/${project.id}/pages`);
    await page.getByTestId('page-create-first').click();
    await page.getByTestId('create-page-title-input').pressSequentially('DoubleClickMe', { delay: 15 });

    let postCount = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/pages$/.test(req.url())) postCount++;
    });

    await page.getByTestId('create-page-submit').dblclick();
    await expect(page.getByTestId('page-title')).toHaveText('DoubleClickMe', { timeout: 10_000 });
    await page.waitForTimeout(500);

    // KNOWN DEFECT: this currently fires 2 POST requests and creates 2
    // duplicate "DoubleClickMe" pages. Asserting the CORRECT behavior here on
    // purpose so this test stays red until CreatePageModal gets a guard.
    expect(postCount, 'double-click on Create must send exactly one POST, not one per click').toBe(1);

    const mobileToggle = page.getByTestId('page-tree-mobile-toggle');
    if (await mobileToggle.isVisible().catch(() => false)) await mobileToggle.click();
    const scope = (await mobileToggle.isVisible().catch(() => false))
      ? page.getByTestId('page-tree-mobile-drawer')
      : page.locator('nav[aria-label="Pages"]');
    const dupes = scope.locator('[data-testid^="page-tree-item-"]', { hasText: 'DoubleClickMe' });
    await expect(dupes).toHaveCount(1);
  });

  test('an overlong page title does not overflow the mobile header or tree row', async ({ page, request }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'pages-adv-longtitle',
      projectName: 'Pages Adversarial LongTitle QA',
    });
    await page.goto(`/projects/${project.id}/pages`);
    await page.getByTestId('page-create-first').click();
    const longTitle =
      'This Is An Extremely Long Page Title That A Real Human Would Actually Type When Documenting A Gnarly Incident Runbook Step By Step';
    await page.getByTestId('create-page-title-input').pressSequentially(longTitle, { delay: 5 });
    await page.getByTestId('create-page-submit').click();
    await expect(page.getByTestId('page-title')).toHaveText(longTitle);

    const viewport = page.viewportSize();
    const titleBox = await page.getByTestId('page-title').boundingBox();
    expect(titleBox).not.toBeNull();
    expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(viewport!.width + 1);

    const mobileToggle = page.getByTestId('page-tree-mobile-toggle');
    if (await mobileToggle.isVisible().catch(() => false)) {
      await mobileToggle.click();
      const drawer = page.getByTestId('page-tree-mobile-drawer');
      await expect(drawer).toBeVisible();
      const row = drawer.locator('[data-testid^="page-tree-item-"]').first();
      const rowBox = await row.boundingBox();
      const drawerBox = await drawer.boundingBox();
      expect(rowBox).not.toBeNull();
      expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(drawerBox!.x + drawerBox!.width + 1);
    }
  });

  test('deleting a page with children is blocked (confirm disabled) until children are gone', async ({
    page,
    request,
  }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'pages-adv-deletechildren',
      projectName: 'Pages Adversarial DeleteChildren QA',
      openBoard: false,
    });
    async function apiCreatePage(title: string, parentId?: string) {
      const res = await request.post(`http://localhost:4000/api/projects/${project.id}/pages`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title, parentId },
      });
      expect(res.ok()).toBeTruthy();
      return ((await res.json()) as { id: string }).id;
    }
    const parentId = await apiCreatePage('Parent');
    await apiCreatePage('Child', parentId);

    await page.goto(`/projects/${project.id}/pages`);
    await expect(page.getByTestId('page-title')).toBeVisible();

    const mobileToggle = page.getByTestId('page-tree-mobile-toggle');
    if (await mobileToggle.isVisible().catch(() => false)) await mobileToggle.click();
    const scope = (await mobileToggle.isVisible().catch(() => false))
      ? page.getByTestId('page-tree-mobile-drawer')
      : page.locator('nav[aria-label="Pages"]');

    await scope.getByTestId(`page-tree-delete-${parentId}`).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete page' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('1 child page');
    const confirmBtn = dialog.getByRole('button', { name: 'Delete', exact: true });
    await expect(confirmBtn).toBeDisabled();
  });

  test('deleting a page other pages link to warns "N pages link here" (informed consent, not a block)', async ({
    page,
    request,
  }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'pages-adv-orphanwarn',
      projectName: 'Pages Adversarial OrphanWarn QA',
      openBoard: false,
    });
    const headers = { Authorization: `Bearer ${token}` };
    async function apiCreatePage(title: string, content?: string) {
      const res = await request.post(`http://localhost:4000/api/projects/${project.id}/pages`, {
        headers,
        data: { title, content },
      });
      expect(res.ok()).toBeTruthy();
      return ((await res.json()) as { id: string }).id;
    }
    const hubId = await apiCreatePage('Hub Doc');
    await apiCreatePage('Linker One', 'see [[Hub Doc]]');
    await apiCreatePage('Linker Two', 'also [[Hub Doc]]');

    await page.goto(`/projects/${project.id}/pages`);
    await expect(page.getByTestId('page-title')).toBeVisible();

    const mobileToggle = page.getByTestId('page-tree-mobile-toggle');
    if (await mobileToggle.isVisible().catch(() => false)) await mobileToggle.click();
    const scope = (await mobileToggle.isVisible().catch(() => false))
      ? page.getByTestId('page-tree-mobile-drawer')
      : page.locator('nav[aria-label="Pages"]');

    await scope.getByTestId(`page-tree-delete-${hubId}`).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete page' });
    await expect(dialog).toBeVisible();
    // The warning surfaces the inbound-link count but the delete stays
    // ENABLED — informed consent (Obsidian-style), never a block.
    const warning = dialog.getByTestId('page-delete-backlink-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('2 pages link here');
    const confirmBtn = dialog.getByRole('button', { name: 'Delete', exact: true });
    await expect(confirmBtn).toBeEnabled();

    // Confirming actually deletes the page from the tree.
    await confirmBtn.click();
    await expect(scope.getByTestId(`page-tree-item-${hubId}`)).toHaveCount(0);
  });

  // FIXED (observatory redesign, 2026-07-20): graph node boxes used to be
  // able to render PARTIALLY OUTSIDE the canvas and get clipped by the
  // container's `overflow-hidden`, truncating the visible label — the force
  // layout's own margin math wasn't guaranteed to exceed half the rendered
  // node box's width. `KnowledgeGraphView` now clamps every node's rendered
  // CENTER a second time at render time (`clampCenter`, independent of the
  // simulation's own margins) so a box can never be pushed past the canvas
  // edge, regardless of simulation internals — this test now asserts the
  // real (fixed) behavior instead of tracking the old defect.
  test('graph view: node boxes must not render clipped outside the canvas on a realistic multi-page graph', async ({
    page,
    request,
  }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'pages-adv-graph-clip',
      projectName: 'Pages Adversarial Graph Clip QA',
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
    const ids = {
      a: await apiCreatePage('Architecture', 'See [[Onboarding]] and [[Runbook]].'),
      b: await apiCreatePage('Onboarding', 'Back to [[Architecture]].'),
      c: await apiCreatePage('Runbook', 'Back to [[Architecture]].'),
      d: await apiCreatePage('Deployment Guide', 'Related: [[Architecture]], [[Runbook]].'),
      e: await apiCreatePage('On-Call', 'See the [[Runbook]].'),
    };

    await page.goto(`/projects/${project.id}/pages/graph`);
    const graph = page.getByTestId('page-graph-view');
    await expect(graph).toBeVisible();
    await page.waitForTimeout(600);

    const containerBox = (await graph.getByTestId('page-graph-canvas').boundingBox())!;
    const overflows: string[] = [];
    for (const [title, id] of Object.entries(ids)) {
      const box = await page.getByTestId(`page-graph-node-${id}`).boundingBox();
      if (!box) continue;
      const leftOverflow = containerBox.x - box.x;
      const rightOverflow = box.x + box.width - (containerBox.x + containerBox.width);
      if (leftOverflow > 1) overflows.push(`${title}: ${Math.round(leftOverflow)}px past the left edge`);
      if (rightOverflow > 1) overflows.push(`${title}: ${Math.round(rightOverflow)}px past the right edge`);
    }
    expect(overflows, 'no graph node should render clipped past the canvas edge').toEqual([]);
  });
});

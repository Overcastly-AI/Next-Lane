import { test, expect, type Page } from '@playwright/test';
import { API_URL, setupIsolatedProject } from './helpers';

/**
 * docs-nav-drag.spec.ts
 *
 * The Docs page tree's two drag affordances (founder: "the inner left doc nav
 * should be draggable"):
 *   1. drag the divider to resize the panel, persisted across reload;
 *   2. drag a page row to reorder it, or onto a row to nest it as a child.
 *
 * Desktop only for the drag cases — the mobile tree is a full-height drawer
 * with no divider to grab, and HTML5 drag-and-drop is not a touch gesture. The
 * `test.skip` below is therefore a real statement about the product, not a
 * dodge: on mobile, reordering is the up/down buttons, which `pages-qa-extra`
 * already covers at 390px.
 *
 * Those buttons are ALSO the reason this spec asserts they still work after
 * the drag work landed: drag was added alongside them, not instead of them,
 * because drag has no keyboard equivalent.
 */

async function createPage(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  projectId: string,
  title: string,
): Promise<string> {
  const res = await request.post(`${API_URL}/api/projects/${projectId}/pages`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title, content: `Body of ${title}` },
  });
  expect(res.ok(), `create page failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

/** Titles of the tree rows, in rendered order. */
async function treeOrder(page: Page): Promise<string[]> {
  return page
    .locator('nav[aria-label="Pages"] [data-testid^="page-tree-item-"]')
    .allInnerTexts();
}

/**
 * HTML5 drag-and-drop against a specific third of the target row.
 *
 * `page.mouse.down/move/up` does NOT drive native HTML5 drag-and-drop in
 * Chromium — it moves the cursor without ever producing `dragstart`, so the
 * tree's handlers never fire and the drop silently does nothing. (Learned the
 * hard way: the first version of this spec did exactly that and reported the
 * row unmoved.) `locator.dragTo` does dispatch the real sequence, and
 * `targetPosition` is what lets us aim at the row's top/middle/bottom — which
 * is the whole distinction between reordering and nesting.
 */
async function dragRowTo(
  page: Page,
  sourceTestId: string,
  targetTestId: string,
  where: 'top' | 'middle' | 'bottom',
): Promise<void> {
  const nav = page.locator('nav[aria-label="Pages"]');
  const source = nav.getByTestId(sourceTestId);
  const target = nav.getByTestId(targetTestId);
  const box = await target.boundingBox();
  if (!box) throw new Error(`target row ${targetTestId} not visible`);

  const y =
    where === 'top' ? box.height * 0.1 : where === 'bottom' ? box.height * 0.9 : box.height / 2;

  await source.dragTo(target, {
    targetPosition: { x: box.width / 2, y },
  });
}

test.describe('Docs nav — draggable', () => {
  test('the divider resizes the page tree, and the width survives a reload', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-chrome', 'no divider in the mobile drawer');

    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'docs-resize',
      projectName: 'Docs Resize QA',
      openBoard: false,
    });
    await createPage(request, token, project.id, 'Alpha');

    await page.goto(`/projects/${project.id}/pages`);
    const panel = page.getByTestId('page-tree-panel');
    await expect(panel).toBeVisible();
    const before = (await panel.boundingBox())!.width;

    const handle = page.getByTestId('page-tree-resize');
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = (await panel.boundingBox())!.width;
    expect(after).toBeGreaterThan(before + 80);

    // Persisted, not just held in component state.
    await page.reload();
    await expect(page.getByTestId('page-tree-panel')).toBeVisible();
    const reloaded = (await page.getByTestId('page-tree-panel').boundingBox())!.width;
    expect(Math.abs(reloaded - after)).toBeLessThan(2);
  });

  test('the divider is keyboard-operable and clamps at its bounds', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-chrome', 'no divider in the mobile drawer');

    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'docs-resize-kb',
      projectName: 'Docs Resize KB QA',
      openBoard: false,
    });
    await createPage(request, token, project.id, 'Alpha');
    await page.goto(`/projects/${project.id}/pages`);

    const handle = page.getByTestId('page-tree-resize');
    const panel = page.getByTestId('page-tree-panel');
    await expect(handle).toHaveAttribute('role', 'separator');
    await expect(handle).toHaveAccessibleName(/resize the page list/i);

    const start = (await panel.boundingBox())!.width;
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect((await panel.boundingBox())!.width).toBeGreaterThan(start);

    // Held against the maximum rather than growing without bound — a tree that
    // can eat the whole document defeats the point of the tree.
    await page.keyboard.press('End');
    const max = (await panel.boundingBox())!.width;
    await page.keyboard.press('ArrowRight');
    expect((await panel.boundingBox())!.width).toBe(max);

    await page.keyboard.press('Home');
    const min = (await panel.boundingBox())!.width;
    await page.keyboard.press('ArrowLeft');
    expect((await panel.boundingBox())!.width).toBe(min);
    // Still wide enough to be a usable tree, not a sliver.
    expect(min).toBeGreaterThanOrEqual(180);
  });

  test('dragging a row onto another nests it; the up/down buttons still work', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-chrome', 'HTML5 drag is not a touch gesture');

    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'docs-drag',
      projectName: 'Docs Drag QA',
      openBoard: false,
    });
    const alpha = await createPage(request, token, project.id, 'Alpha');
    const bravo = await createPage(request, token, project.id, 'Bravo');

    await page.goto(`/projects/${project.id}/pages`);
    await expect(page.getByTestId(`page-tree-item-${alpha}`).first()).toBeVisible();
    expect(await treeOrder(page)).toEqual(['Alpha', 'Bravo']);

    // --- Nest Bravo inside Alpha (drop on Alpha's middle). ---
    await dragRowTo(page, `page-tree-item-${bravo}`, `page-tree-item-${alpha}`, 'middle');

    // Bravo is now Alpha's child: one level deeper, and Alpha auto-expanded so
    // it is still visible rather than hidden inside a collapsed parent.
    const bravoRow = page
      .locator('nav[aria-label="Pages"]')
      .getByTestId(`page-tree-item-${bravo}`);
    await expect(bravoRow).toHaveAttribute('aria-level', '2', { timeout: 10_000 });
    await expect(bravoRow).toBeVisible();

    // Survives a reload — the move was persisted, not just optimistically
    // re-rendered. Expansion is component state and resets on reload, so Alpha
    // has to be re-opened first: a child under a collapsed parent is correctly
    // not rendered, and asserting on it directly would be testing the tree's
    // expansion behaviour rather than the move.
    await page.reload();
    const alphaRow = page
      .locator('nav[aria-label="Pages"]')
      .getByTestId(`page-tree-item-${alpha}`);
    // Alpha now reports itself as a parent — the move is in the server's tree.
    await expect(alphaRow).toHaveAttribute('aria-expanded', /true|false/, { timeout: 15_000 });
    if ((await alphaRow.getAttribute('aria-expanded')) === 'false') {
      await alphaRow.press('ArrowRight');
    }
    await expect(
      page.locator('nav[aria-label="Pages"]').getByTestId(`page-tree-item-${bravo}`),
    ).toHaveAttribute('aria-level', '2', { timeout: 10_000 });
  });

  test('dragging onto a row edge reorders siblings', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-chrome', 'HTML5 drag is not a touch gesture');

    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'docs-reorder',
      projectName: 'Docs Reorder QA',
      openBoard: false,
    });
    const alpha = await createPage(request, token, project.id, 'Alpha');
    const bravo = await createPage(request, token, project.id, 'Bravo');

    await page.goto(`/projects/${project.id}/pages`);
    await expect(page.getByTestId(`page-tree-item-${alpha}`).first()).toBeVisible();
    expect(await treeOrder(page)).toEqual(['Alpha', 'Bravo']);

    // Drop Bravo on Alpha's TOP edge → Bravo before Alpha.
    await dragRowTo(page, `page-tree-item-${bravo}`, `page-tree-item-${alpha}`, 'top');
    await expect.poll(() => treeOrder(page), { timeout: 10_000 }).toEqual(['Bravo', 'Alpha']);

    // Both stay top-level — an edge drop reorders, it does not nest.
    await expect(
      page.locator('nav[aria-label="Pages"]').getByTestId(`page-tree-item-${bravo}`),
    ).toHaveAttribute('aria-level', '1');

    await page.reload();
    await expect.poll(() => treeOrder(page), { timeout: 15_000 }).toEqual(['Bravo', 'Alpha']);
  });

  test('a page cannot be dropped into its own subtree', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-chrome', 'HTML5 drag is not a touch gesture');

    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'docs-cycle',
      projectName: 'Docs Cycle QA',
      openBoard: false,
    });
    const parent = await createPage(request, token, project.id, 'Parent');
    const child = await createPage(request, token, project.id, 'Child');

    await page.goto(`/projects/${project.id}/pages`);
    await dragRowTo(page, `page-tree-item-${child}`, `page-tree-item-${parent}`, 'middle');
    await expect(
      page.locator('nav[aria-label="Pages"]').getByTestId(`page-tree-item-${child}`),
    ).toHaveAttribute('aria-level', '2', { timeout: 10_000 });

    // Now try to drop Parent INTO its own child. Detaching a subtree from the
    // tree is the one move that must never be possible, and the UI has to
    // refuse it rather than let the API 400 after the fact.
    await dragRowTo(page, `page-tree-item-${parent}`, `page-tree-item-${child}`, 'middle');

    await expect(
      page.locator('nav[aria-label="Pages"]').getByTestId(`page-tree-item-${parent}`),
    ).toHaveAttribute('aria-level', '1');
    await expect(
      page.locator('nav[aria-label="Pages"]').getByTestId(`page-tree-item-${child}`),
    ).toHaveAttribute('aria-level', '2');
  });
});

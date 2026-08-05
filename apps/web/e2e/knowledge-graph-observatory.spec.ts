import { test, expect } from '@playwright/test';
import { setupIsolatedProject } from './helpers';

/**
 * knowledge-graph-observatory.spec.ts
 *
 * End-to-end coverage for the full-page knowledge graph redesign (founder
 * directive 2026-07-20: "a distinct full-page feel, better than Obsidian" —
 * replacing the old 420–560px boxed panel). `pages.spec.ts`,
 * `workspace-docs.spec.ts`, and `pages-cross-project-links.spec.ts` already
 * cover the base render/edge/legend/routing paths through their existing
 * Document→Graph flows; this suite is scoped to what's NEW: the full-bleed
 * shell, search-to-fly, keyboard traversal, the minimap, and the
 * loading/empty/error states staying reachable via the view toggle.
 *
 * Runs on BOTH configured Playwright projects (chromium-desktop +
 * mobile-chrome, see playwright.config.ts). Each spec gets its own isolated
 * project — never the shared demo.
 */

const API_URL = process.env.PW_API_URL ?? 'http://localhost:4000';

function apiCreatePageFactory(request: import('@playwright/test').APIRequestContext, projectId: string, token: string) {
  return async function apiCreatePage(title: string, content?: string): Promise<string> {
    const res = await request.post(`${API_URL}/api/projects/${projectId}/pages`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title, content },
    });
    expect(res.ok(), `create page "${title}" failed: ${res.status()}`).toBeTruthy();
    return ((await res.json()) as { id: string }).id;
  };
}

test.describe('Knowledge graph observatory', () => {
  test('graph mode is a full-page, edge-to-edge surface — no boxed panel, no tree sidebar', async ({ page, request }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'graph-fullpage',
      projectName: 'Graph Fullpage QA',
      openBoard: false,
    });
    const apiCreatePage = apiCreatePageFactory(request, project.id, token);
    await apiCreatePage('Alpha', 'See [[Beta]].');
    await apiCreatePage('Beta', 'Back to [[Alpha]].');

    await page.goto(`/projects/${project.id}/pages/graph`);
    const graph = page.getByTestId('page-graph-view');
    await expect(graph).toBeVisible();

    // Fills essentially the ENTIRE content area the app hands the page (the
    // persistent app-level `AppSidebar`/header/project-nav chrome outside
    // that content area is out of scope here — "edge-to-edge" means no
    // boxed panel WITHIN the page, not eclipsing global app chrome).
    const contentBox = (await page.locator('main').boundingBox())!;
    const box = (await graph.boundingBox())!;
    expect(box.width).toBeGreaterThan(contentBox.width * 0.98);
    expect(box.height).toBeGreaterThan(contentBox.height * 0.9);

    // No tree sidebar/drawer chrome while in Graph mode — it's a distinct
    // full-bleed surface, not the Document view's boxed panel.
    await expect(page.locator('nav[aria-label="Pages"]')).toHaveCount(0);

    // The toggle still gets you back to Document (graph view unmounts).
    await page.getByTestId('pages-view-document').click();
    await expect(page.getByTestId('page-graph-view')).toHaveCount(0);
    await expect(page.getByTestId('page-title')).toBeVisible();
  });

  test('search-to-fly highlights the match and flies the camera to it, opening the side rail', async ({ page, request }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'graph-search',
      projectName: 'Graph Search QA',
      openBoard: false,
    });
    const apiCreatePage = apiCreatePageFactory(request, project.id, token);
    await apiCreatePage('Hub', 'See [[Leaf One]], [[Leaf Two]], and [[Leaf Three]].');
    const leaf1 = await apiCreatePage('Leaf One', 'Back to [[Hub]].');
    await apiCreatePage('Leaf Two', 'Back to [[Hub]].');
    await apiCreatePage('Leaf Three', 'Back to [[Hub]].');

    await page.goto(`/projects/${project.id}/pages/graph`);
    await expect(page.getByTestId('page-graph-view')).toBeVisible();
    await expect(page.getByTestId(`page-graph-node-${leaf1}`)).toBeVisible();
    // Let the settle animation/layout finish so the before/after transform
    // comparison below isn't racing the simulation's own position updates.
    await page.waitForTimeout(500);

    const group = page.locator('[data-testid="page-graph-view"] svg > g');
    const transformBefore = await group.getAttribute('transform');

    const search = page.getByTestId('page-graph-search-input');
    await search.pressSequentially('Leaf One', { delay: 15 });
    await expect(page.getByTestId('page-graph-search-results')).toBeVisible();
    const result = page.getByTestId(`page-graph-search-result-${leaf1}`);
    await expect(result).toBeVisible();
    await result.click();

    // Picking a result selects that node — the rail opens on it (same as a
    // direct click on the node) — and the camera actually moved.
    await expect(page.getByTestId('page-graph-rail')).toBeVisible();
    await expect(page.getByTestId('page-graph-rail-title')).toHaveText('Leaf One');
    const transformAfter = await group.getAttribute('transform');
    expect(transformAfter).not.toEqual(transformBefore);

    // The query clears after picking (ready for the next search).
    await expect(search).toHaveValue('');
  });

  test('controls and nodes are keyboard-reachable; Enter on a focused node opens it', async ({ page, request }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'graph-kbd',
      projectName: 'Graph Keyboard QA',
      openBoard: false,
    });
    const apiCreatePage = apiCreatePageFactory(request, project.id, token);
    await apiCreatePage('Keyboard Hub', 'See [[Keyboard Target]].');
    const targetId = await apiCreatePage('Keyboard Target', 'Back to [[Keyboard Hub]].');

    await page.goto(`/projects/${project.id}/pages/graph`);
    await expect(page.getByTestId('page-graph-view')).toBeVisible();
    await expect(page.getByTestId(`page-graph-node-${targetId}`)).toBeVisible();

    // Zoom controls: keyboard-focusable and operable without a mouse.
    await page.getByTestId('page-graph-zoom-in').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('page-graph-zoom-reset')).toHaveText('125%');
    await page.getByTestId('page-graph-zoom-reset').focus();
    await page.keyboard.press('Enter');
    /*
     * The reset button FITS the graph to its content — it does not snap to a
     * fixed 100%. For a graph this small the fitted scale is at or just below
     * 100% depending on how wide the canvas measures, and CI produced 97%.
     *
     * Hard-coding '100%' was testing the pre-2026-08-01 behaviour, where reset
     * restored 100% whether or not you could see anything. What this spec is
     * actually about is that the control is KEYBOARD-operable, so assert that:
     * Enter changed the zoom away from the zoomed-in value, and left it at a
     * scale that fits (fit never magnifies, so never above 100%).
     */
    const zoomAfterReset = page.getByTestId('page-graph-zoom-reset');
    await expect(zoomAfterReset).not.toHaveText('125%');
    const fitted = (await zoomAfterReset.textContent())?.trim() ?? '';
    expect(fitted).toMatch(/^\d+%$/);
    expect(Number.parseInt(fitted, 10)).toBeLessThanOrEqual(100);
    expect(Number.parseInt(fitted, 10)).toBeGreaterThan(50);

    // A node button is directly keyboard-focusable (Tab-reachable in real
    // usage; `.focus()` here exercises the identical focus/keydown path).
    // Focusing it selects it (opens the rail); Enter then navigates there.
    const targetNode = page.getByTestId(`page-graph-node-${targetId}`);
    await targetNode.focus();
    await expect(page.getByTestId('page-graph-rail-title')).toHaveText('Keyboard Target');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('page-title')).toHaveText('Keyboard Target');
  });

  test('arrow-key traversal moves focus between a node and its neighbors', async ({ page, request }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'graph-kbd-nav',
      projectName: 'Graph Keyboard Nav QA',
      openBoard: false,
    });
    const apiCreatePage = apiCreatePageFactory(request, project.id, token);
    const hubId = await apiCreatePage('Nav Hub', 'See [[Nav Leaf]].');
    const leafId = await apiCreatePage('Nav Leaf', 'Back to [[Nav Hub]].');

    await page.goto(`/projects/${project.id}/pages/graph`);
    await expect(page.getByTestId('page-graph-view')).toBeVisible();
    await expect(page.getByTestId(`page-graph-node-${leafId}`)).toBeVisible();

    await page.getByTestId(`page-graph-node-${hubId}`).focus();
    await expect(page.getByTestId('page-graph-rail-title')).toHaveText('Nav Hub');

    // The hub's only neighbor is the leaf — ANY arrow key should traverse to
    // it (it's the sole candidate in every direction bucket) and select it.
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('page-graph-rail-title')).toHaveText('Nav Leaf');
    await expect(page.getByTestId(`page-graph-node-${leafId}`)).toBeFocused();
  });

  test('minimap renders for a large graph and click-to-jump moves the camera', async ({ page, request }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'graph-minimap',
      projectName: 'Graph Minimap QA',
      openBoard: false,
    });
    const apiCreatePage = apiCreatePageFactory(request, project.id, token);
    let lastId = '';
    for (let i = 0; i < 9; i++) {
      lastId = await apiCreatePage(`Minimap Page ${i}`, i > 0 ? undefined : undefined);
    }
    expect(lastId).not.toEqual('');

    await page.goto(`/projects/${project.id}/pages/graph`);
    await expect(page.getByTestId('page-graph-view')).toBeVisible();
    // 9 nodes clears the minimap's "worth the chrome" threshold.
    await expect(page.getByTestId('page-graph-minimap')).toBeVisible();
    await page.waitForTimeout(400);

    const group = page.locator('[data-testid="page-graph-view"] svg > g');
    const transformBefore = await group.getAttribute('transform');

    const minimapCanvas = page.getByTestId('page-graph-minimap-canvas');
    const box = (await minimapCanvas.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.85);

    const transformAfter = await group.getAttribute('transform');
    expect(transformAfter).not.toEqual(transformBefore);
  });

  test('empty graph state keeps the Document/Graph toggle reachable', async ({ page, request }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'graph-empty',
      projectName: 'Graph Empty QA',
      openBoard: false,
    });

    await page.goto(`/projects/${project.id}/pages/graph`);
    await expect(page.getByTestId('page-graph-view')).toBeVisible();
    await expect(page.getByText('Nothing to graph yet')).toBeVisible();

    await expect(page.getByTestId('pages-view-document')).toBeVisible();
    await page.getByTestId('pages-view-document').click();
    await expect(page.getByTestId('page-create-first')).toBeVisible();
  });

  test('a failed graph fetch renders the error state with retry, without losing the toggle', async ({ page, request }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'graph-error',
      projectName: 'Graph Error QA',
      openBoard: false,
    });
    const apiCreatePage = apiCreatePageFactory(request, project.id, token);
    await apiCreatePage('Solo Page');

    await page.route('**/api/projects/*/pages/graph', (route) => route.fulfill({ status: 500, body: 'boom' }));

    await page.goto(`/projects/${project.id}/pages/graph`);
    await expect(page.getByTestId('page-graph-view')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByTestId('pages-view-document')).toBeVisible();
  });
});

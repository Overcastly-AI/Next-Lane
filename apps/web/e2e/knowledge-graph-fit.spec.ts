import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_URL, setupIsolatedProject } from './helpers';

/**
 * Fit-to-content on the knowledge graph.
 *
 * The bug this locks down: the force layout used to run inside a world the
 * exact size of the visible canvas, so past a few dozen pages there was
 * nowhere to put nodes. Repulsion pushed them outward, the edge clamp caught
 * them, and they stacked into straight rails along the top and bottom of the
 * frame with overprinted labels. "Reset" restored 100% zoom without reframing,
 * so there was no way back to a readable view — the screenshot capture script
 * had to click zoom-out three times to photograph the graph at all.
 *
 * Nothing tested it, because the only graph specs use two- and three-node
 * graphs, which fit trivially. Density is the whole point here, so this spec
 * seeds a graph big enough to overflow and asserts the two properties that
 * actually matter to a viewer:
 *
 *  1. every node lands inside the visible canvas on open, and
 *  2. "fit" recovers that view after the user has zoomed and panned away.
 */
function apiCreatePageFactory(request: APIRequestContext, projectId: string, token: string) {
  return async function apiCreatePage(title: string, content?: string): Promise<string> {
    const res = await request.post(`${API_URL}/api/projects/${projectId}/pages`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title, content },
    });
    expect(res.ok(), `create page "${title}" failed: ${res.status()}`).toBeTruthy();
    return ((await res.json()) as { id: string }).id;
  };
}

/**
 * Enough nodes that the layout cannot fit the canvas at 100% — on the 1280px
 * desktop viewport the world comes out ~1.25x the canvas, and far more than
 * that at 393px. Kept as low as that requirement allows: every extra node is
 * another SVG subtree to lay out and measure, and this spec has to survive
 * running alongside five other workers on four cores.
 */
const PAGE_COUNT = 28;

test.describe('Knowledge graph — fit to content', () => {
  test('a dense graph opens fully framed, and Fit recovers the frame after zoom + pan', async ({
    page,
    request,
  }) => {
    // Seeds a whole wiki over the API, runs a force layout over it, and
    // measures every node twice. Generous, because CPU contention from
    // sibling workers stretches the layout settle more than anything else.
    test.setTimeout(150_000);

    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'graph-fit',
      projectName: 'Graph Fit QA',
      openBoard: false,
    });
    const apiCreatePage = apiCreatePageFactory(request, project.id, token);

    // A hub-and-spoke graph: one hub every 8 pages, each spoke linking back.
    // Wiki-links matter — an edgeless cloud lays out differently from a
    // connected one, and the connected case is the one that overflowed.
    //
    // Hubs first and sequentially (a spoke's `[[link]]` only resolves to an
    // edge if its target already exists), then every spoke at once. Creating
    // all 40 in series took long enough to blow the test timeout when six
    // workers were contending for the API.
    const titles = Array.from({ length: PAGE_COUNT }, (_, i) => `Fit Node ${i + 1}`);
    const isHub = (i: number) => i % 8 === 0;
    for (let i = 0; i < titles.length; i++) {
      if (isHub(i)) await apiCreatePage(titles[i], 'Hub page.');
    }
    await Promise.all(
      titles
        .map((title, i) => ({ title, i }))
        .filter(({ i }) => !isHub(i))
        .map(({ title, i }) =>
          apiCreatePage(title, `Part of [[${titles[Math.floor(i / 8) * 8]}]].`),
        ),
    );

    await page.goto(`/projects/${project.id}/pages/graph`);
    const canvas = page.getByTestId('page-graph-canvas');
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId('page-graph-view')).toBeVisible();

    // Wait on the NODES, not the zoom readout. The view pre-frames its world
    // as soon as it knows the size, so the readout leaves 100% before the
    // simulation has placed anything — waiting on it and then counting nodes
    // found zero.
    const nodeLocator = page.locator('[data-testid^="page-graph-node-"]');
    await expect(nodeLocator).toHaveCount(PAGE_COUNT, { timeout: 20_000 });

    const zoomLabel = page.getByTestId('page-graph-zoom-reset');

    /** Every rendered node's box, relative to the canvas box. */
    async function nodesOutsideCanvas(): Promise<number> {
      return page.evaluate(() => {
        const canvasEl = document.querySelector('[data-testid="page-graph-canvas"]');
        if (!canvasEl) return -1;
        const c = canvasEl.getBoundingClientRect();
        const dots = Array.from(
          document.querySelectorAll('[data-testid^="page-graph-node-"]'),
        );
        // 1px of slack absorbs sub-pixel rounding in the SVG transform.
        return dots.filter((d) => {
          const r = d.getBoundingClientRect();
          return (
            r.left < c.left - 1 ||
            r.right > c.right + 1 ||
            r.top < c.top - 1 ||
            r.bottom > c.bottom + 1
          );
        }).length;
      });
    }

    // Fit explicitly rather than relying on the automatic settle-time fit, so
    // the measurement below can't race the simulation's last frames.
    await zoomLabel.click();
    await page.waitForTimeout(600); // the fit transition is 340ms

    // This graph really is bigger than the canvas — otherwise "opens fully
    // framed" would be trivially true and the spec would prove nothing.
    const fitted = Number.parseInt((await zoomLabel.textContent()) ?? '', 10);
    expect(fitted, 'seeded graph should not fit at 100%').toBeLessThan(100);

    expect(await nodesOutsideCanvas(), 'nodes off-frame on open').toBe(0);

    // Now get thoroughly lost. Zoom all the way in — five 1.25x steps clamp at
    // MAX_SCALE (3x), which guarantees overflow at any viewport. Two steps was
    // not enough: at 393px the graph fits at ~50%, so 1.25² still fitted and
    // the negative control below passed for the wrong reason.
    for (let i = 0; i < 5; i++) await page.getByTestId('page-graph-zoom-in').click();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2, { steps: 8 });
    await page.mouse.up();

    expect(
      await nodesOutsideCanvas(),
      'zoomed and panned — nodes SHOULD now be off-frame, or the test proves nothing',
    ).toBeGreaterThan(0);

    // Fit brings everything back.
    await page.getByTestId('page-graph-zoom-reset').click();
    await page.waitForTimeout(600); // the fit transition is 340ms
    expect(await nodesOutsideCanvas(), 'nodes still off-frame after Fit').toBe(0);
  });

  test('fit never magnifies a graph that already fits — a tiny graph stays at 100%', async ({
    page,
    request,
  }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'graph-fit-small',
      projectName: 'Graph Fit Small QA',
      openBoard: false,
    });
    const apiCreatePage = apiCreatePageFactory(request, project.id, token);
    await apiCreatePage('Solo Alpha', 'See [[Solo Beta]].');
    await apiCreatePage('Solo Beta', 'Back to [[Solo Alpha]].');

    await page.goto(`/projects/${project.id}/pages/graph`);
    await expect(page.getByTestId('page-graph-view')).toBeVisible();

    // Two nodes could be scaled up 3× to "fill" the canvas. They must not be:
    // fit means "you can see everything", not "fill the pixels". The resting
    // zoom is therefore at most 100% — and on a 393px viewport it may be a
    // little under, since even two 108px node boxes can need framing.
    const zoomLabel = page.getByTestId('page-graph-zoom-reset');
    // Fit first, so the baseline can't be read before the layout settles.
    await page.getByTestId('page-graph-zoom-reset').click();
    const fitted = (await zoomLabel.textContent())?.trim() ?? '';
    expect(Number.parseInt(fitted, 10)).toBeLessThanOrEqual(100);
    expect(Number.parseInt(fitted, 10)).toBeGreaterThan(50);

    await page.getByTestId('page-graph-zoom-in').click();
    await expect(zoomLabel).not.toHaveText(fitted);
    await page.getByTestId('page-graph-zoom-reset').click();
    await expect(zoomLabel).toHaveText(fitted);
  });
});

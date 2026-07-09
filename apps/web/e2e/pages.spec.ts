import { test, expect, type Page } from '@playwright/test';
import { setupIsolatedProject } from './helpers';

/**
 * pages.spec.ts
 *
 * End-to-end coverage for the Pages knowledge base (Confluence x Obsidian
 * hybrid): tree nav, the markdown editor with `[[wiki-link]]` autocomplete,
 * resolved/unresolved link rendering + navigation, version history +
 * restore, the backlinks ("what links here") panel, and the force-directed
 * knowledge graph. Runs on BOTH configured Playwright projects
 * (chromium-desktop + mobile-chrome, see playwright.config.ts) so every
 * assertion below is exercised at 390px too — including the graph view,
 * which is required to stay legible (not just present) on mobile.
 *
 * Each spec gets its own isolated tenant (never the shared demo project).
 */

/** Open a page from the sidebar tree, using whichever surface (inline
 * desktop panel or the mobile slide-over drawer) is actually visible at the
 * current viewport — mirrors `helpers.gotoSection`'s viewport-generic
 * pattern for the app's primary nav. */
async function openPageViaTree(page: Page, pageId: string): Promise<void> {
  const mobileToggle = page.getByTestId('page-tree-mobile-toggle');
  if (await mobileToggle.isVisible().catch(() => false)) {
    await mobileToggle.click();
    await page
      .getByTestId('page-tree-mobile-drawer')
      .getByTestId(`page-tree-item-${pageId}`)
      .click();
  } else {
    await page
      .locator('nav[aria-label="Pages"]')
      .getByTestId(`page-tree-item-${pageId}`)
      .click();
  }
}

function currentPageId(page: Page): string {
  const match = /\/pages\/([^/?#]+)/.exec(page.url());
  if (!match) throw new Error(`Not on a page detail URL: ${page.url()}`);
  return match[1];
}

test.describe('Pages knowledge base', () => {
  test('reaches the Pages tab from the project nav', async ({ page, request }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'pages-nav',
      projectName: 'Pages Nav QA',
    });

    await page.getByRole('button', { name: /^more/i }).click();
    await page.getByTestId('nav-pages').click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/pages`));
  });

  test('create → edit with [[wiki-link]] → resolves + navigates → backlinks → version history + restore → graph', async ({
    page,
    request,
  }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'pages',
      projectName: 'Pages QA',
    });

    await page.goto(`/projects/${project.id}/pages`);

    // ── Create the first page ────────────────────────────────────────────
    await test.step('create the Hub page', async () => {
      await expect(page.getByTestId('page-create-first')).toBeVisible();
      await page.getByTestId('page-create-first').click();
      await page.getByTestId('create-page-title-input').fill('Hub Page');
      await page.getByTestId('create-page-submit').click();
      await expect(page.getByTestId('page-title')).toHaveText('Hub Page');
    });
    const hubId = currentPageId(page);

    // ── Edit with an (as-yet unresolved) [[wiki-link]], autocomplete UX ──
    await test.step('edit Hub with a [[wiki-link]] to a not-yet-created page', async () => {
      await page.getByTestId('page-edit').click();
      const editor = page.getByTestId('page-content-editor');
      await editor.click();
      // Per-keystroke typing — exercises the real onChange/caret-detection
      // path (not a single synthetic .fill() event), so a focus-loss or
      // dropdown-detection regression would actually be caught here.
      await editor.pressSequentially('Link to [[Target', { delay: 15 });
      await expect(page.getByTestId('wikilink-picker')).toBeVisible();
      await expect(page.getByTestId('wikilink-no-results')).toContainText('Target');
      await editor.pressSequentially(']] for details.', { delay: 15 });
      await expect(page.getByTestId('wikilink-picker')).toHaveCount(0);
      await page.getByTestId('page-save').click();
      await expect(page.getByTestId('page-save')).toHaveCount(0); // back to read mode
    });

    // ── Unresolved link renders as a "create it" affordance, and creates ──
    await test.step('the unresolved link renders + creates the target page', async () => {
      const unresolvedLink = page.locator('.nl-page-content a[href="#create-page:Target"]');
      await expect(unresolvedLink).toBeVisible();
      await expect(unresolvedLink).toHaveText('Target');
      await unresolvedLink.click();

      await expect(page.getByTestId('create-page-title-input')).toHaveValue('Target');
      await page.getByTestId('create-page-submit').click();
      await expect(page.getByTestId('page-title')).toHaveText('Target');
    });
    const targetId = currentPageId(page);

    await test.step('Target has no backlinks yet (Hub was saved before Target existed)', async () => {
      await expect(page.getByTestId('page-backlinks-empty')).toBeVisible();
    });

    // ── Back on Hub, the SAME [[Target]] link now renders resolved ───────
    await test.step('back on Hub, the link now renders resolved and navigates', async () => {
      await openPageViaTree(page, hubId);
      await expect(page.getByTestId('page-title')).toHaveText('Hub Page');
      const resolvedLink = page.locator(`.nl-page-content a[href="#page:${targetId}"]`);
      await expect(resolvedLink).toBeVisible();
      await expect(resolvedLink).toHaveText('Target');
      await resolvedLink.click();
      await expect(page.getByTestId('page-title')).toHaveText('Target');
    });

    // ── Re-save Hub so the link edge is (re)synced server-side ───────────
    await test.step('re-save Hub so the wiki-link edge syncs', async () => {
      await openPageViaTree(page, hubId);
      await page.getByTestId('page-edit').click();
      const editor = page.getByTestId('page-content-editor');
      await editor.click();
      await page.keyboard.press('Control+End');
      await editor.pressSequentially(' (see also)', { delay: 15 });
      await page.getByTestId('page-save').click();
      await expect(page.getByTestId('page-save')).toHaveCount(0);
    });

    // ── Backlinks now shows the reverse reference ─────────────────────────
    await test.step('backlinks panel shows the reverse reference', async () => {
      await openPageViaTree(page, targetId);
      const backlink = page.getByTestId(`page-backlink-${hubId}`);
      await expect(backlink).toBeVisible();
      await expect(backlink).toContainText('Hub Page');
      await backlink.click();
      await expect(page.getByTestId('page-title')).toHaveText('Hub Page');
    });

    // ── The knowledge graph renders nodes + the edge, legibly on mobile ───
    await test.step('the graph view renders nodes + edges', async () => {
      await page.getByTestId('pages-view-graph').click();
      const graph = page.getByTestId('page-graph-view');
      await expect(graph).toBeVisible();
      await expect(page.getByTestId('page-graph-truncated-hint')).toHaveCount(0);

      const hubNode = page.getByTestId(`page-graph-node-${hubId}`);
      const targetNode = page.getByTestId(`page-graph-node-${targetId}`);
      await expect(hubNode).toBeVisible();
      await expect(targetNode).toBeVisible();
      await expect(hubNode).toContainText('Hub Page');
      await expect(targetNode).toContainText('Target');

      // At least one edge line was drawn between the two nodes.
      await expect(page.locator('[data-testid="page-graph-view"] svg line')).toHaveCount(1);

      // Mobile-legibility guard: a node's rendered box must be a real,
      // readable size — not shrunk to fit a "world" viewBox wider than the
      // viewport (see KnowledgeGraphView's doc comment on this design goal).
      const box = await hubNode.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThan(20);

      // Clicking a node navigates to that page.
      await targetNode.click();
      await expect(page.getByTestId('page-title')).toHaveText('Target');
    });

    // ── Version history shows the saves, and restore works ───────────────
    await test.step('version history shows every save and restore reverts content', async () => {
      await page.goto(`/projects/${project.id}/pages/${hubId}`);
      await page.getByTestId('page-open-version-history').click();
      await expect(page.getByTestId('page-version-history-drawer')).toBeVisible();

      await expect(page.getByTestId('page-version-row-1')).toBeVisible();
      await expect(page.getByTestId('page-version-row-2')).toBeVisible();
      await expect(page.getByTestId('page-version-row-3')).toBeVisible();
      await expect(page.getByTestId('page-version-row-3')).toContainText('Current');

      await page.getByTestId('page-version-row-1').click();
      await page.getByTestId('page-version-restore-1').click();
      // ConfirmDialog renders with role="alertdialog" (destructive confirmation).
      await page
        .getByRole('alertdialog', { name: 'Restore version' })
        .getByRole('button', { name: 'Restore', exact: true })
        .click();

      // Drawer stays open; a new version (the restore snapshot) appears.
      await expect(page.getByTestId('page-version-row-4')).toBeVisible();

      await page
        .getByTestId('page-version-history-drawer')
        .getByRole('button', { name: 'Close' })
        .click();
      await expect(page.getByTestId('page-content-empty')).toBeVisible();
    });

    await test.step('restoring re-synced the wiki-link edge away', async () => {
      await openPageViaTree(page, targetId);
      await expect(page.getByTestId('page-backlinks-empty')).toBeVisible();
    });
  });
});

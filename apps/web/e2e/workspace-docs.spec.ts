import { test, expect, type Page } from '@playwright/test';
import { registerNewUser, createWorkspace, login } from './helpers';

/**
 * workspace-docs.spec.ts
 *
 * End-to-end coverage for the workspace-level Docs surface (org-wide Pages
 * epic, Phase 11 continuation item 17): a page tree not tied to any single
 * project, reached from the persistent sidebar's workspace section — its
 * single entry point (the redundant tab that used to also live in the
 * workspace settings strip has been removed; docs are not a workspace
 * setting) — reusing the exact same tree/editor/backlinks/graph component
 * stack as the per-project Docs surface.
 *
 * Runs on BOTH configured Playwright projects (chromium-desktop +
 * mobile-chrome, see playwright.config.ts) — the nav-entry helper below
 * picks whichever surface (desktop rail or mobile drawer) is visible.
 *
 * Each spec gets its own isolated user + workspace (never the shared demo).
 */

/** Register a fresh user + their own workspace, and land logged in on the dashboard. */
async function setupIsolatedWorkspace(
  page: Page,
  request: import('@playwright/test').APIRequestContext,
  label: string,
): Promise<{ workspaceId: string; email: string }> {
  const user = await registerNewUser(request, label);
  const workspaceId = await createWorkspace(request, user.token, `Docs QA ${label}-${Date.now()}`);
  await login(page, { email: user.email, password: user.password });
  return { workspaceId, email: user.email };
}

/** Open the workspace Docs nav entry, using whichever surface (desktop
 * persistent sidebar or the mobile drawer) is actually visible at the
 * current viewport — mirrors `pages.spec.ts`'s `openPageViaTree` pattern. */
async function openWorkspaceDocsViaNav(page: Page): Promise<void> {
  const mobileToggle = page.getByTestId('nav-sidebar-drawer-toggle');
  if (await mobileToggle.isVisible().catch(() => false)) {
    await mobileToggle.click();
    await page.getByTestId('nav-sidebar-drawer').getByTestId('nav-sidebar-workspace-docs').click();
  } else {
    await page.getByTestId('nav-sidebar').getByTestId('nav-sidebar-workspace-docs').click();
  }
}

/** Open a page from the workspace docs tree, using whichever surface (inline
 * desktop panel or the mobile slide-over drawer) is actually visible. */
async function openDocViaTree(page: Page, pageId: string): Promise<void> {
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

function currentDocId(page: Page): string {
  const match = /\/docs\/([^/?#]+)/.exec(page.url());
  if (!match) throw new Error(`Not on a workspace-doc detail URL: ${page.url()}`);
  return match[1];
}

test.describe('Workspace Docs (org-wide pages)', () => {
  test('reaches the workspace Docs space from the workspace-level nav', async ({ page, request }) => {
    const { workspaceId } = await setupIsolatedWorkspace(page, request, 'docs-nav');

    await openWorkspaceDocsViaNav(page);
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/docs`));
    // Docs is not a workspace *setting* — the settings tab strip must NOT
    // carry a Docs entry (that redundant second entry point was removed);
    // the sidebar row above is the single, correct way in.
    await expect(page.getByTestId('workspace-settings-nav-docs')).toHaveCount(0);
  });

  test('empty state invites creating the first workspace page', async ({ page, request }) => {
    const { workspaceId } = await setupIsolatedWorkspace(page, request, 'docs-empty');

    await page.goto(`/workspaces/${workspaceId}/docs`);
    await expect(page.getByText('No docs yet')).toBeVisible();
    await expect(page.getByTestId('page-create-first')).toBeVisible();
  });

  test('create → edit with [[wiki-link]] → resolves → backlinks → graph, and no Linked-issues section', async ({
    page,
    request,
  }) => {
    const { workspaceId } = await setupIsolatedWorkspace(page, request, 'docs-flow');

    await page.goto(`/workspaces/${workspaceId}/docs`);

    // ── Create the first workspace page ──────────────────────────────────
    await test.step('create the Handbook page', async () => {
      await expect(page.getByTestId('page-create-first')).toBeVisible();
      await page.getByTestId('page-create-first').click();
      await page.getByTestId('create-page-title-input').fill('Handbook');
      await page.getByTestId('create-page-submit').click();
      await expect(page.getByTestId('page-title')).toHaveText('Handbook');
    });
    const handbookId = currentDocId(page);

    // ── A workspace page has no owning project — no "Linked issues" panel ─
    await test.step('the Linked issues section is absent on a workspace page', async () => {
      await expect(page.getByTestId('page-linked-issues-panel')).toHaveCount(0);
      // The backlinks panel (a workspace-agnostic feature) is still present.
      await expect(page.getByTestId('page-backlinks-panel')).toBeVisible();
    });

    // ── Edit with an (as-yet unresolved) [[wiki-link]] ───────────────────
    await test.step('edit Handbook with a [[wiki-link]] to a not-yet-created page', async () => {
      await page.getByTestId('page-edit').click();
      const editor = page.getByTestId('page-content-editor');
      await editor.click();
      // Per-keystroke typing — exercises the real onChange/caret-detection path.
      await editor.pressSequentially('See the [[Runbook', { delay: 15 });
      await expect(page.getByTestId('wikilink-picker')).toBeVisible();
      await expect(page.getByTestId('wikilink-no-results')).toContainText('Runbook');
      await editor.pressSequentially(']] for on-call steps.', { delay: 15 });
      await expect(page.getByTestId('wikilink-picker')).toHaveCount(0);
      await page.getByTestId('page-save').click();
      await expect(page.getByTestId('page-save')).toHaveCount(0); // back to read mode
    });

    // ── The unresolved link renders as a "create it" affordance ──────────
    await test.step('the unresolved link creates the target workspace page', async () => {
      const unresolvedLink = page.locator('.nl-page-content a[href="#create-page:Runbook"]');
      await expect(unresolvedLink).toBeVisible();
      await unresolvedLink.click();

      await expect(page.getByTestId('create-page-title-input')).toHaveValue('Runbook');
      await page.getByTestId('create-page-submit').click();
      await expect(page.getByTestId('page-title')).toHaveText('Runbook');
    });
    const runbookId = currentDocId(page);

    await test.step('Runbook has no backlinks yet (Handbook was saved before Runbook existed)', async () => {
      await expect(page.getByTestId('page-backlinks-empty')).toBeVisible();
      await expect(page.getByTestId('page-linked-issues-panel')).toHaveCount(0);
    });

    // ── Both pages now appear in the workspace docs tree ──────────────────
    await test.step('both pages appear in the workspace docs tree', async () => {
      await openDocViaTree(page, handbookId);
      await expect(page.getByTestId('page-title')).toHaveText('Handbook');
      const resolvedLink = page.locator(`.nl-page-content a[href="#page:${runbookId}"]`);
      await expect(resolvedLink).toBeVisible();
      await expect(resolvedLink).toHaveText('Runbook');
    });

    // ── Re-save Handbook so the wiki-link edge is (re)synced server-side ──
    await test.step('re-save Handbook so the wiki-link edge syncs', async () => {
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
      await openDocViaTree(page, runbookId);
      const backlink = page.getByTestId(`page-backlink-${handbookId}`);
      await expect(backlink).toBeVisible();
      await expect(backlink).toContainText('Handbook');
      await backlink.click();
      await expect(page.getByTestId('page-title')).toHaveText('Handbook');
    });

    // ── The knowledge graph renders both nodes + the edge between them, and
    //    the workspace-docs entry (`projectId: null`) shows in the legend ──
    await test.step('the graph view renders nodes + edges', async () => {
      await page.getByTestId('pages-view-graph').click();
      const graph = page.getByTestId('page-graph-view');
      await expect(graph).toBeVisible();

      const handbookNode = page.getByTestId(`page-graph-node-${handbookId}`);
      const runbookNode = page.getByTestId(`page-graph-node-${runbookId}`);
      await expect(handbookNode).toBeVisible();
      await expect(runbookNode).toBeVisible();
      await expect(handbookNode).toContainText('Handbook');
      await expect(runbookNode).toContainText('Runbook');

      // Both pages are workspace-docs (projectId: null) — the legend shows
      // the single neutral "Workspace docs" entry, no project color needed.
      await expect(page.getByTestId('page-graph-legend')).toBeVisible();
      await expect(page.getByTestId('page-graph-legend-item-workspace')).toContainText('Workspace docs');

      // At least one edge line was drawn between the two nodes.
      await expect(page.locator('[data-testid="page-graph-view"] svg line')).toHaveCount(1);

      // Selecting a node opens the side rail (focus/orbit); "Open page" navigates.
      await runbookNode.click();
      await expect(page.getByTestId('page-graph-rail')).toBeVisible();
      await expect(page.getByTestId('page-graph-rail-title')).toHaveText('Runbook');
      await page.getByTestId('page-graph-rail-open').click();
      await expect(page.getByTestId('page-title')).toHaveText('Runbook');
      await expect(page).toHaveURL(new RegExp(`/workspaces/.*/docs/${runbookId}`));
    });
  });
});

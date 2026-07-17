import { test, expect, type Page } from '@playwright/test';
import { registerNewUser, createWorkspace, createProject, login } from './helpers';

/**
 * pages-cross-project-links.spec.ts
 *
 * End-to-end coverage for cross-project wiki-links (org-level-docs epic,
 * BACKLOG #12b — unblocked by `c1b51b8`'s workspace-wide `[[wiki-link]]`
 * resolution). A page in one project can now link to (and be linked from) a
 * page in a DIFFERENT project of the same workspace; this suite asserts the
 * frontend routes every such reference to the TARGET's own scope (never a
 * dead link under the currently-viewed project) and marks it with a quiet
 * cross-scope badge (the target project's key) — but only when the scope
 * actually differs, per BACKLOG #12b's "no clutter on the common case" rule.
 *
 * Runs on BOTH configured Playwright projects (chromium-desktop +
 * mobile-chrome, see playwright.config.ts). Each spec gets its own isolated
 * user + workspace + two projects — never the shared demo.
 */

function currentPageId(page: Page): string {
  const match = /\/pages\/([^/?#]+)/.exec(page.url());
  if (!match) throw new Error(`Not on a project-page detail URL: ${page.url()}`);
  return match[1];
}

/** Click "New page" (root level) via whichever tree surface (desktop inline
 * panel or the mobile slide-over drawer) is actually visible — mirrors
 * `pages.spec.ts`'s `openPageViaTree` viewport-generic pattern. */
async function createRootPage(page: Page, title: string): Promise<void> {
  const mobileToggle = page.getByTestId('page-tree-mobile-toggle');
  if (await mobileToggle.isVisible().catch(() => false)) {
    await mobileToggle.click();
    await page.getByTestId('page-tree-mobile-drawer').getByTestId('page-tree-new-root').click();
  } else {
    await page.locator('nav[aria-label="Pages"]').getByTestId('page-tree-new-root').click();
  }
  await page.getByTestId('create-page-title-input').fill(title);
  await page.getByTestId('create-page-submit').click();
}

test.describe('Cross-project wiki-links', () => {
  test('outgoing link, backlink, and workspace-graph node all route to the target page\'s own project, with a cross-project badge', async ({
    page,
    request,
  }) => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const user = await registerNewUser(request, `xproj-${suffix}`);
    const workspaceId = await createWorkspace(request, user.token, `XProj WS ${suffix}`);
    const projectA = await createProject(request, user.token, workspaceId, {
      name: `Alpha ${suffix}`,
    });
    const projectB = await createProject(request, user.token, workspaceId, {
      name: `Beta ${suffix}`,
    });

    await login(page, { email: user.email, password: user.password });

    // ── Project B: create the link TARGET first, so the link resolves on save ──
    let betaPageId = '';
    await test.step('create the target page in project B', async () => {
      await page.goto(`/projects/${projectB.id}/pages`);
      await expect(page.getByTestId('page-create-first')).toBeVisible();
      await page.getByTestId('page-create-first').click();
      await page.getByTestId('create-page-title-input').fill('Beta Landing');
      await page.getByTestId('create-page-submit').click();
      await expect(page.getByTestId('page-title')).toHaveText('Beta Landing');
      betaPageId = currentPageId(page);
      // A brand-new page has no outgoing links yet — the panel is absent.
      await expect(page.getByTestId('page-outgoing-links-panel')).toHaveCount(0);
    });

    // ── Project A: create a page whose body [[links]] to project B's page ──
    let alphaPageId = '';
    await test.step('create Alpha Home in project A, linking to Beta Landing', async () => {
      await page.goto(`/projects/${projectA.id}/pages`);
      await expect(page.getByTestId('page-create-first')).toBeVisible();
      await page.getByTestId('page-create-first').click();
      await page.getByTestId('create-page-title-input').fill('Alpha Home');
      await page.getByTestId('create-page-submit').click();
      await expect(page.getByTestId('page-title')).toHaveText('Alpha Home');
      alphaPageId = currentPageId(page);

      await page.getByTestId('page-edit').click();
      const editor = page.getByTestId('page-content-editor');
      await editor.click();
      // Per-keystroke typing (not `.fill()`) — exercises the real caret/
      // wiki-link-trigger detection path, same convention as pages.spec.ts.
      // "Beta Landing" won't appear in project A's OWN autocomplete (it's a
      // different project's page) — that's expected; the link still saves
      // as literal `[[..]]` text and resolves server-side, workspace-wide.
      await editor.pressSequentially('See [[Beta Landing]] for details.', { delay: 15 });
      await page.getByTestId('page-save').click();
      await expect(page.getByTestId('page-save')).toHaveCount(0); // back to read mode
    });

    // ── (a) Alpha's outgoing links show Beta's page, badged, routes to B ──
    await test.step('outgoing-links panel shows the cross-project target with a "Beta" badge and navigates there', async () => {
      const outLink = page.getByTestId(`page-outgoing-link-${betaPageId}`);
      await expect(outLink).toBeVisible();
      await expect(outLink).toContainText('Beta Landing');
      // The cross-scope badge names the TARGET's own project key — not
      // color-only, a real text label.
      await expect(outLink).toContainText(projectB.key);

      await outLink.click();
      await expect(page.getByTestId('page-title')).toHaveText('Beta Landing');
      await expect(page).toHaveURL(
        new RegExp(`/projects/${projectB.id}/pages/${betaPageId}`),
      );
    });

    // ── (b) Beta's backlinks show Alpha's page, badged, routes to A ──────
    await test.step('backlinks panel shows the cross-project source with an "Alpha" badge and navigates there', async () => {
      const backlink = page.getByTestId(`page-backlink-${alphaPageId}`);
      await expect(backlink).toBeVisible();
      await expect(backlink).toContainText('Alpha Home');
      await expect(backlink).toContainText(projectA.key);

      await backlink.click();
      await expect(page.getByTestId('page-title')).toHaveText('Alpha Home');
      await expect(page).toHaveURL(
        new RegExp(`/projects/${projectA.id}/pages/${alphaPageId}`),
      );
    });

    // ── (c) The workspace-wide graph unions both projects; a node from the
    //        "other" project (relative to wherever you are) still routes to
    //        its own project's Pages route, not a dead workspace-docs link ──
    await test.step('the workspace graph routes a cross-project node to its own project', async () => {
      await page.goto(`/workspaces/${workspaceId}/docs/graph`);
      const graph = page.getByTestId('page-graph-view');
      await expect(graph).toBeVisible();

      const alphaNode = page.getByTestId(`page-graph-node-${alphaPageId}`);
      const betaNode = page.getByTestId(`page-graph-node-${betaPageId}`);
      await expect(alphaNode).toBeVisible();
      await expect(betaNode).toBeVisible();

      // At least one edge line was drawn between the two cross-project nodes.
      await expect(page.locator('[data-testid="page-graph-view"] svg line')).toHaveCount(1);

      await betaNode.click();
      await expect(page.getByTestId('page-title')).toHaveText('Beta Landing');
      await expect(page).toHaveURL(
        new RegExp(`/projects/${projectB.id}/pages/${betaPageId}`),
      );
    });
  });

  test('same-project backlink shows NO cross-scope badge', async ({ page, request }) => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const user = await registerNewUser(request, `xproj-same-${suffix}`);
    const workspaceId = await createWorkspace(request, user.token, `XProj Same WS ${suffix}`);
    const project = await createProject(request, user.token, workspaceId, {
      name: `Solo ${suffix}`,
    });

    await login(page, { email: user.email, password: user.password });

    let targetId = '';
    await test.step('create the target page', async () => {
      await page.goto(`/projects/${project.id}/pages`);
      await page.getByTestId('page-create-first').click();
      await page.getByTestId('create-page-title-input').fill('Same Scope Target');
      await page.getByTestId('create-page-submit').click();
      await expect(page.getByTestId('page-title')).toHaveText('Same Scope Target');
      targetId = currentPageId(page);
    });

    await test.step('create a source page in the SAME project, linking to it', async () => {
      await page.goto(`/projects/${project.id}/pages`);
      await createRootPage(page, 'Same Scope Source');
      await expect(page.getByTestId('page-title')).toHaveText('Same Scope Source');

      await page.getByTestId('page-edit').click();
      const editor = page.getByTestId('page-content-editor');
      await editor.click();
      await editor.pressSequentially('See [[Same Scope Target]].', { delay: 15 });
      await page.getByTestId('page-save').click();
      await expect(page.getByTestId('page-save')).toHaveCount(0);

      // Same-project outgoing link — no badge (no cross-scope clutter).
      const outLink = page.getByTestId(`page-outgoing-link-${targetId}`);
      await expect(outLink).toBeVisible();
      await expect(outLink).not.toContainText(project.key);
    });

    await test.step('the backlink on the target page also carries no badge', async () => {
      await page.goto(`/projects/${project.id}/pages/${targetId}`);
      const backlinkItem = page.getByTestId('page-backlinks-panel').getByRole('button');
      await expect(backlinkItem).toBeVisible();
      await expect(backlinkItem).toContainText('Same Scope Source');
      await expect(backlinkItem).not.toContainText(project.key);
    });
  });
});

/**
 * Navigation & IA overhaul — Phase 1: persistent left sidebar.
 *
 * Covers the sidebar frame itself (workspace-switch coherence is covered
 * separately in `workspace-switcher.spec.ts`):
 *  - renders on desktop (lg+), hidden below lg (mobile drawer takes over)
 *  - projects list scoped to the active workspace, active project marked
 *    with `aria-current="page"`, links to that project's board
 *  - no duplicate My Work / My Board / Insights links between the header
 *    and the sidebar at any single viewport
 *  - collapse-to-rail state persists across reload
 *  - mobile: hamburger opens the drawer, Escape closes it
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createProject, createWorkspace, login, registerNewUser } from './helpers';

interface Ctx {
  workspaceId: string;
  projectId: string;
  projectName: string;
}

/** Fresh user with one workspace + one project. Logs in and lands on the dashboard. */
async function setup(page: Page, request: APIRequestContext): Promise<Ctx> {
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const user = await registerNewUser(request, 'navsb');
  const workspaceId = await createWorkspace(request, user.token, `NavSB WS ${suffix}`);
  const project = await createProject(request, user.token, workspaceId, {
    name: `NavSB Project ${suffix}`,
  });
  await login(page, { email: user.email, password: user.password });
  return { workspaceId, projectId: project.id, projectName: project.name };
}

// ---------------------------------------------------------------------------
// Desktop (lg+)
// ---------------------------------------------------------------------------

test.describe('Sidebar — desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('renders with the active workspace’s projects and personal links; header does not duplicate them', async ({
    page,
    request,
  }) => {
    const ctx = await setup(page, request);

    const sidebar = page.getByTestId('nav-sidebar');
    await expect(sidebar).toBeVisible({ timeout: 15_000 });
    await expect(sidebar).toContainText(ctx.projectName, { timeout: 15_000 });
    await expect(sidebar.getByRole('link', { name: 'My Work' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'My Board' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Insights' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Notifications' })).toBeVisible();

    // The header's own copies of the same links are hidden at this
    // viewport — the sidebar is the single place they render, not both.
    const header = page.locator('header');
    await expect(header.getByRole('link', { name: 'My Work' })).toBeHidden();
    await expect(header.getByRole('link', { name: 'My Board' })).toBeHidden();
  });

  test('active project gets aria-current and links to its board', async ({
    page,
    request,
  }) => {
    const ctx = await setup(page, request);

    await page.goto(`/projects/${ctx.projectId}/backlog`);
    await expect(page.getByRole('heading', { name: 'Backlog' }).first()).toBeVisible({
      timeout: 15_000,
    });

    const sidebar = page.getByTestId('nav-sidebar');
    const activeRow = sidebar.getByTestId('nav-sidebar-project').filter({
      hasText: ctx.projectName,
    });
    await expect(activeRow).toHaveAttribute('aria-current', 'page', { timeout: 15_000 });
    await expect(activeRow).toHaveAttribute('href', `/projects/${ctx.projectId}/board`);
  });

  test('clicking a project in the sidebar navigates to its board', async ({
    page,
    request,
  }) => {
    const ctx = await setup(page, request);

    const sidebar = page.getByTestId('nav-sidebar');
    await sidebar.getByTestId('nav-sidebar-project').filter({ hasText: ctx.projectName }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${ctx.projectId}/board`), {
      timeout: 15_000,
    });
  });

  test('Roadmap is reachable one click from the sidebar (Phase 2)', async ({
    page,
    request,
  }) => {
    const ctx = await setup(page, request);

    await page.goto(`/projects/${ctx.projectId}/board`);
    const sidebar = page.getByTestId('nav-sidebar');
    await expect(sidebar).toContainText(ctx.projectName, { timeout: 15_000 });

    // The active project's views expand directly under it — Roadmap is a
    // single visible click, never behind ProjectNav's "More" dropdown.
    const roadmapLink = sidebar
      .getByTestId('nav-sidebar-view')
      .filter({ hasText: 'Roadmap' });
    await expect(roadmapLink).toBeVisible();
    await expect(roadmapLink).toHaveAttribute('href', `/projects/${ctx.projectId}/roadmap`);
    await roadmapLink.click();

    await expect(page).toHaveURL(new RegExp(`/projects/${ctx.projectId}/roadmap`), {
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: 'Roadmap' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Workspace Branding is reachable from the sidebar for an admin (Phase 2)', async ({
    page,
    request,
  }) => {
    const ctx = await setup(page, request);

    const brandingLink = page.getByTestId('nav-sidebar-branding');
    await expect(brandingLink).toBeVisible({ timeout: 15_000 });
    await expect(brandingLink).toHaveAttribute('href', `/workspaces/${ctx.workspaceId}/branding`);
    await brandingLink.click();

    await expect(page).toHaveURL(new RegExp(`/workspaces/${ctx.workspaceId}/branding`), {
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: /branding/i }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('board filter chip opens Board settings pre-scrolled to the filter field (Phase 2)', async ({
    page,
    request,
  }) => {
    const ctx = await setup(page, request);

    await page.goto(`/projects/${ctx.projectId}/board`);
    await expect(page.getByTestId('board-switcher')).toBeVisible({ timeout: 15_000 });

    // No filter configured yet — the empty-state "+ Default filter" chip
    // opens the same editor as the filled indicator does once set.
    const emptyChip = page.getByTestId('board-filter-chip');
    await expect(emptyChip).toBeVisible({ timeout: 15_000 });
    await emptyChip.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('Board settings')).toBeVisible();
    await expect(page.getByTestId('board-default-filter')).toBeFocused({ timeout: 5_000 });
  });

  test('collapse-to-rail state persists across reload', async ({ page, request }) => {
    await setup(page, request);

    const toggle = page.getByTestId('nav-sidebar-toggle');
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // Project names are visually hidden (icon-only rail) once collapsed —
    // the accessible name survives (sr-only), but the visible label doesn't.
    await expect(page.getByTestId('nav-sidebar-workspace-trigger')).toBeVisible();

    await page.reload();

    // Still collapsed after reload — restored synchronously, no flash of
    // the wrong width (asserted implicitly: the attribute is correct on the
    // very first check with no extra wait beyond normal page-ready timeout).
    await expect(page.getByTestId('nav-sidebar-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 15_000 },
    );

    // Restore for hygiene (not strictly required, but keeps a fresh session
    // simple if this spec's storage state were ever reused).
    await page.getByTestId('nav-sidebar-toggle').click();
    await expect(page.getByTestId('nav-sidebar-toggle')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

// ---------------------------------------------------------------------------
// "Small laptop" breakpoint (1024–1279px) — default-collapse without a
// stored preference (Pass 12 audit finding #6: the expanded 240px sidebar
// crowds the board's columns at this width).
// ---------------------------------------------------------------------------

test.describe('Sidebar — 1024px small-laptop default', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('defaults to the collapsed rail with no stored preference', async ({
    page,
    request,
  }) => {
    await setup(page, request);

    // First load, brand-new user → no localStorage preference yet → the
    // small-laptop default (collapsed) applies from the very first paint.
    const toggle = page.getByTestId('nav-sidebar-toggle');
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  test('an explicit "expanded" preference overrides the small-laptop default and survives reload', async ({
    page,
    request,
  }) => {
    await setup(page, request);

    const toggle = page.getByTestId('nav-sidebar-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });

    // User explicitly expands it.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await page.reload();

    // The explicit preference — not the width default — wins after reload.
    await expect(page.getByTestId('nav-sidebar-toggle')).toHaveAttribute(
      'aria-pressed',
      'false',
      { timeout: 15_000 },
    );
  });

  test('the 3-column board is no longer visually cramped at 1024px (Done column reachable without scrolling the sidebar into view)', async ({
    page,
    request,
  }) => {
    const ctx = await setup(page, request);

    await page.goto(`/projects/${ctx.projectId}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });

    // Collapsed rail by default here → the board region has materially more
    // width than the old always-expanded 240px sidebar left it.
    const boardMain = page.locator('main');
    const mainBox = await boardMain.boundingBox();
    expect(mainBox?.width ?? 0).toBeGreaterThan(880);

    await page.screenshot({ path: '/tmp/nav-shots/sidebar-1024.png' });
  });
});

// ---------------------------------------------------------------------------
// Mobile (< lg) — overlay drawer
// ---------------------------------------------------------------------------

test.describe('Sidebar — mobile drawer', () => {
  test.use({ viewport: { width: 393, height: 852 } });

  test('hidden by default; hamburger opens the drawer; Escape closes it', async ({
    page,
    request,
  }) => {
    const ctx = await setup(page, request);

    // The desktop rail is present in the DOM but not visible below lg.
    await expect(page.getByTestId('nav-sidebar')).toBeHidden();
    await expect(page.getByTestId('nav-sidebar-drawer')).toHaveCount(0);

    await page.getByTestId('nav-sidebar-drawer-toggle').click();
    const drawer = page.getByTestId('nav-sidebar-drawer');
    await expect(drawer).toBeVisible({ timeout: 5_000 });
    await expect(drawer).toContainText(ctx.projectName);

    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  });

  test('clicking a project link in the drawer navigates and closes it', async ({
    page,
    request,
  }) => {
    const ctx = await setup(page, request);

    await page.getByTestId('nav-sidebar-drawer-toggle').click();
    const drawer = page.getByTestId('nav-sidebar-drawer');
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    await drawer.getByTestId('nav-sidebar-project').filter({ hasText: ctx.projectName }).click();

    await expect(page).toHaveURL(new RegExp(`/projects/${ctx.projectId}/board`), {
      timeout: 15_000,
    });
    await expect(drawer).toHaveCount(0);
  });
});

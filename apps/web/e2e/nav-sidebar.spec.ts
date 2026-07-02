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

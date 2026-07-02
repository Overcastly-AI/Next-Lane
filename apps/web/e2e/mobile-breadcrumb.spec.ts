/**
 * Mobile project breadcrumb — project name must win the space over the
 * workspace chip at narrow viewports.
 *
 * Regression guard for the founder/product-audit-reported bug: at 393px the
 * header used to give the workspace chip its full width and squeeze the
 * "Projects / {project name}" breadcrumb down to a couple of characters
 * (e.g. "Pro…") — the wrong priority, since the workspace name is already
 * shown by the chip; the breadcrumb's own job is to say which PROJECT you're
 * looking at. `<ProjectBreadcrumb>` now wraps to its own full-width row on
 * mobile so the project name is never crushed, and collapses to a compact
 * back-icon in place of the "Projects" label + separator + badges.
 */
import { test, expect } from '@playwright/test';
import { API_URL, registerNewUser, createWorkspace, createProject } from './helpers';

async function setup(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
  const user = await registerNewUser(request, 'breadcrumb');
  // A deliberately long workspace name — this is what used to eat all the
  // header's mobile width and crush the project name.
  const workspaceId = await createWorkspace(
    request,
    user.token,
    `Bravo Workspace Extended Name ${Date.now().toString(36)}`,
  );
  const project = await createProject(request, user.token, workspaceId, {
    name: 'Bravo Project',
  });
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  await page.goto(`/projects/${project.id}/board`);
  await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });
  return { user, workspaceId, project };
}

test.describe('Mobile project breadcrumb', () => {
  test.use({ viewport: { width: 393, height: 851 } });

  test('project name renders in full (never truncated below ~15 chars) at 393px', async ({
    page,
    request,
  }) => {
    const { project } = await setup(page, request);

    const name = page.getByTestId('project-breadcrumb-name');
    await expect(name).toBeVisible({ timeout: 15_000 });
    const text = (await name.innerText()).trim();

    expect(text.length, `breadcrumb text "${text}" should show ≥15 chars`).toBeGreaterThanOrEqual(
      Math.min(15, project.name.length),
    );
    // The full project name is short enough that it should show verbatim.
    expect(text).toBe(project.name);

    // The workspace chip is still present and accessible (still shows the
    // workspace, just no longer forcing the project name off-screen).
    await expect(page.getByTestId('workspace-chip')).toBeVisible();
  });

  test('breadcrumb "Projects" back-link is still reachable (icon-only on mobile)', async ({
    page,
    request,
  }) => {
    await setup(page, request);
    const backLink = page.getByRole('link', { name: 'Back to projects' });
    await expect(backLink).toBeVisible({ timeout: 15_000 });
    await backLink.click();
    await expect(page).toHaveURL('/', { timeout: 10_000 });
  });
});

test.describe('Desktop project breadcrumb — no regression', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('full "Projects / {name} [key]" breadcrumb still renders on desktop', async ({
    page,
    request,
  }) => {
    const { project } = await setup(page, request);

    await expect(page.getByRole('link', { name: 'Back to projects' })).toContainText(
      'Projects',
    );
    const name = page.getByTestId('project-breadcrumb-name');
    await expect(name).toHaveText(project.name);
    // Scoped to the header: the persistent sidebar (Navigation & IA overhaul
    // Phase 1) also renders every project's key as its own nav-row chip, so
    // an unscoped page-wide text search is no longer unambiguous.
    await expect(page.locator('header').getByText(project.key)).toBeVisible();
  });
});

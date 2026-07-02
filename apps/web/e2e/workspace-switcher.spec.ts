/**
 * Workspace switcher — cross-page state-coherence gate.
 *
 * Regression suite for the founder-reported bug cluster (2026-07-01) where the
 * header chip and the dashboard's workspace selector were two unsynced states,
 * the active workspace never persisted across reload, and the chip misreported
 * the workspace while viewing a project board.
 *
 * These tests assert the ONE invariant that was broken everywhere: at any
 * moment, every surface that displays or depends on the active workspace (the
 * header chip, the dashboard selector, the project grid) agrees, and the
 * selection survives navigation, reload, and deletion of the active workspace.
 *
 * Runs on desktop AND mobile (both Playwright projects).
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import {
  API_URL,
  createProject,
  createWorkspace,
  login,
  registerNewUser,
  type RegisteredUser,
} from './helpers';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** Delete a workspace via the API. */
async function deleteWorkspace(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
): Promise<void> {
  const res = await request.delete(`${API_URL}/api/workspaces/${workspaceId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `delete workspace failed: ${res.status()}`).toBeTruthy();
}

interface MultiWsContext {
  user: RegisteredUser;
  alpha: { id: string; projectId: string };
  bravo: { id: string; projectId: string };
  charlie: { id: string };
}

/**
 * Fresh user with three workspaces: Alpha (+ "Alpha Project"), Bravo
 * (+ "Bravo Project"), Charlie (empty). Logs the user into the UI and lands
 * on the dashboard.
 *
 * Workspace names carry a unique suffix: slugs are globally unique and the
 * API's slug de-dup can 409 when parallel workers create the same name at
 * the same instant. Assertions match on the distinctive prefix only.
 */
async function setupMultiWorkspace(
  page: Page,
  request: APIRequestContext,
): Promise<MultiWsContext> {
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const user = await registerNewUser(request, 'wsqa');
  const alphaId = await createWorkspace(request, user.token, `Alpha ${suffix}`);
  const bravoId = await createWorkspace(request, user.token, `Bravo ${suffix}`);
  const charlieId = await createWorkspace(request, user.token, `Charlie ${suffix}`);
  const alphaProject = await createProject(request, user.token, alphaId, {
    name: 'Alpha Project',
  });
  const bravoProject = await createProject(request, user.token, bravoId, {
    name: 'Bravo Project',
  });
  await login(page, { email: user.email, password: user.password });
  return {
    user,
    alpha: { id: alphaId, projectId: alphaProject.id },
    bravo: { id: bravoId, projectId: bravoProject.id },
    charlie: { id: charlieId },
  };
}

const chip = (page: Page) => page.getByTestId('workspace-chip');
const wsSelect = (page: Page) => page.locator('#pulse-ws-select');
const projectsSection = (page: Page) =>
  page.locator('section[aria-labelledby="projects-heading"]');

// ---------------------------------------------------------------------------
// Multi-workspace coherence
// ---------------------------------------------------------------------------

test.describe('Workspace switcher — multi-workspace coherence', () => {
  test('dashboard selector and header chip agree on first load', async ({
    page,
    request,
  }) => {
    await setupMultiWorkspace(page, request);
    await expect(chip(page)).toContainText('Alpha', { timeout: 15_000 });
    await expect(wsSelect(page)).toHaveValue(/.+/, { timeout: 15_000 });
    const selectedLabel = await wsSelect(page)
      .locator('option:checked')
      .innerText();
    expect(selectedLabel.trim()).toContain('Alpha');
  });

  test('changing the dashboard selector updates the chip and re-scopes projects', async ({
    page,
    request,
  }) => {
    const ctx = await setupMultiWorkspace(page, request);
    await expect(chip(page)).toContainText('Alpha', { timeout: 15_000 });

    await wsSelect(page).selectOption(ctx.bravo.id);

    // Chip follows immediately (same context value, no reload needed).
    await expect(chip(page)).toContainText('Bravo', { timeout: 10_000 });
    // Content re-scopes to Bravo's projects.
    await expect(projectsSection(page)).toContainText('Bravo Project', {
      timeout: 15_000,
    });
    await expect(projectsSection(page)).not.toContainText('Alpha Project');
  });

  test('switching via the header chip re-scopes the dashboard content', async ({
    page,
    request,
  }) => {
    const ctx = await setupMultiWorkspace(page, request);
    await expect(chip(page)).toContainText('Alpha', { timeout: 15_000 });

    await chip(page).click();
    await page
      .getByTestId('workspace-switcher-item')
      .filter({ hasText: 'Bravo' })
      .click();

    // Chip, dashboard selector, and project grid all now say Bravo.
    await expect(chip(page)).toContainText('Bravo', { timeout: 10_000 });
    await expect(
      wsSelect(page).locator('option:checked'),
    ).toHaveText(/Bravo/, { timeout: 15_000 });
    await expect(projectsSection(page)).toContainText('Bravo Project', {
      timeout: 15_000,
    });
    await expect(projectsSection(page)).not.toContainText('Alpha Project');
    expect(ctx.bravo.id).toBeTruthy();
  });

  test('active workspace persists across a full page reload', async ({
    page,
    request,
  }) => {
    const ctx = await setupMultiWorkspace(page, request);
    await expect(chip(page)).toContainText('Alpha', { timeout: 15_000 });

    await wsSelect(page).selectOption(ctx.charlie.id);
    await expect(chip(page)).toContainText('Charlie', { timeout: 10_000 });

    await page.reload();

    // Still Charlie after reload — not reset to the first workspace.
    await expect(chip(page)).toContainText('Charlie', { timeout: 15_000 });
    await expect(
      wsSelect(page).locator('option:checked'),
    ).toHaveText(/Charlie/, { timeout: 15_000 });
  });

  test('opening a project board syncs the chip to that project’s workspace', async ({
    page,
    request,
  }) => {
    const ctx = await setupMultiWorkspace(page, request);
    // Land on Alpha first so the active workspace is NOT Bravo.
    await expect(chip(page)).toContainText('Alpha', { timeout: 15_000 });

    await page.goto(`/projects/${ctx.bravo.projectId}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // The chip must report the workspace we actually landed in.
    await expect(chip(page)).toContainText('Bravo', { timeout: 15_000 });

    // ...and going home keeps us scoped to Bravo (no snap-back to Alpha).
    await page.goto('/');
    await expect(chip(page)).toContainText('Bravo', { timeout: 15_000 });
    await expect(projectsSection(page)).toContainText('Bravo Project', {
      timeout: 15_000,
    });
  });

  test('deep-linking to a workspace settings page syncs the chip', async ({
    page,
    request,
  }) => {
    const ctx = await setupMultiWorkspace(page, request);
    // Land on Alpha first so the active workspace is NOT Bravo.
    await expect(chip(page)).toContainText('Alpha', { timeout: 15_000 });

    await page.goto(`/workspaces/${ctx.bravo.id}/settings`);
    await expect(
      page.getByRole('heading', { name: 'General settings' }),
    ).toBeVisible({ timeout: 15_000 });

    // The chip must report the workspace we actually landed in.
    await expect(chip(page)).toContainText('Bravo', { timeout: 15_000 });
  });

  test('deleting the active workspace heals to a remaining one', async ({
    page,
    request,
  }) => {
    const ctx = await setupMultiWorkspace(page, request);
    await expect(chip(page)).toContainText('Alpha', { timeout: 15_000 });

    // Make Charlie active, then delete it out from under the UI.
    await wsSelect(page).selectOption(ctx.charlie.id);
    await expect(chip(page)).toContainText('Charlie', { timeout: 10_000 });
    await deleteWorkspace(request, ctx.user.token, ctx.charlie.id);

    await page.reload();

    // No blank state, no crash: falls back to a surviving workspace.
    await expect(chip(page)).toContainText(/Alpha|Bravo/, { timeout: 15_000 });
    await expect(
      wsSelect(page).locator('option:checked'),
    ).toHaveText(/Alpha|Bravo/, { timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Single-workspace user
// ---------------------------------------------------------------------------

test.describe('Workspace switcher — single workspace', () => {
  test('chip renders as a settings link (no dropdown) for a one-workspace user', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'wsqa-solo');
    const wsId = await createWorkspace(
      request,
      user.token,
      `Solo ${Date.now().toString(36)}`,
    );
    expect(wsId).toBeTruthy();
    await login(page, { email: user.email, password: user.password });

    const soloChip = chip(page);
    await expect(soloChip).toContainText('Solo', { timeout: 15_000 });
    // Single workspace → the chip is a plain link to workspace settings.
    await expect(soloChip).toHaveAttribute('href', /\/workspaces\/.+\/settings/);
    await soloChip.click();
    await expect(page).toHaveURL(/\/workspaces\/.+\/settings/, {
      timeout: 10_000,
    });
  });
});

/**
 * E2E tests for the public read-only dashboard share link feature.
 *
 * Scenarios:
 *   1. Public /share/dashboard/:token page loads without authentication.
 *   2. The public dashboard shows the read-only banner + dashboard name.
 *   3. The public dashboard renders the seeded default gadgets' data.
 *   4. A gadget whose query calls me() shows a per-gadget error, not a crash
 *      or a silently-wrong "unassigned" result, for an anonymous viewer.
 *   5. A revoked token shows the error/invalid state (not the dashboard).
 *   6. A totally invalid token shows the error/invalid state.
 *   7. ADMIN can mint + see + revoke a dashboard share link from the
 *      Dashboards page "Share" modal (UI-driven, mirrors the board
 *      ShareSection e2e coverage).
 *   8. Mobile: public dashboard renders correctly on small screen.
 *
 * Desktop + Mobile projects from playwright.config.ts.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  registerNewUser,
  createWorkspace,
  createProject,
  API_URL,
  type RegisteredUser,
  type CreatedProject,
} from './helpers';

// ── helpers ──────────────────────────────────────────────────────────────────

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

interface MintedToken {
  id: string;
  rawToken: string;
}

/** Create a dashboard via the API. The FIRST dashboard on a project is
 * seeded with default gadgets (Open issues STAT, Status overview BREAKDOWN,
 * My open issues TABLE with `assignee = me() AND statusCategory != DONE`) —
 * exactly the me()-referencing gadget this suite needs, with zero extra
 * setup calls. */
async function createDashboard(
  request: APIRequestContext,
  token: string,
  projectId: string,
  name = 'Team overview',
): Promise<{ id: string; name: string }> {
  const res = await request.post(`${API_URL}/api/projects/${projectId}/dashboards`, {
    headers: authHeaders(token),
    data: { name },
  });
  expect(res.ok(), `create dashboard failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; name: string };
  return { id: body.id, name: body.name };
}

async function mintDashboardShareToken(
  request: APIRequestContext,
  token: string,
  dashboardId: string,
): Promise<MintedToken> {
  const res = await request.post(
    `${API_URL}/api/dashboards/${dashboardId}/share-tokens`,
    { headers: authHeaders(token) },
  );
  expect(res.ok(), `mint failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; rawToken: string };
  return { id: body.id, rawToken: body.rawToken };
}

async function revokeDashboardShareToken(
  request: APIRequestContext,
  token: string,
  dashboardId: string,
  tokenId: string,
): Promise<void> {
  const res = await request.delete(
    `${API_URL}/api/dashboards/${dashboardId}/share-tokens/${tokenId}`,
    { headers: authHeaders(token) },
  );
  expect(res.ok(), `revoke failed: ${res.status()}`).toBeTruthy();
}

interface ShareCtx {
  user: RegisteredUser;
  project: CreatedProject;
  dashboard: { id: string; name: string };
  minted: MintedToken;
}

async function setupShareCtx(request: APIRequestContext): Promise<ShareCtx> {
  const user = await registerNewUser(request, 'dash-share');
  const workspaceId = await createWorkspace(request, user.token);
  const project = await createProject(request, user.token, workspaceId, {
    name: 'Dashboard Share Test Project',
  });
  const dashboard = await createDashboard(request, user.token, project.id);
  const minted = await mintDashboardShareToken(request, user.token, dashboard.id);
  return { user, project, dashboard, minted };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Public dashboard share link', () => {
  test('public dashboard loads without authentication', async ({ page, request }) => {
    const { minted } = await setupShareCtx(request);

    // Visit as an unauthenticated user (no login step).
    await page.goto(`/share/dashboard/${minted.rawToken}`);

    await expect(page.getByTestId('shared-dashboard-header')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('readonly-badge')).toBeVisible();
    await expect(page.getByTestId('readonly-badge')).toContainText(/read-only/i);
  });

  test('public dashboard shows dashboard name and seeded gadgets', async ({
    page,
    request,
  }) => {
    const { dashboard, minted } = await setupShareCtx(request);

    await page.goto(`/share/dashboard/${minted.rawToken}`);
    await expect(page.getByTestId('shared-dashboard-header')).toBeVisible({
      timeout: 15_000,
    });

    // Dashboard name appears in the header.
    await expect(page.getByText(dashboard.name)).toBeVisible();

    // Default gadgets (seeded on the project's first dashboard) render.
    await expect(page.getByText('Open issues', { exact: true })).toBeVisible();
    await expect(page.getByText('Status overview')).toBeVisible();
    await expect(page.getByText('My open issues')).toBeVisible();

    // The STAT gadget shows a computed value (a number), never a spinner
    // stuck forever or a crash.
    await expect(page.getByTestId('gadget-stat-value').first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('a gadget using me() degrades to an explicit error for an anonymous viewer — never a crash or silent leak', async ({
    page,
    request,
  }) => {
    const { minted } = await setupShareCtx(request);

    await page.goto(`/share/dashboard/${minted.rawToken}`);
    await expect(page.getByTestId('shared-dashboard-header')).toBeVisible({
      timeout: 15_000,
    });

    // "My open issues" (assignee = me() AND statusCategory != DONE) must show
    // a per-gadget error, not data, and not take the whole page down with it
    // — the other gadgets on the same page (asserted above/below in other
    // tests) still render successfully.
    const myOpenIssuesCard = page
      .getByTestId('dashboard-gadget')
      .filter({ hasText: 'My open issues' });
    await expect(myOpenIssuesCard).toBeVisible({ timeout: 10_000 });
    await expect(myOpenIssuesCard.getByRole('alert')).toBeVisible();
    await expect(myOpenIssuesCard.getByRole('alert')).toContainText(
      /me\(\)/i,
    );
    await expect(myOpenIssuesCard.getByRole('alert')).toContainText(
      /signed-in/i,
    );
  });

  test('revoked token shows error state, not the dashboard', async ({
    page,
    request,
  }) => {
    const { user, dashboard, minted } = await setupShareCtx(request);

    await revokeDashboardShareToken(request, user.token, dashboard.id, minted.id);

    await page.goto(`/share/dashboard/${minted.rawToken}`);

    await expect(page.getByTestId('shared-dashboard-header')).not.toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText(/revoked|invalid|not found/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('totally invalid token shows error state', async ({ page }) => {
    await page.goto('/share/dashboard/nls_completely_bogus_token_that_does_not_exist');

    await expect(page.getByTestId('shared-dashboard-header')).not.toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText(/revoked|invalid|not found|unavailable/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('ADMIN can mint, see, and revoke a dashboard share link from the Dashboards page', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'dash-share-ui');
    const workspaceId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, workspaceId, {
      name: 'Dashboard Share UI Test',
    });
    await createDashboard(request, user.token, project.id, 'UI Test Dashboard');

    // Log in through the UI.
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/password/i).fill(user.password);
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    await page.goto(`/projects/${project.id}/dashboards`);
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 10_000 });

    // Open the Share modal.
    await page.getByTestId('dashboard-share').click();

    // Create a link.
    await page.getByTestId('create-dashboard-share-token-btn').click();
    await expect(page.getByTestId('new-dashboard-share-token-banner')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('dashboard-share-token-url')).toContainText(
      /\/share\/dashboard\//,
    );

    // A row appears in the token list.
    const row = page.getByTestId('dashboard-share-token-row');
    await expect(row).toBeVisible({ timeout: 5_000 });
    await expect(row).toContainText(/active/i);

    // Revoke it from the UI.
    await page.getByTestId('revoke-dashboard-share-token-btn').click();
    await page.getByRole('button', { name: /revoke link/i }).click();
    await expect(row).toContainText(/revoked/i, { timeout: 10_000 });
  });

  test('mobile: public dashboard renders without auth on small screen', async ({
    page,
    request,
  }) => {
    const { minted } = await setupShareCtx(request);

    await page.goto(`/share/dashboard/${minted.rawToken}`);
    await expect(page.getByTestId('shared-dashboard-header')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('readonly-badge')).toBeVisible();
    await expect(page.getByText('Open issues', { exact: true })).toBeVisible();
  });
});

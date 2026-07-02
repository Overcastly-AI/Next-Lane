/**
 * E2E tests for the public read-only board share link feature.
 *
 * Scenarios:
 *   1. Admin can create a share link in Project Settings.
 *   2. The public /share/:token page loads without authentication.
 *   3. The public board shows a read-only banner.
 *   4. The public board shows the correct project name and columns.
 *   5. A revoked token shows the error/invalid state (not the board).
 *   6. Mobile: public board renders correctly on small screen.
 *
 * Desktop + Mobile projects from playwright.config.ts.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  registerNewUser,
  createWorkspace,
  createProject,
  createIssue,
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

async function mintShareToken(
  request: APIRequestContext,
  token: string,
  projectId: string,
): Promise<MintedToken> {
  const res = await request.post(
    `${API_URL}/api/projects/${projectId}/share-tokens`,
    { headers: authHeaders(token) },
  );
  expect(res.ok(), `mint failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; rawToken: string };
  return { id: body.id, rawToken: body.rawToken };
}

async function revokeShareToken(
  request: APIRequestContext,
  token: string,
  projectId: string,
  tokenId: string,
): Promise<void> {
  const res = await request.delete(
    `${API_URL}/api/projects/${projectId}/share-tokens/${tokenId}`,
    { headers: authHeaders(token) },
  );
  expect(res.ok(), `revoke failed: ${res.status()}`).toBeTruthy();
}

interface ShareCtx {
  user: RegisteredUser;
  project: CreatedProject;
  minted: MintedToken;
}

async function setupShareCtx(request: APIRequestContext): Promise<ShareCtx> {
  const user = await registerNewUser(request, 'share');
  const workspaceId = await createWorkspace(request, user.token);
  const project = await createProject(request, user.token, workspaceId, {
    name: 'Share Test Project',
  });
  // Create an issue so the board has content.
  await createIssue(request, user.token, project.id, {
    title: 'Shared board issue',
  });
  const minted = await mintShareToken(request, user.token, project.id);
  return { user, project, minted };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Public share link', () => {
  test('public board loads without authentication', async ({
    page,
    request,
  }) => {
    const { minted } = await setupShareCtx(request);

    // Visit as an unauthenticated user (no login step).
    await page.goto(`/share/${minted.rawToken}`);

    // The read-only header is visible.
    await expect(
      page.getByTestId('shared-board-header'),
    ).toBeVisible({ timeout: 15_000 });

    // The read-only badge is shown.
    await expect(page.getByTestId('readonly-badge')).toBeVisible();
    await expect(page.getByTestId('readonly-badge')).toContainText(
      /read-only/i,
    );
  });

  test('public board shows project name and board columns', async ({
    page,
    request,
  }) => {
    const { project, minted } = await setupShareCtx(request);

    await page.goto(`/share/${minted.rawToken}`);
    await expect(page.getByTestId('shared-board-header')).toBeVisible({
      timeout: 15_000,
    });

    // Project name appears in the header.
    await expect(page.getByText(project.name)).toBeVisible();

    // The default status columns appear (seeded: To Do, In Progress, Done).
    await expect(page.getByText(/to do/i).first()).toBeVisible();
    await expect(page.getByText(/in progress/i).first()).toBeVisible();
    await expect(page.getByText(/done/i).first()).toBeVisible();
  });

  test('public board shows seeded issues without auth', async ({
    page,
    request,
  }) => {
    const { minted } = await setupShareCtx(request);

    await page.goto(`/share/${minted.rawToken}`);
    await expect(page.getByTestId('shared-board-header')).toBeVisible({
      timeout: 15_000,
    });

    // The issue we created should appear on the board.
    await expect(page.getByText('Shared board issue')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('revoked token shows error state, not the board', async ({
    page,
    request,
  }) => {
    const { user, project, minted } = await setupShareCtx(request);

    // Revoke the token before visiting.
    await revokeShareToken(request, user.token, project.id, minted.id);

    await page.goto(`/share/${minted.rawToken}`);

    // Should NOT show the board header.
    await expect(page.getByTestId('shared-board-header')).not.toBeVisible({
      timeout: 10_000,
    });

    // Should show an error / revoked message.
    await expect(
      page.getByText(/revoked|invalid|not found/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('totally invalid token shows error state', async ({ page }) => {
    await page.goto('/share/nls_completely_bogus_token_that_does_not_exist');

    await expect(page.getByTestId('shared-board-header')).not.toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText(/revoked|invalid|not found|unavailable/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('ADMIN can manage share links in Project Settings', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'share-settings');
    const workspaceId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, workspaceId, {
      name: 'Settings Share Test',
    });

    // Log in through the UI.
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/password/i).fill(user.password);
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    // Navigate to project settings.
    await page.goto(`/projects/${project.id}/settings`);
    // Scoped to <main>: the project is deliberately named "Settings Share
    // Test" (to test the Share section below), and that name is now ALSO
    // rendered as a sidebar nav link — an unscoped page-wide /settings/i
    // search is no longer unambiguous. `<main>` is the actual page content.
    await expect(page.locator('main').getByText(/settings/i).first()).toBeVisible({
      timeout: 10_000,
    });

    // The Share section is visible.
    await expect(page.getByText(/public share link/i)).toBeVisible();

    // Click "Create link".
    await page.getByTestId('create-share-token-btn').click();

    // The new-link banner appears with a URL.
    await expect(page.getByTestId('new-share-token-banner')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('share-token-url')).toContainText(/\/share\//);

    // A row appears in the token list.
    await expect(page.getByTestId('share-token-row')).toBeVisible({
      timeout: 5_000,
    });
  });

  test('mobile: public board renders without auth on small screen', async ({
    page,
    request,
  }) => {
    const { minted } = await setupShareCtx(request);

    await page.goto(`/share/${minted.rawToken}`);
    await expect(page.getByTestId('shared-board-header')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('readonly-badge')).toBeVisible();
    // Columns are present
    await expect(page.getByText(/to do/i).first()).toBeVisible();
  });
});

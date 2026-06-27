/**
 * e2e tests for Personal API Tokens (PATs).
 *
 * Runs on both chromium-desktop (1280x800) and mobile-chrome (Pixel 5) via
 * the playwright.config.ts project matrix.
 *
 * Covered flows:
 *   - UI: create token → raw token shown once with copy button + warning
 *   - UI: token appears in list after creation (metadata only, not raw token)
 *   - UI: revoke token via confirm dialog
 *   - UI: Profile settings accessible from user menu
 *   - API: a created PAT can authenticate a real API call (GET /api/auth/me)
 *   - API: a revoked PAT is rejected (401)
 *   - API: list returns metadata only — no rawToken or tokenHash
 *   - API: a user cannot revoke another user's token (404)
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { registerNewUser, API_URL } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTokenViaApi(
  request: APIRequestContext,
  jwt: string,
  name = 'CI token',
): Promise<{ id: string; rawToken: string }> {
  const res = await request.post(`${API_URL}/api/me/tokens`, {
    headers: { Authorization: `Bearer ${jwt}` },
    data: { name },
  });
  expect(res.ok(), `create token failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; rawToken: string };
  return body;
}

async function revokeTokenViaApi(
  request: APIRequestContext,
  jwt: string,
  tokenId: string,
): Promise<void> {
  const res = await request.delete(`${API_URL}/api/me/tokens/${tokenId}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  expect(res.ok(), `revoke failed: ${res.status()}`).toBeTruthy();
}

// ---------------------------------------------------------------------------
// UI tests — run on both desktop and mobile via project matrix
// ---------------------------------------------------------------------------

test.describe('API tokens UI', () => {
  test('create token shows raw value once with warning, then lists metadata only', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'pat-create');

    await page.goto('/login');
    await page.getByLabel(/email/i).pressSequentially(user.email);
    await page.getByLabel(/password/i).pressSequentially(user.password);
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    await page.goto('/me/settings');
    await expect(
      page.getByRole('heading', { name: 'Profile settings' }),
    ).toBeVisible();

    const section = page.locator('section').filter({ hasText: 'API tokens' });
    await expect(
      section.getByRole('heading', { name: 'API tokens' }),
    ).toBeVisible();

    // Open create modal.
    await section.getByRole('button', { name: '+ Create token' }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Create API token' }),
    ).toBeVisible();

    await dialog.getByLabel('Token name').pressSequentially('My CI token');
    await dialog.getByRole('button', { name: 'Create token' }).click();

    // Raw token is shown with warning.
    await expect(dialog.getByText('Copy your token now')).toBeVisible();
    const rawTokenEl = dialog.getByTestId('pat-raw-token');
    await expect(rawTokenEl).toBeVisible();
    const rawToken = await rawTokenEl.textContent();
    expect(rawToken).toBeTruthy();
    expect(rawToken!.startsWith('nlp_')).toBe(true);

    // Copy button is present.
    await expect(dialog.getByRole('button', { name: /copy/i })).toBeVisible();

    // Close the modal.
    await dialog.getByRole('button', { name: 'Done' }).click();

    // Token appears in the list.
    const row = section.getByTestId('pat-token-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('My CI token');
    await expect(row).toContainText('Active');

    // Raw token is NOT visible in the list.
    await expect(section.getByTestId('pat-raw-token')).not.toBeVisible();
  });

  test('revoke token via confirm dialog changes status to Revoked', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'pat-revoke');

    // Create a token via API so we have one to revoke.
    await createTokenViaApi(request, user.token, 'Token to revoke');

    await page.goto('/login');
    await page.getByLabel(/email/i).pressSequentially(user.email);
    await page.getByLabel(/password/i).pressSequentially(user.password);
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    await page.goto('/me/settings');

    const section = page.locator('section').filter({ hasText: 'API tokens' });
    const rows = section.getByTestId('pat-token-row');
    await expect(rows).toHaveCount(1);

    // Click revoke on the row.
    await rows.getByRole('button', { name: /revoke token/i }).click();

    // Confirm dialog appears.
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText('Revoke token');
    await expect(confirmDialog).toContainText('Token to revoke');

    await confirmDialog.getByRole('button', { name: 'Revoke token' }).click();

    // The row now shows "Revoked" status.
    await expect(rows.first()).toContainText('Revoked');
    await expect(
      rows.getByRole('button', { name: /revoke token/i }),
    ).not.toBeVisible();
  });

  test('Profile settings accessible from user avatar menu', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'pat-menu');

    await page.goto('/login');
    await page.getByLabel(/email/i).pressSequentially(user.email);
    await page.getByLabel(/password/i).pressSequentially(user.password);
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    // Click the user avatar menu button.
    await page.getByTestId('user-menu-button').click();

    // "Profile settings" link should appear.
    await page.getByRole('button', { name: 'Profile settings' }).click();
    await expect(page).toHaveURL(/\/me\/settings/, { timeout: 10_000 });
    await expect(
      page.getByRole('heading', { name: 'Profile settings' }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// API-level integration tests (no browser needed — run once on desktop project)
// ---------------------------------------------------------------------------

test.describe('PAT API integration', () => {
  test('a created PAT authenticates GET /api/auth/me as the owning user', async ({
    request,
  }) => {
    const user = await registerNewUser(request, 'pat-api-auth');
    const { rawToken } = await createTokenViaApi(request, user.token, 'auth-test');

    const res = await request.get(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });
    expect(res.ok(), `PAT auth failed: ${res.status()}`).toBeTruthy();
    const me = (await res.json()) as { email: string };
    expect(me.email).toBe(user.email);
  });

  test('a revoked PAT is rejected with 401', async ({ request }) => {
    const user = await registerNewUser(request, 'pat-api-revoke');
    const { id, rawToken } = await createTokenViaApi(request, user.token, 'revoke-test');

    const before = await request.get(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });
    expect(before.ok()).toBeTruthy();

    await revokeTokenViaApi(request, user.token, id);

    const after = await request.get(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });
    expect(after.status()).toBe(401);
  });

  test('list returns metadata only — never rawToken or tokenHash', async ({
    request,
  }) => {
    const user = await registerNewUser(request, 'pat-api-list');
    await createTokenViaApi(request, user.token, 'list-test');

    const res = await request.get(`${API_URL}/api/me/tokens`, {
      headers: { Authorization: `Bearer ${user.token}` },
    });
    expect(res.ok()).toBeTruthy();
    const tokens = (await res.json()) as Record<string, unknown>[];
    expect(tokens.length).toBeGreaterThan(0);
    for (const t of tokens) {
      expect(t.rawToken).toBeUndefined();
      expect(t.tokenHash).toBeUndefined();
    }
  });

  test("a user cannot revoke another user's token (404)", async ({
    request,
  }) => {
    const alice = await registerNewUser(request, 'pat-api-xuser-a');
    const bob = await registerNewUser(request, 'pat-api-xuser-b');

    const { id: aliceTokenId } = await createTokenViaApi(request, alice.token, 'alice-token');

    const res = await request.delete(
      `${API_URL}/api/me/tokens/${aliceTokenId}`,
      { headers: { Authorization: `Bearer ${bob.token}` } },
    );
    expect(res.status()).toBe(404);
  });
});

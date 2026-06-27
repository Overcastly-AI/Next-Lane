/**
 * e2e tests for PAT scope enforcement.
 *
 * Covered flows:
 *   API: scoped PAT (issues:read only) → 403 on issues:write route (POST /issues).
 *   API: scoped PAT (issues:read only) → 200 on issues:read route (GET /issues).
 *   API: unscoped PAT → passes any route (full owner perms, backward-compat).
 *   API: JWT token → passes any route (unrestricted).
 *   API: invalid scope string at creation → 400.
 *   UI:  scope checkboxes appear in the create-token modal.
 *   UI:  created token with scopes shows scope pills in the list.
 *   UI:  unrestricted token shows "Unrestricted" label.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  registerNewUser,
  createWorkspace,
  createProject,
  API_URL,
} from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTokenViaApi(
  request: APIRequestContext,
  jwt: string,
  name: string,
  scopes: string[] = [],
): Promise<{ id: string; rawToken: string; scopes: string[] }> {
  const res = await request.post(`${API_URL}/api/me/tokens`, {
    headers: { Authorization: `Bearer ${jwt}` },
    data: { name, scopes },
  });
  expect(res.ok(), `create token failed (${res.status()}): ${await res.text()}`).toBeTruthy();
  return res.json() as Promise<{ id: string; rawToken: string; scopes: string[] }>;
}

// ---------------------------------------------------------------------------
// API-level scope enforcement tests (no browser, run once on desktop project)
// ---------------------------------------------------------------------------

test.describe('PAT scopes — API enforcement', () => {
  test('scoped PAT (issues:read) is rejected (403) on an issue-write route', async ({
    request,
  }) => {
    const user = await registerNewUser(request, 'scope-write-403');
    const { rawToken } = await createTokenViaApi(
      request,
      user.token,
      'read-only CI',
      ['issues:read'],
    );

    // Need a project to create an issue in.
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);

    // POST /issues with an issues:read-only PAT should be 403.
    const res = await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${rawToken}` },
      data: { projectId: project.id, title: 'Should be rejected' },
    });
    expect(res.status()).toBe(403);
  });

  test('scoped PAT (issues:read) is accepted (2xx) on an issue-read route', async ({
    request,
  }) => {
    const user = await registerNewUser(request, 'scope-read-ok');
    const { rawToken } = await createTokenViaApi(
      request,
      user.token,
      'read-only CI',
      ['issues:read'],
    );

    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);

    // GET /issues with an issues:read PAT should succeed.
    const res = await request.get(
      `${API_URL}/api/issues?projectId=${project.id}`,
      {
        headers: { Authorization: `Bearer ${rawToken}` },
      },
    );
    expect(res.ok(), `Expected 2xx, got ${res.status()}`).toBeTruthy();
  });

  test('unscoped PAT passes any route (full owner perms, backward-compat)', async ({
    request,
  }) => {
    const user = await registerNewUser(request, 'scope-unscoped');
    // Create an unscoped token (no scopes arg → defaults to []).
    const { rawToken } = await createTokenViaApi(
      request,
      user.token,
      'unscoped token',
      [],
    );

    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);

    // POST /issues with an unscoped PAT should succeed.
    const res = await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${rawToken}` },
      data: { projectId: project.id, title: 'Unscoped token issue' },
    });
    expect(res.ok(), `Expected 2xx, got ${res.status()}`).toBeTruthy();
  });

  test('JWT token passes any route (unrestricted, no patScopes)', async ({
    request,
  }) => {
    const user = await registerNewUser(request, 'scope-jwt');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);

    // JWT (user.token) should pass a write route.
    const res = await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${user.token}` },
      data: { projectId: project.id, title: 'JWT issue' },
    });
    expect(res.ok(), `Expected 2xx, got ${res.status()}`).toBeTruthy();
  });

  test('creation with an invalid scope string is rejected 400', async ({
    request,
  }) => {
    const user = await registerNewUser(request, 'scope-invalid');
    const res = await request.post(`${API_URL}/api/me/tokens`, {
      headers: { Authorization: `Bearer ${user.token}` },
      data: { name: 'bad scopes', scopes: ['admin:all'] },
    });
    expect(res.status()).toBe(400);
  });

  test('creation response includes the scopes array', async ({ request }) => {
    const user = await registerNewUser(request, 'scope-response');
    const { scopes } = await createTokenViaApi(
      request,
      user.token,
      'scoped token',
      ['issues:read', 'projects:read'],
    );
    expect(scopes).toEqual(expect.arrayContaining(['issues:read', 'projects:read']));
    expect(scopes).toHaveLength(2);
  });

  test('list response includes scopes on each token', async ({ request }) => {
    const user = await registerNewUser(request, 'scope-list');
    await createTokenViaApi(request, user.token, 'tok-scoped', ['issues:read']);
    await createTokenViaApi(request, user.token, 'tok-unscoped', []);

    const res = await request.get(`${API_URL}/api/me/tokens`, {
      headers: { Authorization: `Bearer ${user.token}` },
    });
    expect(res.ok()).toBeTruthy();
    const tokens = (await res.json()) as Array<{ name: string; scopes: string[] }>;
    const scoped = tokens.find((t) => t.name === 'tok-scoped');
    const unscoped = tokens.find((t) => t.name === 'tok-unscoped');
    expect(scoped?.scopes).toEqual(['issues:read']);
    expect(unscoped?.scopes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// UI tests — scope checkboxes and display
// ---------------------------------------------------------------------------

test.describe('PAT scopes — UI', () => {
  test('scope checkboxes appear in the create-token modal', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'scope-ui-checkboxes');

    await page.goto('/login');
    await page.getByLabel(/email/i).pressSequentially(user.email);
    await page.getByLabel(/password/i).pressSequentially(user.password);
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    await page.goto('/me/settings');
    const section = page.locator('section').filter({ hasText: 'API tokens' });
    await section.getByRole('button', { name: '+ Create token' }).click();

    const dialog = page.getByRole('dialog');
    const checkboxes = dialog.getByTestId('pat-scope-checkboxes');
    await expect(checkboxes).toBeVisible();

    // Check that key scope checkboxes are present.
    await expect(dialog.getByTestId('pat-scope-issues:read')).toBeVisible();
    await expect(dialog.getByTestId('pat-scope-issues:write')).toBeVisible();
    await expect(dialog.getByTestId('pat-scope-webhooks:write')).toBeVisible();
  });

  test('created scoped token shows scope pills in the list', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'scope-ui-pills');

    // Create a scoped token via API (faster than UI flow).
    await request.post(`${API_URL}/api/me/tokens`, {
      headers: { Authorization: `Bearer ${user.token}` },
      data: { name: 'Scoped token', scopes: ['issues:read', 'projects:read'] },
    });

    await page.goto('/login');
    await page.getByLabel(/email/i).pressSequentially(user.email);
    await page.getByLabel(/password/i).pressSequentially(user.password);
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    await page.goto('/me/settings');
    const section = page.locator('section').filter({ hasText: 'API tokens' });

    const row = section.getByTestId('pat-token-row').first();
    await expect(row).toBeVisible();

    // Scope pills should appear inside the row.
    const scopePills = row.getByTestId('pat-scopes');
    await expect(scopePills).toBeVisible();
    await expect(scopePills).toContainText('Issues');
    await expect(scopePills).toContainText('Projects');
  });

  test('unrestricted token shows "Unrestricted" label in the list', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'scope-ui-unrestricted');

    // Create an unscoped token via API.
    await request.post(`${API_URL}/api/me/tokens`, {
      headers: { Authorization: `Bearer ${user.token}` },
      data: { name: 'Unrestricted token' },
    });

    await page.goto('/login');
    await page.getByLabel(/email/i).pressSequentially(user.email);
    await page.getByLabel(/password/i).pressSequentially(user.password);
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    await page.goto('/me/settings');
    const section = page.locator('section').filter({ hasText: 'API tokens' });

    const row = section.getByTestId('pat-token-row').first();
    await expect(row).toBeVisible();
    await expect(row.getByTestId('pat-scopes-unrestricted')).toBeVisible();
    await expect(row.getByTestId('pat-scopes-unrestricted')).toContainText('Unrestricted');
  });

  test('create-token modal UI flow with scope selection', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'scope-ui-flow');

    await page.goto('/login');
    await page.getByLabel(/email/i).pressSequentially(user.email);
    await page.getByLabel(/password/i).pressSequentially(user.password);
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    await page.goto('/me/settings');
    const section = page.locator('section').filter({ hasText: 'API tokens' });
    await section.getByRole('button', { name: '+ Create token' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Token name').pressSequentially('Read-only CI');

    // Check the issues:read scope.
    await dialog.getByTestId('pat-scope-issues:read').check();
    await expect(dialog.getByTestId('pat-scope-issues:read')).toBeChecked();

    await dialog.getByRole('button', { name: 'Create token' }).click();

    // Raw token shown.
    await expect(dialog.getByText('Copy your token now')).toBeVisible();
    await expect(dialog.getByTestId('pat-raw-token')).toBeVisible();

    // Scopes shown in result view.
    await expect(dialog.getByText(/issues.*read/i)).toBeVisible();

    await dialog.getByRole('button', { name: 'Done' }).click();

    // Scope pills visible in the list row.
    const row = section.getByTestId('pat-token-row').first();
    await expect(row.getByTestId('pat-scopes')).toBeVisible();
  });
});

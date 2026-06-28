/**
 * workspace-branding.spec.ts
 *
 * End-to-end tests for workspace branding (logo + accent color):
 *   - Setting a brand color re-themes the app via the --nl-signal-* CSS vars.
 *   - The branding settings page is reachable by a workspace admin.
 *   - Uploading a logo makes it render in the app header.
 * Drives the real API + the runtime theming layer.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  login,
  registerNewUser,
  createWorkspace,
  API_URL,
} from './helpers';

// 1×1 transparent PNG.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function setBrandColor(
  request: APIRequestContext,
  token: string,
  wsId: string,
  color: string | null,
) {
  const res = await request.patch(`${API_URL}/api/workspaces/${wsId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { brandColor: color },
  });
  expect(res.ok(), `patch brandColor failed: ${res.status()}`).toBeTruthy();
}

test.describe('Workspace branding — desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('brand color re-themes the signal CSS variable', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'brand-color');
    const wsId = await createWorkspace(request, user.token);
    await setBrandColor(request, user.token, wsId, '#7C3AED');

    await login(page, { email: user.email, password: user.password });
    // The workspace-scoped branding page sets that workspace active → theme applies.
    await page.goto(`/workspaces/${wsId}/branding`);
    await expect(page.getByTestId('branding-settings')).toBeVisible({
      timeout: 15_000,
    });

    // The 600 anchor var should now be the brand color, not the default cobalt.
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--nl-signal-600')
        .trim()
        .toLowerCase(),
    );
    expect(accent).toContain('7c3aed');
    expect(accent).not.toContain('2563eb');
  });

  test('default workspace (no brand color) keeps the default accent', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'brand-default');
    const wsId = await createWorkspace(request, user.token);

    await login(page, { email: user.email, password: user.password });
    await page.goto(`/workspaces/${wsId}/branding`);
    await expect(page.getByTestId('branding-settings')).toBeVisible({
      timeout: 15_000,
    });
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--nl-signal-600')
        .trim()
        .toLowerCase(),
    );
    // Default cobalt.
    expect(accent).toContain('2563eb');
  });

  test('admin can set a brand color through the UI', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'brand-ui');
    const wsId = await createWorkspace(request, user.token);

    await login(page, { email: user.email, password: user.password });
    await page.goto(`/workspaces/${wsId}/branding`);
    await expect(page.getByTestId('branding-settings')).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId('brand-color-input').fill('#16A34A');
    await page.getByTestId('brand-color-save').click();

    // Theme updates without a reload.
    await expect
      .poll(
        async () =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue('--nl-signal-600')
              .trim()
              .toLowerCase(),
          ),
        { timeout: 8_000 },
      )
      .toContain('16a34a');
  });

  test('uploading a logo renders it in the header', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'brand-logo');
    const wsId = await createWorkspace(request, user.token);

    await login(page, { email: user.email, password: user.password });
    await page.goto(`/workspaces/${wsId}/branding`);
    await expect(page.getByTestId('branding-settings')).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId('logo-upload-input').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: PNG_1x1,
    });

    // The header logo appears once the upload completes + workspace refetches.
    await expect(page.getByTestId('workspace-logo')).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe('Workspace branding — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('branding settings render without horizontal overflow', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'brand-mobile');
    const wsId = await createWorkspace(request, user.token);

    await login(page, { email: user.email, password: user.password });
    await page.goto(`/workspaces/${wsId}/branding`);
    await expect(page.getByTestId('branding-settings')).toBeVisible({
      timeout: 15_000,
    });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

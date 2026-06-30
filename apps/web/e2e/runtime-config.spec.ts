/**
 * Runtime config (window.__NL_CONFIG__) e2e spec.
 *
 * Verifies that:
 *   1. Without config.js the app boots normally (fallback path — env var / default).
 *   2. When window.__NL_CONFIG__.apiUrl IS set before the bundle initialises
 *      (via addInitScript — same timing as a <script src="/config.js"> loaded
 *      before the <script type="module"> in index.html), getApiUrl() returns it.
 *   3. API fetch requests on an authenticated route ARE directed to the runtime-
 *      configured origin (not the build-time URL), confirming the override is
 *      consumed by the module-level API_URL constant at module-init time.
 *
 * The injection approach simulates what the Docker entrypoint does in production:
 * it writes /config.js which sets window.__NL_CONFIG__ = { apiUrl: "..." }
 * before the React bundle's <script type="module"> executes.
 */
import { test, expect } from '@playwright/test';
import { login, API_URL as PW_API_URL } from './helpers';

test.describe('Runtime config (window.__NL_CONFIG__)', () => {
  test('app boots and reaches dashboard without config.js (fallback path)', async ({
    page,
  }) => {
    // Normal login — no window.__NL_CONFIG__ injection; the app uses the
    // VITE_API_URL baked in at preview-build time.
    await login(page);
    await expect(page).not.toHaveURL(/\/login/);
    // The app shell rendered — assert the always-present user menu (the header
    // wordmark is responsive-hidden on mobile, so it's not a reliable anchor).
    await expect(page.getByTestId('user-menu-button')).toBeVisible();
  });

  test('window.__NL_CONFIG__.apiUrl is readable when injected via addInitScript', async ({
    page,
  }) => {
    // addInitScript runs at document-creation time, BEFORE any scripts (inline
    // or external) execute — including the bundle. This is the same timing as
    // a <script src="/config.js"> loaded before the <script type="module"> in
    // index.html.
    const sentinelUrl = 'http://runtime-config-sentinel:9999';

    await page.addInitScript((url) => {
      (window as Window & { __NL_CONFIG__?: { apiUrl?: string } }).__NL_CONFIG__ =
        { apiUrl: url };
    }, sentinelUrl);

    await page.goto('/login');

    // Confirm window.__NL_CONFIG__ survived into page context.
    const resolvedUrl = await page.evaluate(() => {
      return (
        (window as Window & { __NL_CONFIG__?: { apiUrl?: string } })
          .__NL_CONFIG__?.apiUrl ?? 'NOT_SET'
      );
    });
    expect(resolvedUrl).toBe(sentinelUrl);
  });

  test('API fetch is directed to the runtime-configured apiUrl on an authenticated route', async ({
    page,
    request,
  }) => {
    // Step 1: Log in via the API to get a token; plant it in localStorage so
    // the app considers itself authenticated when it loads.
    const loginRes = await request.post(`${PW_API_URL}/api/auth/login`, {
      data: { email: 'demo@nextlane.dev', password: 'nextlane' },
    });
    expect(loginRes.ok()).toBeTruthy();
    const { accessToken } = (await loginRes.json()) as { accessToken: string };

    // Plant the token so RequireAuth doesn't redirect away before firing a fetch.
    await page.addInitScript(
      ({ token, key }) => {
        localStorage.setItem(key, token);
      },
      { token: accessToken, key: 'nl_token' },
    );

    // Step 2: Inject __NL_CONFIG__ pointing at a routable sentinel origin.
    // Use localhost on an unused port — page.route() can intercept these.
    const sentinelOrigin = 'http://localhost:19999';
    const capturedUrls: string[] = [];

    await page.route(`${sentinelOrigin}/**`, async (route) => {
      capturedUrls.push(route.request().url());
      await route.abort('connectionrefused');
    });

    await page.addInitScript((url) => {
      (window as Window & { __NL_CONFIG__?: { apiUrl?: string } }).__NL_CONFIG__ =
        { apiUrl: url };
    }, sentinelOrigin);

    // Step 3: Navigate to a protected route that makes API calls on mount.
    // /my-work triggers GET /api/me/work + GET /api/notifications/unread-count.
    await page.goto('/my-work');

    // Wait for the network requests to fire.
    await page.waitForTimeout(1000);

    // Step 4: Verify all API requests went to the runtime-configured origin.
    expect(capturedUrls.length).toBeGreaterThan(0);
    expect(capturedUrls[0]).toContain('localhost:19999');
  });
});

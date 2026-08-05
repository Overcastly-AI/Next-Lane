/**
 * admin-sso-settings.spec.ts
 *
 * In-app SSO/OIDC admin configuration screen (`/admin/sso`) — lets an
 * instance admin configure SSO from a settings page instead of an env-var
 * edit + API redeploy.
 *
 * Covers:
 *   1. A non-instance-admin gets no sidebar nav entry AND an access-denied
 *      state when navigating to the route directly (the client-side
 *      equivalent of the server's 403 — `GET /admin/oidc-config` really does
 *      403 for them, this UI state is what that becomes on screen).
 *   2. The instance admin (the seeded `demo@nextlane.dev` user — the first
 *      user ever created in this DB, per `AuthService.register`'s
 *      isFirstUser rule / the seed script's explicit `isInstanceAdmin: true`)
 *      configures + enables SSO via the form, with per-keystroke typing.
 *   3. The login page's "Continue with <label>" button appears after
 *      enabling — with NO API restart — because `GET /auth/providers`
 *      reflects the live effective config. The configured issuer URL is
 *      deliberately unreachable (no real IdP in this environment); the
 *      acceptance bar is that an enabled config surfaces the button, not
 *      that a full OIDC login round-trip succeeds (that's covered against a
 *      mocked `openid-client` in `oidc.service.spec.ts`).
 *
 * `OidcConfig` is a single global (instance-level) row, unlike every other
 * fixture in this suite which is tenant-isolated per test via
 * `setupIsolatedProject`. ALL config-mutating tests below (desktop AND
 * mobile) share ONE `serial` describe block — Playwright's serial mode runs
 * every test in a describe, including nested describes, in file order in a
 * single worker — so desktop/mobile assertions never race each other on the
 * shared singleton row, and the suite always leaves the config back at
 * `enabled: false` before finishing, specifically so `sso.spec.ts`'s
 * "disabled when unconfigured" assertions and the password-login specs never
 * observe SSO enabled mid-run.
 */
import { test, expect } from '@playwright/test';
import { DEMO, login, registerNewUser, API_URL } from './helpers';

const UNIQUE = Date.now();
const ISSUER_URL = `http://localhost:9/fake-issuer-${UNIQUE}`;
const CLIENT_ID = `client-${UNIQUE}`;
const CLIENT_SECRET = `super-secret-${UNIQUE}`;
const LABEL = `Test IdP ${UNIQUE}`;

/** Reset the instance SSO config back to a clean disabled state via the API (demo is the instance admin). */
async function resetOidcConfig(request: import('@playwright/test').APIRequestContext): Promise<void> {
  const loginRes = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: DEMO.email, password: DEMO.password },
  });
  const { accessToken } = (await loginRes.json()) as { accessToken: string };
  await request.patch(`${API_URL}/api/admin/oidc-config`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { enabled: false },
  });
}

// ---------------------------------------------------------------------------
// Non-admin: no nav entry, access denied on the route. Fully tenant-isolated
// (fresh registered users) — safe to run in parallel with everything else.
// ---------------------------------------------------------------------------

test.describe('Admin SSO settings — non-admin — desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('a freshly-registered (non-instance-admin) user sees no sidebar entry and an access-denied state on the route', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'sso-nonadmin');
    await login(page, { email: user.email, password: user.password });

    // No nav entry anywhere in the DOM (the sidebar's desktop rail is always
    // mounted — hidden via CSS below `lg`, not conditionally rendered — so
    // this assertion is viewport-independent).
    await expect(page.getByTestId('nav-sidebar-admin-sso')).toHaveCount(0);

    // Direct navigation to the route is blocked with an access-denied state,
    // not the form (mirrors what the server's 403 on GET /admin/oidc-config
    // becomes on screen).
    await page.goto('/admin/sso');
    await expect(page.getByTestId('admin-sso-access-denied')).toBeVisible();
    await expect(page.getByTestId('admin-sso-form')).toHaveCount(0);
  });
});

test.describe('Admin SSO settings — non-admin — mobile', () => {
  test.use({ viewport: { width: 393, height: 852 } });

  test('a freshly-registered (non-instance-admin) user sees no sidebar entry and an access-denied state on the route', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'sso-nonadmin-m');
    await login(page, { email: user.email, password: user.password });

    await expect(page.getByTestId('nav-sidebar-admin-sso')).toHaveCount(0);

    await page.goto('/admin/sso');
    await expect(page.getByTestId('admin-sso-access-denied')).toBeVisible();
    await expect(page.getByTestId('admin-sso-form')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Instance admin: configure + enable, verify live effect on the login page.
// ONE serial group spanning desktop + mobile — see file header for why.
// ---------------------------------------------------------------------------

test.describe('Admin SSO settings — instance admin (serial: desktop then mobile)', () => {
  test.describe.configure({ mode: 'serial' });

  // These tests mutate a truly global singleton row (OidcConfig), unlike
  // every other tenant-isolated fixture in this suite. `serial` mode only
  // serializes tests WITHIN one Playwright project's run of this file — the
  // `chromium-desktop` and `mobile-chrome` projects each run the whole file
  // independently and DO race each other on this shared row (reproduced:
  // running both concurrently flipped `enabled` mid-sequence). Both
  // viewports are already covered via the nested `desktop`/`mobile`
  // sub-describes' explicit `test.use({ viewport })` below, all within one
  // project — so restricting this describe to a single project loses no
  // coverage, only the unsafe cross-project concurrency.
  test.beforeEach(async ({}, testInfo) => {
    if (testInfo.project.name !== 'chromium-desktop') test.skip();
  });

  test.beforeAll(async ({ request }) => {
    await resetOidcConfig(request);
  });

  test.afterAll(async ({ request }) => {
    await resetOidcConfig(request);
  });

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('the user menu, not the sidebar, is how an instance admin reaches SSO', async ({
      page,
    }) => {
      await login(page, DEMO);

      /*
       * SSO used to own a labelled sidebar group, permanently, for something
       * you configure once when you stand the instance up. Founder: "why is
       * the SSO / OIDC in the main navigation?? This should be on a settings
       * page." It moved to "Instance settings" in the user menu — the
       * conventional home for instance-wide administration — behind `/admin`,
       * which lands on the SSO page while it is the only section.
       */
      await expect(page.getByTestId('nav-sidebar-admin-sso')).toHaveCount(0);

      await page.getByTestId('user-menu-button').click();
      const entry = page.getByTestId('user-menu-instance-settings');
      await expect(entry).toBeVisible({ timeout: 5_000 });
      await entry.click();

      await expect(page).toHaveURL(/\/admin\/sso/);
      await expect(page.getByTestId('admin-sso-form')).toBeVisible();
    });

    test('configuring + enabling SSO persists across reload and shows an unsaved-changes indicator while dirty', async ({
      page,
    }) => {
      await login(page, DEMO);
      await page.goto('/admin/sso');
      const form = page.getByTestId('admin-sso-form');
      await expect(form).toBeVisible();

      // Not env-managed in this environment (no OIDC_* env vars set) — the
      // form must be live/editable, not the read-only banner state.
      await expect(page.getByTestId('admin-sso-env-managed-banner')).toHaveCount(0);

      const issuerInput = page.getByLabel('Issuer URL');
      const clientIdInput = page.getByLabel('Client ID');
      const secretInput = page.getByLabel('Client secret');
      const labelInput = page.getByLabel('Button label');

      // Per-keystroke typing (not .fill()) — clears any prior value first.
      for (const input of [issuerInput, clientIdInput, secretInput, labelInput]) {
        await input.click();
        await input.press('Control+A');
        await input.press('Backspace');
      }
      await issuerInput.pressSequentially(ISSUER_URL, { delay: 10 });
      await clientIdInput.pressSequentially(CLIENT_ID, { delay: 10 });
      await secretInput.pressSequentially(CLIENT_SECRET, { delay: 10 });
      await labelInput.pressSequentially(LABEL, { delay: 10 });

      // Unsaved-changes guard: visible while dirty.
      await expect(page.getByTestId('admin-sso-unsaved-indicator')).toBeVisible();

      // Turn SSO on.
      const toggle = page.getByTestId('admin-sso-enabled-toggle');
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');

      await page.getByTestId('admin-sso-save').click();

      // Success toast, then the unsaved indicator clears.
      await expect(page.getByRole('status').filter({ hasText: /saved/i })).toBeVisible({
        timeout: 8_000,
      });
      await expect(page.getByTestId('admin-sso-unsaved-indicator')).toHaveCount(0);

      // Secret field reverts to the "saved" placeholder, never re-displaying
      // the value that was just typed.
      await expect(secretInput).toHaveValue('');
      await expect(secretInput).toHaveAttribute('placeholder', '••• saved');

      // Reload — every field reflects the persisted config (secret excepted).
      await page.reload();
      await expect(form).toBeVisible();
      await expect(page.getByLabel('Issuer URL')).toHaveValue(ISSUER_URL);
      await expect(page.getByLabel('Client ID')).toHaveValue(CLIENT_ID);
      await expect(page.getByLabel('Button label')).toHaveValue(LABEL);
      await expect(page.getByTestId('admin-sso-enabled-toggle')).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByLabel('Client secret')).toHaveAttribute('placeholder', '••• saved');
    });

    test('the login page shows the "Continue with <label>" SSO button after enabling — no API restart', async ({
      page,
    }) => {
      // Config was enabled by the previous (serial) test; open a fresh,
      // logged-out context via the login page and confirm the live probe
      // reflects it immediately.
      const providersResponse = page.waitForResponse((res) =>
        res.url().includes('/api/auth/providers'),
      );
      await page.goto('/login');
      const res = await providersResponse;
      const body = await res.json();
      expect(body.oidc.enabled).toBe(true);
      expect(body.oidc.label).toBe(LABEL);

      await expect(page.getByTestId('sso-login-button')).toBeVisible();
      await expect(page.getByTestId('sso-login-button')).toContainText(`Continue with ${LABEL}`);
    });

    test('disabling SSO from the settings screen removes the login-page button immediately', async ({ page }) => {
      await login(page, DEMO);
      await page.goto('/admin/sso');
      const toggle = page.getByTestId('admin-sso-enabled-toggle');
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await toggle.click();
      await page.getByTestId('admin-sso-save').click();
      await expect(page.getByRole('status').filter({ hasText: /saved/i })).toBeVisible({
        timeout: 8_000,
      });

      const providersResponse = page.waitForResponse((res) =>
        res.url().includes('/api/auth/providers'),
      );
      await page.goto('/login');
      const res = await providersResponse;
      const body = await res.json();
      expect(body.oidc.enabled).toBe(false);
      await expect(page.getByTestId('sso-login-button')).toHaveCount(0);
    });
  });

  test.describe('mobile', () => {
    test.use({ viewport: { width: 393, height: 852 } });

    test('configuring + enabling SSO via the user menu, no horizontal overflow', async ({ page }) => {
      await login(page, DEMO);

      // The user menu is the only route in now, on mobile as on desktop.
      await page.getByTestId('user-menu-button').click();
      await page.getByTestId('user-menu-instance-settings').click();
      await expect(page).toHaveURL(/\/admin\/sso/);

      const form = page.getByTestId('admin-sso-form');
      await expect(form).toBeVisible();

      // No horizontal scroll/overflow at 393px.
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

      const issuerInput = page.getByLabel('Issuer URL');
      const clientIdInput = page.getByLabel('Client ID');
      const secretInput = page.getByLabel('Client secret');

      for (const input of [issuerInput, clientIdInput, secretInput]) {
        await input.click();
        await input.press('Control+A');
        await input.press('Backspace');
      }
      await issuerInput.pressSequentially(`${ISSUER_URL}-mobile`, { delay: 10 });
      await clientIdInput.pressSequentially(`${CLIENT_ID}-mobile`, { delay: 10 });
      await secretInput.pressSequentially(`${CLIENT_SECRET}-mobile`, { delay: 10 });

      await page.getByTestId('admin-sso-enabled-toggle').click();
      await page.getByTestId('admin-sso-save').click();
      await expect(page.getByRole('status').filter({ hasText: /saved/i })).toBeVisible({
        timeout: 8_000,
      });

      await expect(page.getByTestId('admin-sso-enabled-toggle')).toHaveAttribute('aria-checked', 'true');
    });

    test('the login page shows the SSO button on a fresh mobile load', async ({ page }) => {
      const providersResponse = page.waitForResponse((res) =>
        res.url().includes('/api/auth/providers'),
      );
      await page.goto('/login');
      const res = await providersResponse;
      const body = await res.json();
      expect(body.oidc.enabled).toBe(true);
      await expect(page.getByTestId('sso-login-button')).toBeVisible();
    });

    test('disabling from the mobile drawer nav removes the login-page button', async ({ page }) => {
      await login(page, DEMO);
      await page.goto('/admin/sso');
      const toggle = page.getByTestId('admin-sso-enabled-toggle');
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await toggle.click();
      await page.getByTestId('admin-sso-save').click();
      await expect(page.getByRole('status').filter({ hasText: /saved/i })).toBeVisible({
        timeout: 8_000,
      });

      const providersResponse = page.waitForResponse((res) =>
        res.url().includes('/api/auth/providers'),
      );
      await page.goto('/login');
      const res = await providersResponse;
      const body = await res.json();
      expect(body.oidc.enabled).toBe(false);
      await expect(page.getByTestId('sso-login-button')).toHaveCount(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Env-managed read-only banner — this test process cannot itself set the
// running API's env vars, so the banner's live rendering isn't exercised
// end-to-end here. What IS covered: `AdminSsoSettingsPage.tsx` renders the
// banner purely off `OidcConfigDto.envManaged`, whose env branch (env wins
// over DB, `hasClientSecret: true`, secret never serialized) is unit-tested
// in `oidc-config.service.spec.ts`; the server-side rejection of a write
// while env-pinned is unit-tested in `admin-settings.service.spec.ts`'s
// "env-pinned deployments" suite. No further e2e coverage is possible for a
// state that requires a deploy-time env var this sandboxed environment
// cannot toggle without restarting the API mid-suite.
// ---------------------------------------------------------------------------

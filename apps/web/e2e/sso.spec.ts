import { test, expect } from '@playwright/test';
import { API_URL } from './helpers';

/**
 * SSO/OIDC — Phase 1 (generic OIDC login provider).
 *
 * The running dev/CI API has no OIDC_ISSUER_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET
 * configured (there is no real IdP available in this environment), so the
 * only honestly-testable slice here is the "disabled" contract: the login
 * surface must not offer SSO when the API reports it unconfigured, and the
 * backend endpoints must not be reachable. Full IdP round-trip coverage
 * (authorization redirect, callback, JIT provisioning) is unit-tested against
 * a mocked `openid-client` in `apps/api/src/auth/oidc/oidc.service.spec.ts`.
 */
test.describe('SSO/OIDC (disabled — no provider configured in this environment)', () => {
  test('LoginPage does not render an SSO button when the API reports oidc disabled', async ({ page }) => {
    const providersResponse = page.waitForResponse((res) =>
      res.url().includes('/api/auth/providers'),
    );
    await page.goto('/login');
    const res = await providersResponse;
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.oidc.enabled).toBe(false);

    // The email/password form is present as always...
    await expect(page.getByLabel(/email/i)).toBeVisible();
    // ...but no SSO button, no "or" divider between it and the password form.
    await expect(page.getByTestId('sso-login-button')).toHaveCount(0);
    await expect(page.getByRole('separator')).toHaveCount(0);
    await expect(page.getByText(/continue with/i)).toHaveCount(0);
  });

  test('the OIDC login/callback endpoints 404 when unconfigured (feature fully absent, not just hidden)', async ({
    request,
  }) => {
    const loginRes = await request.get(`${API_URL}/api/auth/oidc/login`, { maxRedirects: 0 });
    expect(loginRes.status()).toBe(404);

    const callbackRes = await request.get(`${API_URL}/api/auth/oidc/callback?state=x&code=y`, {
      maxRedirects: 0,
    });
    expect(callbackRes.status()).toBe(404);
  });
});

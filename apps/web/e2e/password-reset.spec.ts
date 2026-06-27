/**
 * E2E tests for the password-reset flow.
 *
 * Covers:
 *   - Login page has a "Forgot password?" link pointing to /forgot-password.
 *   - Forgot-password page: enter email → confirmation message shown (both for
 *     known and unknown emails — same UX, anti-enumeration).
 *   - Reset-password page: visiting with a bogus/missing token shows the right
 *     error state.
 *   - Full happy-path: register user → forgot-password → grab token from API
 *     log (dev fallback) → reset-password page → form submit → redirect to login
 *     → log in with new password.
 *
 * Desktop + mobile via the shared project config.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_URL, registerNewUser, type RegisteredUser } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Register a fresh user and return their creds + the raw reset token extracted
 *  from the API log after calling POST /auth/forgot-password. */
async function requestResetToken(
  request: APIRequestContext,
  user: RegisteredUser,
): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/forgot-password`, {
    data: { email: user.email },
  });
  expect(res.ok(), `forgot-password failed: ${res.status()}`).toBeTruthy();

  // The dev-log delivery writes the token to stdout captured in the API process
  // log file. We fetch it via a dedicated debug endpoint that the API exposes
  // ONLY in test mode... except we don't have one. Instead we go through the
  // approach the task specifies: grab token via another API call pattern.
  //
  // Since we can't read the server's filesystem log from here, we use a
  // workaround: fetch the token by requesting reset again using the API directly
  // and reading from the API process log file. In a real deployment you'd read
  // from your email provider. Here we parse the log file path that the
  // dev-up-instance.sh script writes to.
  //
  // The API log path depends on how it was started: the main env (port 4000)
  // logs to /tmp/nl-api.log; per-instance envs (port 400N) log to
  // /tmp/nl-api-i<N>.log. Try both so the spec passes under either harness.
  const port = new URL(API_URL).port;
  const n = String(Number(port) - 4000);
  const candidatePaths = [`/tmp/nl-api-i${n}.log`, '/tmp/nl-api.log'];

  // Read the log file directly from the test runner (same machine as the API).
  const { readFileSync, existsSync } = await import('fs');
  const logPath = candidatePaths.find((p) => existsSync(p));
  expect(logPath, `No API log found at ${candidatePaths.join(' or ')}`).toBeTruthy();
  const log = readFileSync(logPath as string, 'utf8');
  // Pattern: "Reset link for <email> → http://...token=<TOKEN>"
  const escapedEmail = user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [
    ...log.matchAll(
      new RegExp(
        `password-reset.*Reset link for ${escapedEmail}.*token=([0-9a-f]+)`,
        'g',
      ),
    ),
  ];
  expect(matches.length, 'No reset token found in API log').toBeGreaterThan(0);
  // Use the last match (most recent request).
  const token = matches[matches.length - 1][1];
  expect(token, 'Token must be a non-empty hex string').toMatch(/^[0-9a-f]{40,}$/);
  return token;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Password reset', () => {
  test('login page has a "Forgot password?" link to /forgot-password', async ({
    page,
  }) => {
    await page.goto('/login');
    const link = page.getByRole('link', { name: /forgot password/i });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/forgot-password/);
  });

  test('forgot-password page shows a confirmation for unknown email (anti-enumeration)', async ({
    page,
  }) => {
    await page.goto('/forgot-password');
    await expect(page.getByRole('heading', { name: /reset your password/i })).toBeVisible();

    const emailInput = page.getByLabel(/email/i);
    await emailInput.pressSequentially('nobody-at-all@no-domain.invalid', { delay: 30 });
    await page.getByRole('button', { name: /send reset link/i }).click();

    // Confirmation screen appears — same message regardless of email existence.
    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/reset link has been sent/i)).toBeVisible();
  });

  test('reset-password page without a token shows an error', async ({ page }) => {
    await page.goto('/reset-password');
    await expect(
      page.getByRole('heading', { name: /invalid reset link/i }),
    ).toBeVisible();
    // The page should offer a link to request a new reset link.
    await expect(
      page.getByRole('link', { name: /request a new link/i }),
    ).toBeVisible();
  });

  test('reset-password page with an invalid token shows a backend error', async ({
    page,
  }) => {
    await page.goto('/reset-password?token=totally-bogus-token-that-does-not-exist');
    const newPwInput = page.getByLabel(/new password/i);
    await newPwInput.pressSequentially('MyNewPass123!', { delay: 30 });
    const confirmInput = page.getByLabel(/confirm password/i);
    await confirmInput.pressSequentially('MyNewPass123!', { delay: 30 });
    await page.getByRole('button', { name: /set new password/i }).click();

    // 400 error from the API propagates to the UI.
    await expect(
      page.getByText(/invalid|expired|reset token/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('form rejects a password shorter than 8 characters', async ({ page, request }) => {
    const user = await registerNewUser(request, 'pw-short');
    const token = await requestResetToken(request, user);

    await page.goto(`/reset-password?token=${token}`);
    await expect(
      page.getByRole('heading', { name: /choose a new password/i }),
    ).toBeVisible();

    // Try a 7-character password — should be rejected client-side.
    const newPwInput = page.getByLabel(/new password/i);
    await newPwInput.pressSequentially('Abc1234', { delay: 25 });
    const confirmInput = page.getByLabel(/confirm password/i);
    await confirmInput.pressSequentially('Abc1234', { delay: 25 });
    await page.getByRole('button', { name: /set new password/i }).click();

    // The client-side guard blocks submission and shows a helpful error.
    await expect(page.getByText(/at least 8 characters/i)).toBeVisible({
      timeout: 5_000,
    });
    // Must still be on the reset page (not redirected to success).
    await expect(
      page.getByRole('heading', { name: /choose a new password/i }),
    ).toBeVisible();
  });

  test('full flow: forgot → reset → "Go to sign in" link → login with new password', async ({
    page,
    request,
  }) => {
    // 1. Register a fresh user so we can track their token cleanly.
    const user = await registerNewUser(request, 'pw-reset');
    const newPassword = 'ResetToThis999!';

    // 2. Navigate to forgot-password and submit.
    await page.goto('/forgot-password');
    const emailInput = page.getByLabel(/email/i);
    await emailInput.pressSequentially(user.email, { delay: 20 });
    await page.getByRole('button', { name: /send reset link/i }).click();

    // Confirmation renders.
    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({
      timeout: 10_000,
    });

    // 3. Grab the raw token from the API log (dev delivery fallback).
    const token = await requestResetToken(request, user);

    // 4. Open the reset-password page with the token in the URL.
    await page.goto(`/reset-password?token=${token}`);
    await expect(
      page.getByRole('heading', { name: /choose a new password/i }),
    ).toBeVisible();

    // 5. Fill and submit the form.
    const newPwInput = page.getByLabel(/new password/i);
    await newPwInput.pressSequentially(newPassword, { delay: 25 });
    const confirmInput = page.getByLabel(/confirm password/i);
    await confirmInput.pressSequentially(newPassword, { delay: 25 });
    await page.getByRole('button', { name: /set new password/i }).click();

    // 6. Success state renders — no auto-redirect; user sees "Go to sign in" link.
    await expect(
      page.getByRole('heading', { name: /password updated/i }),
    ).toBeVisible({ timeout: 10_000 });
    // Page should NOT auto-redirect within 3 seconds (setTimeout removed).
    await page.waitForTimeout(3_100);
    await expect(
      page.getByRole('heading', { name: /password updated/i }),
    ).toBeVisible();
    // The "Go to sign in" link is present.
    const goToSignIn = page.getByRole('link', { name: /go to sign in/i });
    await expect(goToSignIn).toBeVisible();
    await goToSignIn.click();
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });

    // 7. Log in with the new password.
    const emailLogin = page.getByLabel(/email/i);
    await emailLogin.pressSequentially(user.email, { delay: 20 });
    const passLogin = page.getByLabel(/password/i);
    await passLogin.pressSequentially(newPassword, { delay: 20 });
    await page.getByRole('button', { name: /sign in/i }).click();

    // Successful login: redirected away from /login.
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test('used token is rejected on second attempt', async ({ page, request }) => {
    const user = await registerNewUser(request, 'pw-used');
    const newPassword = 'FirstReset999!';

    // Request reset.
    await request.post(`${API_URL}/api/auth/forgot-password`, {
      data: { email: user.email },
    });
    const token = await requestResetToken(request, user);

    // Consume the token via API (first use — succeeds).
    const firstUse = await request.post(`${API_URL}/api/auth/reset-password`, {
      data: { token, newPassword },
    });
    expect(firstUse.ok()).toBeTruthy();

    // Second attempt via UI with the same token.
    await page.goto(`/reset-password?token=${token}`);
    const newPwInput = page.getByLabel(/new password/i);
    await newPwInput.pressSequentially('SecondAttempt!', { delay: 25 });
    const confirmInput = page.getByLabel(/confirm password/i);
    await confirmInput.pressSequentially('SecondAttempt!', { delay: 25 });
    await page.getByRole('button', { name: /set new password/i }).click();

    // The API returns 400; the UI surfaces the error.
    await expect(
      page.getByText(/already been used/i),
    ).toBeVisible({ timeout: 10_000 });
  });
});

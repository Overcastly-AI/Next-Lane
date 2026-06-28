/**
 * notification-preferences.spec.ts
 *
 * The email-notification opt-in toggle on /me/settings: it reflects the
 * server state (default on), flips and persists across reload, and the
 * profile settings page renders without horizontal overflow on mobile.
 */

import { test, expect } from '@playwright/test';
import { registerNewUser, login } from './helpers';

test.describe('Notification preferences (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('email toggle defaults on, flips, and persists across reload', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'np-pref');
    await login(page, { email: user.email, password: user.password });
    await page.goto('/me/settings');

    const section = page.getByTestId('notification-preferences');
    await expect(section).toBeVisible({ timeout: 15_000 });

    const toggle = page.getByTestId('email-notifications-toggle');
    // New users default to email notifications ON.
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    // Turn it off — the switch flips and a success toast confirms the write
    // landed on the server (gating the reload on the toast avoids racing the
    // in-flight PATCH).
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false', {
      timeout: 8_000,
    });
    await expect(page.getByText(/email notifications off/i)).toBeVisible({
      timeout: 8_000,
    });

    // The preference persists: reload and it's still off.
    await page.reload();
    await expect(
      page.getByTestId('email-notifications-toggle'),
    ).toHaveAttribute('aria-checked', 'false', { timeout: 15_000 });

    // Turn it back on and confirm it persists too.
    await page.getByTestId('email-notifications-toggle').click();
    await expect(page.getByText(/email notifications on/i)).toBeVisible({
      timeout: 8_000,
    });
    await page.reload();
    await expect(
      page.getByTestId('email-notifications-toggle'),
    ).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
  });
});

test.describe('Notification preferences (mobile)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('profile settings render without horizontal overflow', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'np-pref-mob');
    await login(page, { email: user.email, password: user.password });
    await page.goto('/me/settings');
    await expect(page.getByTestId('notification-preferences')).toBeVisible({
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

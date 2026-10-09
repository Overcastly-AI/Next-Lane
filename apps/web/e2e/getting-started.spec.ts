/**
 * First-run: sample project + "Getting started" checklist. Desktop + mobile.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { registerNewUser, loginToken, API_URL } from './helpers';

async function loginFresh(page: Page, request: APIRequestContext) {
  const user = await registerNewUser(request, 'sample');
  await page.goto('/login');
  const email = page.getByLabel(/email/i);
  const password = page.getByLabel(/password/i);
  await email.click();
  await email.pressSequentially(user.email, { delay: 20 });
  await password.click();
  await password.pressSequentially(user.password, { delay: 20 });
  await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  return user;
}

test.describe('Sample project + getting started', () => {
  test('sample CTA creates a populated board; checklist is visible and dismissible', async ({ page, request }) => {
    void loginToken; void API_URL;
    await loginFresh(page, request);
    await expect(page.getByTestId('onboarding-panel')).toBeVisible();

    const cta = page.getByTestId('onboarding-sample-project');
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(cta).toBeDisabled();

    await expect(page).toHaveURL(/\/projects\/[^/]+\/board/, { timeout: 30_000 });
    await expect(page.getByTestId('issue-card').first()).toBeVisible({ timeout: 15_000 });
    expect(await page.getByTestId('issue-card').count()).toBeGreaterThanOrEqual(8);
    await expect(page.getByText('Design new homepage hero').first()).toBeVisible();

    // Back on the dashboard: checklist appears, project is clearly a sample.
    await page.goto('/');
    await expect(page.getByTestId('pulse-dashboard')).toBeVisible();
    const card = page.getByTestId('getting-started');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('pulse-dashboard').getByText('Sample: Website Relaunch').first()).toBeVisible();
    await expect(page.getByTestId('getting-started-progress')).toHaveText('0 of 5 done');

    // Dismissal survives a reload.
    await page.getByTestId('getting-started-dismiss').click();
    await expect(card).toBeHidden();
    await page.reload();
    await expect(page.getByTestId('pulse-dashboard')).toBeVisible();
    await expect(page.getByTestId('getting-started')).toBeHidden();
  });

  test('palette step ticks after opening the command palette', async ({ page, request }) => {
    await loginFresh(page, request);
    await page.getByTestId('onboarding-sample-project').click();
    await expect(page).toHaveURL(/\/projects\/[^/]+\/board/, { timeout: 30_000 });
    await page.goto('/');
    await expect(page.getByTestId('getting-started')).toBeVisible();
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('getting-started-palette')).toHaveAttribute('data-done', 'true');
  });
});

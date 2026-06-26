import { test, expect } from '@playwright/test';
import { DEMO, login } from './helpers';

test.describe('Authentication', () => {
  test('demo user can log in and reach the dashboard', async ({ page }) => {
    await login(page);
    await expect(page).not.toHaveURL(/\/login/);
    // Dashboard shows the seeded project somewhere
    await expect(page.getByText(/next lane/i).first()).toBeVisible();
  });

  test('wrong password shows an error and stays on login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(DEMO.email);
    await page.getByLabel(/password/i).fill('wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/invalid|incorrect|unable|credential/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/\/login/);
  });
});

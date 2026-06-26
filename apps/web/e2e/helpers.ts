import { Page, expect } from '@playwright/test';

export const DEMO = { email: 'demo@nextlane.dev', password: 'nextlane' };

/** Log in through the UI and land on the dashboard. */
export async function login(page: Page, creds = DEMO): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(creds.email);
  await page.getByLabel(/password/i).fill(creds.password);
  await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
  // Dashboard shows projects; wait for navigation away from /login.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

/** Open the seeded "Next Lane" (NL) project board. */
export async function openDemoBoard(page: Page): Promise<void> {
  await login(page);
  // The project card is a <button> containing the project name; click it
  // (distinct from the brand logo, which is not a button).
  const projectCard = page.getByRole('button', { name: /next lane/i }).first();
  await projectCard.click();
  await expect(page).toHaveURL(/\/board/, { timeout: 15_000 });
  // Columns from seeded statuses
  await expect(page.getByText(/to do/i).first()).toBeVisible();
}

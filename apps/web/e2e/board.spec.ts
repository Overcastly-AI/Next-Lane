import { test, expect } from '@playwright/test';
import { openDemoBoard } from './helpers';

test.describe('Kanban board', () => {
  test('renders columns and issue cards', async ({ page }) => {
    await openDemoBoard(page);
    await expect(page.getByText(/to do/i).first()).toBeVisible();
    await expect(page.getByText(/in progress/i).first()).toBeVisible();
    await expect(page.getByText(/done/i).first()).toBeVisible();
    // At least one issue card with a project key is present.
    await expect(page.getByText(/NL-\d+/).first()).toBeVisible();
  });

  test('can create a new issue and it appears on the board', async ({ page }) => {
    await openDemoBoard(page);
    const title = `QA board ${Date.now()}`;
    await page.getByRole('button', { name: /\+ Create issue/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByRole('button', { name: 'Create' }).click();
    // The newly created card shows up (self-contained: does not depend on seed data).
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 });
  });
});

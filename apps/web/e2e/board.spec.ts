import { test, expect } from '@playwright/test';
import { openDemoBoard } from './helpers';

test.describe('Kanban board', () => {
  test('renders columns and seeded issues', async ({ page }) => {
    await openDemoBoard(page);
    await expect(page.getByText(/to do/i).first()).toBeVisible();
    await expect(page.getByText(/in progress/i).first()).toBeVisible();
    await expect(page.getByText(/done/i).first()).toBeVisible();
    // A seeded issue card
    await expect(
      page.getByText(/implement jwt authentication/i).first(),
    ).toBeVisible();
    // Issue key prefix appears
    await expect(page.getByText(/NL-\d+/).first()).toBeVisible();
  });

  test('can create a new issue', async ({ page }) => {
    await openDemoBoard(page);
    const title = `QA smoke ${Date.now()}`;
    await page.getByRole('button', { name: /\+ Create issue/i }).click();
    // Scope to the create-issue dialog so background column buttons don't match.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 });
  });
});

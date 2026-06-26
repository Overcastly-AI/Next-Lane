import { test, expect } from '@playwright/test';
import { openDemoBoard } from './helpers';

test.describe('Issue detail', () => {
  test('open a card and add a comment', async ({ page }) => {
    await openDemoBoard(page);
    await page.getByText(/implement jwt authentication/i).first().click();
    // Drawer/modal opens with the issue title
    await expect(
      page.getByText(/implement jwt authentication/i).first(),
    ).toBeVisible();

    const comment = `QA comment ${Date.now()}`;
    const commentBox = page.getByPlaceholder('Add a comment…');
    await commentBox.fill(comment);
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(page.getByText(comment).first()).toBeVisible({ timeout: 10_000 });
  });
});

import { test, expect } from '@playwright/test';
import { setupIsolatedProject } from './helpers';

test.describe('Toast notifications', () => {
  test('a failed mutation surfaces an error toast', async ({ page, request }) => {
    await setupIsolatedProject(page, request, { label: 'toast' });

    // Create our own issue so the test is self-contained.
    const title = `QA toast ${Date.now()}`;
    await page.getByRole('button', { name: /\+ Create issue/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByRole('button', { name: 'Create' }).click();

    // A success toast confirms the create and the toast system is mounted.
    await expect(page.locator('[data-toast][data-variant="success"]')).toBeVisible({
      timeout: 10_000,
    });

    const card = page.getByText(title).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await expect(page.getByText(title).first()).toBeVisible();

    // Force the comment POST to fail, then attempt to add a comment.
    await page.route('**/api/issues/*/comments', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Forced failure for QA' }),
        });
      }
      return route.continue();
    });

    const commentBox = page.getByPlaceholder('Add a comment…');
    await commentBox.fill('this should fail');
    await page.getByRole('button', { name: 'Comment', exact: true }).click();

    // An error toast (role="alert") must appear with the server message.
    const errorToast = page.locator('[data-toast][data-variant="error"]');
    await expect(errorToast).toBeVisible({ timeout: 10_000 });
    await expect(errorToast).toContainText(/Forced failure for QA/i);
  });
});

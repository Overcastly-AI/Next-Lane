import { test, expect } from '@playwright/test';
import { login, openDemoBoard } from './helpers';

test.describe('Themed dialogs', () => {
  test('new-workspace modal creates a workspace (no native prompt)', async ({
    page,
  }) => {
    await login(page);

    // Guard: the native window.prompt must NOT be used anymore.
    let promptCalled = false;
    await page.exposeFunction('__markPrompt', () => {
      promptCalled = true;
    });
    await page.evaluate(() => {
      const orig = window.prompt;
      window.prompt = (...args) => {
        (window as unknown as { __markPrompt: () => void }).__markPrompt();
        return orig.apply(window, args as []);
      };
    });

    await page.getByRole('button', { name: /\+ Workspace/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/new workspace/i).first()).toBeVisible();

    const wsName = `QA WS ${Date.now()}`;
    await dialog.getByLabel('Name').fill(wsName);
    await dialog.getByRole('button', { name: /create workspace/i }).click();

    // Dialog closes and a success toast confirms creation.
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });
    await expect(
      page.locator('[data-toast][data-variant="success"]'),
    ).toContainText(wsName, { timeout: 10_000 });

    // The new workspace becomes the selected option.
    await expect(page.locator('select').first()).toContainText(wsName);

    expect(promptCalled).toBe(false);
  });

  test('delete-issue confirm dialog appears and deletes on confirm', async ({
    page,
  }) => {
    await openDemoBoard(page);

    // Create a disposable issue to delete.
    const title = `QA delete ${Date.now()}`;
    await page.getByRole('button', { name: /\+ Create issue/i }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByRole('button', { name: 'Create' }).click();

    const card = page.getByText(title).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await expect(page.getByText(title).first()).toBeVisible();

    // Click Delete in the drawer header -> a themed confirmation dialog opens
    // (not window.confirm). The drawer aside is also role="dialog", so scope the
    // confirmation modal by its unique body copy.
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirmModal = page
      .getByRole('dialog')
      .filter({ hasText: /cannot be undone/i });
    await expect(confirmModal).toBeVisible();

    // Confirm deletion via the modal's Delete button.
    await confirmModal.getByRole('button', { name: 'Delete', exact: true }).click();

    // Drawer closes, a "deleted" success toast shows, and the card is gone.
    // (An earlier "Created …" success toast may still be on screen, so match
    // the specific deleted toast rather than the first success toast.)
    await expect(
      page
        .locator('[data-toast][data-variant="success"]')
        .filter({ hasText: /deleted/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(title)).toHaveCount(0, { timeout: 10_000 });
  });
});

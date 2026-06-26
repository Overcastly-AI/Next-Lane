import { test, expect } from '@playwright/test';
import { openDemoBoard } from './helpers';

/**
 * Manage board columns (statuses) from the board UI: add a column, rename it,
 * block deletion when it holds an issue, and delete an empty column.
 *
 * Self-contained: every column name is unique per run so the test does not
 * depend on (or pollute) other specs or seed data.
 */
test.describe('Board column management', () => {
  test('add, rename, guard delete, and delete a column', async ({ page }) => {
    await openDemoBoard(page);

    const stamp = Date.now();
    const colName = `QA Col ${stamp}`;
    const renamed = `QA Renamed ${stamp}`;
    const emptyCol = `QA Empty ${stamp}`;

    // --- Add a column (appears immediately on the board) ---------------------
    await page.getByRole('button', { name: /^Add column$/i }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // pressSequentially guards focus retention while typing.
    await dialog.getByLabel('Name').pressSequentially(colName, { delay: 10 });
    await dialog
      .getByLabel('Category')
      .selectOption({ label: 'In Progress' });
    await dialog.getByRole('button', { name: /^Add column$/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(colName).first()).toBeVisible({
      timeout: 10_000,
    });

    // --- Rename it ----------------------------------------------------------
    await page
      .getByRole('button', { name: new RegExp(`Column actions for ${colName}`, 'i') })
      .click();
    await page.getByRole('menuitem', { name: /Rename \/ edit/i }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const nameField = dialog.getByLabel('Name');
    await nameField.fill('');
    await nameField.pressSequentially(renamed, { delay: 10 });
    await dialog.getByRole('button', { name: /^Save$/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(renamed).first()).toBeVisible({
      timeout: 10_000,
    });

    // --- Create an issue in the renamed column ------------------------------
    const issueTitle = `QA col issue ${stamp}`;
    await page
      .getByRole('button', { name: new RegExp(`Add issue to ${renamed}`, 'i') })
      .click();
    let issueDialog = page.getByRole('dialog');
    await expect(issueDialog).toBeVisible();
    await issueDialog.getByLabel('Title').pressSequentially(issueTitle, {
      delay: 10,
    });
    // Status should already default to the column we opened it from.
    await issueDialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText(issueTitle).first()).toBeVisible({
      timeout: 10_000,
    });

    // --- Attempt to delete the non-empty column -> blocked with a toast -----
    await page
      .getByRole('button', { name: new RegExp(`Column actions for ${renamed}`, 'i') })
      .click();
    await page.getByRole('menuitem', { name: /Delete column/i }).click();
    let confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /Delete column/i }).click();
    // Error toast surfaces; the confirm dialog closes; the column stays.
    await expect(page.getByText(/move or delete its issues first/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(confirm).toBeHidden();
    await expect(page.getByText(renamed).first()).toBeVisible();
    // Dismiss the blocked-delete error toast (which sits top-center on mobile and
    // could otherwise intercept the next click).
    const errorToast = page.locator('[data-toast][data-variant="error"]');
    await errorToast
      .getByRole('button', { name: /dismiss notification/i })
      .click();
    await expect(errorToast).toBeHidden();

    // --- Add an empty column and delete it successfully ---------------------
    const addColumnBtn = page.getByRole('button', { name: /^Add column$/i });
    await addColumnBtn.scrollIntoViewIfNeeded();
    await addColumnBtn.click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Name').pressSequentially(emptyCol, { delay: 10 });
    await dialog.getByRole('button', { name: /^Add column$/i }).click();
    await expect(page.getByText(emptyCol).first()).toBeVisible({
      timeout: 10_000,
    });

    await page
      .getByRole('button', { name: new RegExp(`Column actions for ${emptyCol}`, 'i') })
      .click();
    await page.getByRole('menuitem', { name: /Delete column/i }).click();
    confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /Delete column/i }).click();
    await expect(page.getByText(/deleted/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(emptyCol)).toHaveCount(0);
  });
});

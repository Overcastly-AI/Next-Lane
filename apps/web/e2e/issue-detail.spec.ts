import { test, expect } from '@playwright/test';
import { openDemoBoard } from './helpers';

test.describe('Issue detail', () => {
  test('open a card and add a comment', async ({ page }) => {
    await openDemoBoard(page);

    // Self-contained: create our own uniquely-titled issue, then operate on it
    // (does not depend on mutable seed data).
    const title = `QA detail ${Date.now()}`;
    await page.getByRole('button', { name: /\+ Create issue/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByRole('button', { name: 'Create' }).click();

    const card = page.getByText(title).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    // Drawer opens showing the issue title.
    await expect(page.getByText(title).first()).toBeVisible();

    const comment = `QA comment ${Date.now()}`;
    const commentBox = page.getByPlaceholder('Add a comment…');
    await commentBox.fill(comment);
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(page.getByText(comment).first()).toBeVisible({ timeout: 10_000 });

    // Edit the comment in place: hover the item, click Edit, change text, Save.
    const commentItem = page.getByRole('listitem').filter({ hasText: comment });
    await commentItem.hover();
    await commentItem.getByRole('button', { name: 'Edit', exact: true }).click();
    const edited = `${comment} (edited)`;
    const editBox = commentItem.getByRole('textbox');
    await editBox.fill(edited);
    await commentItem.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(edited).first()).toBeVisible({ timeout: 10_000 });

    // Delete the comment: hover, click Delete, confirm in the themed dialog.
    const editedItem = page.getByRole('listitem').filter({ hasText: edited });
    await editedItem.hover();
    await editedItem.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirm = page
      .getByRole('dialog')
      .filter({ hasText: 'Delete comment' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText(edited)).toHaveCount(0, { timeout: 10_000 });
  });
});

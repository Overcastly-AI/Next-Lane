import { test, expect } from '@playwright/test';
import { setupIsolatedProject } from './helpers';

test.describe('Issue detail', () => {
  test('open a card and add a comment', async ({ page, request }) => {
    await setupIsolatedProject(page, request, { label: 'detail' });

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
    // ConfirmDialog uses role="alertdialog" (the ARIA role for destructive confirmations).
    const confirm = page
      .getByRole('alertdialog')
      .filter({ hasText: 'Delete comment' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText(edited)).toHaveCount(0, { timeout: 10_000 });
  });

  test('activity log resolves status IDs to human names', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'detail' });

    const title = `QA activity ${Date.now()}`;
    await page.getByRole('button', { name: /\+ Create issue/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByRole('button', { name: 'Create' }).click();

    const card = page.getByText(title).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    // Change the status via the drawer's Status select, which logs activity.
    // Scope to the drawer (last dialog) to avoid matching the card's status
    // button whose aria-label also starts with "Status:".
    const drawer = page.getByRole('dialog').last();
    const statusSelect = drawer.locator('#d-status');
    await expect(statusSelect).toBeVisible();
    await statusSelect.selectOption({ label: 'In Progress' });

    // The activity line should read a human status name, not a raw cuid.
    const activityLine = page
      .getByRole('listitem')
      .filter({ hasText: /changed status/i })
      .first();
    await expect(activityLine).toContainText('In Progress', {
      timeout: 10_000,
    });
    // Guard against regression: no raw cuid (c + 24 base32 chars) leaks through.
    await expect(activityLine).not.toContainText(/\bc[a-z0-9]{24}\b/);
  });
});

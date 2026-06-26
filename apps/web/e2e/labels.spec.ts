import { test, expect, type Page } from '@playwright/test';
import { setupIsolatedProject } from './helpers';

/** Create a uniquely-titled issue from the board and open its detail drawer. */
async function createAndOpenIssue(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: /\+ Create issue/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('button', { name: 'Create' }).click();
  const card = page.getByText(title).first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.click();
  // Drawer is open with a Labels section.
  await expect(page.getByText('Labels').first()).toBeVisible();
}

test.describe('Labels management & filtering', () => {
  test('assign a seeded label and the chip appears on the card', async ({
    page,
    request,
  }) => {
    // Isolated project seeded with a "feature" label to assign.
    await setupIsolatedProject(page, request, {
      label: 'tag',
      labels: ['feature'],
    });
    const title = `QA label assign ${Date.now()}`;
    await createAndOpenIssue(page, title);

    // Open the label picker popover and toggle the seeded "feature" label on.
    const drawer = page.getByRole('dialog', { name: /.*/ }).last();
    await page.getByRole('button', { name: 'Edit' }).click();
    const picker = page.getByRole('dialog', { name: 'Edit labels' });
    await expect(picker).toBeVisible();
    await picker
      .getByRole('menuitemcheckbox', { name: /feature/i })
      .click();

    // The chip shows in the drawer's Labels section.
    await expect(drawer.getByText('feature').first()).toBeVisible({
      timeout: 10_000,
    });

    // Close the drawer and confirm the chip is on the board card too.
    await page.keyboard.press('Escape'); // closes the popover
    await page.keyboard.press('Escape'); // closes the drawer
    await expect(page).not.toHaveURL(/issue=/, { timeout: 10_000 });

    const cardWithChip = page
      .locator('div', { hasText: title })
      .filter({ has: page.getByText('feature') });
    await expect(cardWithChip.first()).toBeVisible({ timeout: 10_000 });
  });

  test('create a new label, assign it, and filter the board by it', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'tag' });

    const stamp = Date.now();
    const labelName = `qa-${stamp}`;
    const taggedTitle = `QA tagged ${stamp}`;
    const otherTitle = `QA untagged ${stamp}`;

    // An issue that will NOT get the new label (control for the filter).
    await createAndOpenIssue(page, otherTitle);
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/issue=/, { timeout: 10_000 });

    // An issue that WILL get the new label.
    await createAndOpenIssue(page, taggedTitle);

    // Create a brand-new label from the picker.
    await page.getByRole('button', { name: 'Edit' }).click();
    const picker = page.getByRole('dialog', { name: 'Edit labels' });
    await picker.getByRole('button', { name: 'New label' }).click();
    await picker.getByLabel('New label name').fill(labelName);
    await picker.getByRole('button', { name: 'Add', exact: true }).click();

    // The new label now appears in the picker and we toggle it on.
    const newLabelItem = picker.getByRole('menuitemcheckbox', {
      name: new RegExp(labelName, 'i'),
    });
    await expect(newLabelItem).toBeVisible({ timeout: 10_000 });
    await newLabelItem.click();

    const drawer = page.getByRole('dialog').last();
    await expect(drawer.getByText(labelName).first()).toBeVisible({
      timeout: 10_000,
    });

    // Close popover + drawer, back to the board.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/issue=/, { timeout: 10_000 });

    // Both cards visible before filtering.
    await expect(page.getByText(taggedTitle).first()).toBeVisible();
    await expect(page.getByText(otherTitle).first()).toBeVisible();

    // Apply the label filter for the new label.
    await page.getByRole('button', { name: /^Labels/ }).click();
    const filter = page.getByRole('dialog', { name: 'Filter by label' });
    await expect(filter).toBeVisible();
    await filter
      .getByRole('menuitemcheckbox', { name: new RegExp(labelName, 'i') })
      .click();
    await page.keyboard.press('Escape'); // close filter popover

    // Only the tagged card remains; the untagged one is filtered out.
    await expect(page.getByText(taggedTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(otherTitle)).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});

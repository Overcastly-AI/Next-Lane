import { test, expect, Page } from '@playwright/test';
import { openDemoBoard } from './helpers';

/**
 * Story points + epics/sub-tasks in the issue drawer.
 *
 * Covers:
 *  - Setting story points: persists and shows as a pill on the board card.
 *  - Setting a parent on an issue: the parent chip shows on the child, and the
 *    child appears under the parent's Sub-tasks section.
 */

async function createIssue(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: /\+ Create issue/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 });
}

async function openCard(page: Page, title: string): Promise<void> {
  await page.getByText(title).first().click();
  // Drawer renders the issue title in an editable input.
  await expect(page.locator('input[value="' + title + '"]')).toBeVisible({
    timeout: 10_000,
  });
}

async function closeDrawer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('Story points and hierarchy', () => {
  test('set story points and see the pill on the card', async ({ page }) => {
    await openDemoBoard(page);

    const title = `QA points ${Date.now()}`;
    await createIssue(page, title);
    await openCard(page, title);

    // Set story points via the drawer select.
    const pointsSelect = page.getByLabel('Story Points');
    await expect(pointsSelect).toBeVisible();
    await pointsSelect.selectOption('5');

    await closeDrawer(page);

    // The pill (value 5) shows on the card. Scope to the specific card button.
    const card = page.getByRole('button', { name: new RegExp(title) });
    await expect(card.getByTitle('5 story points')).toBeVisible({
      timeout: 10_000,
    });

    // Persisted: reopen the drawer and the select still reads 5.
    await openCard(page, title);
    await expect(page.getByLabel('Story Points')).toHaveValue('5');
  });

  test('set a parent and see the sub-task under the parent', async ({
    page,
  }) => {
    await openDemoBoard(page);

    const stamp = Date.now();
    const parentTitle = `QA parent ${stamp}`;
    const childTitle = `QA child ${stamp}`;
    await createIssue(page, parentTitle);
    await createIssue(page, childTitle);

    // Open the child and set its parent via the picker.
    await openCard(page, childTitle);
    await page.getByRole('button', { name: /set parent/i }).click();
    const picker = page.getByRole('dialog', { name: 'Set parent issue' });
    await expect(picker).toBeVisible();
    await picker
      .getByLabel('Search issues to set as parent')
      .fill(parentTitle);
    await picker
      .getByRole('button', { name: new RegExp(parentTitle) })
      .click();

    // The parent chip now shows on the child (clickable button with parent title).
    await expect(
      page.getByRole('button', { name: new RegExp(parentTitle) }),
    ).toBeVisible({ timeout: 10_000 });

    await closeDrawer(page);

    // Open the parent and confirm the child appears in Sub-tasks.
    await openCard(page, parentTitle);
    const subtasks = page.getByTestId('subtasks-list');
    await expect(subtasks).toBeVisible({ timeout: 10_000 });
    await expect(
      subtasks.getByRole('button', { name: new RegExp(childTitle) }),
    ).toBeVisible();

    // Clicking the sub-task opens that issue (the child's title input appears).
    await subtasks
      .getByRole('button', { name: new RegExp(childTitle) })
      .click();
    await expect(
      page.locator('input[value="' + childTitle + '"]'),
    ).toBeVisible({ timeout: 10_000 });
  });
});

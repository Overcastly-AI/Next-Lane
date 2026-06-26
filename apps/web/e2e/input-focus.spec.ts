import { test, expect } from '@playwright/test';
import { openDemoBoard } from './helpers';

/**
 * Regression for the "type one character then focus exits" bug in modal/drawer
 * inputs (root cause: useOverlay re-running its effect every render because
 * onClose was a dependency). These tests type CHARACTER BY CHARACTER with
 * pressSequentially — `.fill()` sets the value in one shot and would NOT catch a
 * per-keystroke focus-steal, which is why the original suite missed this.
 */
test.describe('Input focus retention (per-keystroke)', () => {
  test('create-issue Title keeps focus while typing', async ({ page }) => {
    await openDemoBoard(page);
    await page.getByRole('button', { name: /\+ Create issue/i }).click();
    const dialog = page.getByRole('dialog');
    const title = dialog.getByLabel('Title');
    await title.click();
    const text = 'Focus retention check';
    await title.pressSequentially(text, { delay: 30 });
    await expect(title).toHaveValue(text);
    await expect(title).toBeFocused();
  });

  test('comment box keeps focus while typing in the issue drawer', async ({ page }) => {
    await openDemoBoard(page);
    // Open the first issue card to reveal the drawer + comment box.
    await page.getByText(/NL-\d+/).first().click();
    const box = page.getByPlaceholder('Add a comment…');
    await box.click();
    const text = 'Typing a multi word comment';
    await box.pressSequentially(text, { delay: 25 });
    await expect(box).toHaveValue(text);
    await expect(box).toBeFocused();
  });
});

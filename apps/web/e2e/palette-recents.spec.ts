/**
 * Command palette GA fixes: Enter opens the top search hit (not "Create
 * issue"), plain-text snippets, "Recently viewed", and project-key validation.
 * Desktop + mobile (both projects run this file).
 */
import { test, expect, type Page } from '@playwright/test';
import { DEMO, login } from './helpers';

async function openPalette(page: Page, waitForDashboard = true) {
  if (waitForDashboard) {
    await expect(page.getByTestId('pulse-dashboard')).toBeVisible({ timeout: 15_000 });
  }
  await page.keyboard.press('ControlOrMeta+KeyK');
  await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();
  return page.getByRole('combobox', { name: /search issues.*projects/i });
}

test.describe('command palette — GA', () => {
  test('partial query + Enter opens the top issue hit, not Create issue', async ({ page }) => {
    await login(page, DEMO);
    const input = await openPalette(page);
    await input.click();
    await input.pressSequentially('Kanba', { delay: 25 });
    await input.press('Enter');
    await expect(page).toHaveURL(/issue=/, { timeout: 10_000 });
    await expect(page).not.toHaveURL(/new=1/);
  });

  test('recently viewed appears after opening an issue and reopening the palette', async ({ page }, testInfo) => {
    await login(page, DEMO);
    const input = await openPalette(page);
    await input.click();
    await input.pressSequentially('Kanban', { delay: 25 });
    await input.press('Enter');
    await expect(page).toHaveURL(/issue=/, { timeout: 10_000 });
    await expect(page.getByText(/kanban board drag-and-drop/i).first()).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    const input2 = await openPalette(page, false);
    await expect(input2).toHaveValue('');
    const listbox = page.getByRole('listbox', { name: /results/i });
    await expect(listbox.getByText('Recently viewed')).toBeVisible();
    await expect(listbox.getByRole('option', { name: /kanban board/i }).first()).toBeVisible();
    await page.screenshot({
      path: `/tmp/claude-0/-home-user-Next-Lane/3804633c-a20b-55b9-88cd-e1c4a73605bb/scratchpad/shots/g-palette-recents-${testInfo.project.name}.png`,
    });
  });

  test('snippets never show raw markdown', async ({ page }) => {
    await login(page, DEMO);
    const input = await openPalette(page);
    await input.click();
    await input.pressSequentially('board', { delay: 25 });
    const list = page.getByRole('listbox', { name: /results/i });
    await expect(list.getByRole('option').first()).toBeVisible({ timeout: 10_000 });
    const text = await list.innerText();
    expect(text).not.toMatch(/\*\*|\[\[|\]\]/);
  });

  test('New project modal blocks an invalid key', async ({ page }) => {
    await login(page, DEMO);
    await expect(page.getByTestId('pulse-dashboard')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '+ New Project' }).first().click();
    const dialog = page.getByRole('dialog');
    const key = dialog.getByLabel('Key');
    const submit = dialog.getByRole('button', { name: 'Create project' });
    await dialog.getByLabel('Name').pressSequentially('Valid Name', { delay: 15 });
    await expect(submit).toBeEnabled();
    await key.click();
    await key.press('Control+A');
    await key.pressSequentially('7', { delay: 20 });
    await expect(dialog.getByText(/must start with a letter/i)).toBeVisible();
    await expect(submit).toBeDisabled();
    await key.press('Control+A');
    await key.pressSequentially('A', { delay: 20 });
    await expect(dialog.getByText(/at least 2/i)).toBeVisible();
    await expect(submit).toBeDisabled();
    await key.pressSequentially('B', { delay: 20 });
    await expect(submit).toBeEnabled();
  });
});

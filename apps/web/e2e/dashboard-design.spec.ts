/**
 * Home dashboard design-elevation: sprint-aware project cards, unified header
 * with >=40px targets, and live key auto-derivation in the New project modal.
 * Desktop + mobile.
 */
import { test, expect } from '@playwright/test';
import { login, DEMO } from './helpers';

test.describe('Home dashboard — design elevation', () => {
  test('header controls and View all meet the 40px target size', async ({ page }) => {
    await login(page, DEMO);
    await expect(page.getByTestId('pulse-dashboard')).toBeVisible({ timeout: 15_000 });

    const header = page.getByTestId('dashboard-header');
    const controls = header.locator('select, button');
    const n = await controls.count();
    expect(n).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < n; i++) {
      const box = await controls.nth(i).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(39.5);
    }
    const viewAll = page.getByRole('link', { name: /view all/i }).first();
    expect((await viewAll.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(39.5);
  });

  test('project card shows live sprint data and the grid ends with a New project tile', async ({ page }) => {
    await login(page, DEMO);
    const section = page.locator('section[aria-labelledby="projects-heading"]');
    const card = section.getByRole('button', { name: /next lane/i }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId('project-card-open')).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText(/sprint 1/i)).toBeVisible();

    await section.getByTestId('new-project-tile').click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('modal derives the key per keystroke until the key is edited by hand', async ({ page }) => {
    await login(page, DEMO);
    await expect(page.getByTestId('pulse-dashboard')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '+ New Project' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const name = dialog.getByLabel('Name');
    const key = dialog.getByLabel('Key');
    const preview = dialog.getByTestId('project-identity-preview');

    await name.click();
    await name.pressSequentially('Mobile', { delay: 20 });
    await expect(key).toHaveValue('MOBI');
    await name.pressSequentially(' App', { delay: 20 });
    await expect(key).toHaveValue('MA');
    await expect(preview).toContainText('MA-1');
    await expect(preview).toContainText('Mobile App');

    // Manual edit detaches the key from the name.
    await key.click();
    await key.pressSequentially('X', { delay: 20 });
    await expect(key).toHaveValue('MAX');
    await name.click();
    await name.pressSequentially(' Two', { delay: 20 });
    await expect(key).toHaveValue('MAX');
    await expect(preview).toContainText('MAX-1');
  });
});

import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('404 page', () => {
  test('logged-out unknown route shows branded 404, not a redirect', async ({ page }) => {
    await page.goto('/definitely/not/a/route');
    await expect(page.getByTestId('not-found-page')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText("doesn't go anywhere");
    await expect(page).toHaveURL(/\/definitely\/not\/a\/route$/);
    await expect(page.getByTestId('not-found-search')).toHaveCount(0);
    await page.getByTestId('not-found-home').click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('logged-in 404 offers dashboard + search', async ({ page }) => {
    await login(page);
    await page.goto('/nope-nope');
    await expect(page.getByTestId('not-found-page')).toBeVisible();
    await page.getByTestId('not-found-search').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('not-found-home').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('not-found-page')).toHaveCount(0);
  });
});

test.describe('PWA / meta basics', () => {
  test('head tags, manifest and icons resolve', async ({ page, request }) => {
    await page.goto('/login');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /open-source/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    const m = await request.get('/manifest.webmanifest');
    expect(m.ok()).toBe(true);
    const json = await m.json();
    expect(json.name).toBe('Next Lane');
    for (const icon of json.icons as { src: string }[]) {
      expect((await request.get(icon.src)).ok()).toBe(true);
    }
    expect((await request.get('/apple-touch-icon.png')).ok()).toBe(true);
  });
});

test.describe('About + What is new', () => {
  test('dot shows once per version, modals open from the user menu', async ({ page }) => {
    await login(page);
    await page.evaluate(() => localStorage.removeItem('nl.whatsNew.seenVersion'));
    await page.reload();
    await expect(page.getByTestId('whats-new-dot')).toBeVisible();

    await page.getByTestId('user-menu-button').click();
    await page.getByTestId('user-menu-whats-new').click();
    const modal = page.getByTestId('whats-new-modal');
    await expect(modal).toBeVisible();
    const entries = await page.getByTestId('whats-new-entry').count();
    expect(entries).toBeGreaterThan(0);
    expect(entries).toBeLessThanOrEqual(5);
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(page.getByTestId('whats-new-dot')).toHaveCount(0);

    // Survives reload.
    await page.reload();
    await expect(page.getByTestId('user-menu-button')).toBeVisible();
    await expect(page.getByTestId('whats-new-dot')).toHaveCount(0);

    await page.getByTestId('user-menu-button').click();
    await page.getByTestId('user-menu-about').click();
    await expect(page.getByTestId('about-version')).toHaveText(/Version \d+\.\d+\.\d+/);
    await expect(page.getByRole('link', { name: /GitHub repository/ })).toHaveAttribute(
      'href',
      'https://github.com/Overcastly-AI/Next-Lane',
    );
    await page.getByRole('link', { name: /API reference/ }).click();
    await expect(page).toHaveURL(/\/developers/);
  });
});

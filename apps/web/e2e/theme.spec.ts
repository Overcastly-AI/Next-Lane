/**
 * theme.spec.ts — Light / dark mode.
 *
 * Covers the acceptance criteria from docs/BACKLOG.md "Light / dark mode":
 *  - default (no persisted preference) follows the OS `prefers-color-scheme`
 *    — a fresh context with no `colorScheme` override defaults to Playwright's
 *    'light', so a fresh session renders light with no `.dark` class.
 *  - the sidebar's Theme toggle switches to dark instantly, sets the `.dark`
 *    class on <html>, and persists (`localStorage['nl.theme']`) across reload.
 *  - 'System' mode follows the emulated `prefers-color-scheme` (via
 *    Playwright's `colorScheme` context option) live, without a manual pick.
 *  - toggling back to light removes the `.dark` class and persists.
 *
 * Uses the header user-menu's `theme-toggle` (present at every viewport,
 * unlike the sidebar rail which is lg+ only) so this passes on both projects.
 */
import { test, expect } from '@playwright/test';
import { login, registerNewUser } from './helpers';

async function isDarkActive(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.classList.contains('dark'));
}

async function storedTheme(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('nl.theme'));
}

/**
 * Opens the header user menu and returns its `theme-toggle` control, scoped
 * to the dropdown itself — the sidebar ALSO renders a `theme-toggle` (hidden
 * below the `lg` breakpoint via CSS, but still present in the DOM), so an
 * unscoped `.first()` can resolve to the wrong (hidden) instance on mobile.
 */
async function openThemeMenu(page: import('@playwright/test').Page) {
  await page.getByTestId('user-menu-button').click();
  const dropdown = page.getByTestId('user-menu-dropdown');
  await expect(dropdown.getByTestId('theme-toggle')).toBeVisible();
  return dropdown;
}

test.describe('Light / dark mode', () => {
  test('fresh session defaults to light (no persisted preference, light OS scheme)', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'theme-default');
    await login(page, { email: user.email, password: user.password });

    expect(await isDarkActive(page)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('light');
  });

  test('toggling to dark applies instantly, persists across reload, and toggling back to light works', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'theme-toggle');
    await login(page, { email: user.email, password: user.password });

    expect(await isDarkActive(page)).toBe(false);

    const menu = await openThemeMenu(page);
    await menu.getByTestId('theme-toggle-dark').click();

    await expect.poll(() => isDarkActive(page)).toBe(true);
    expect(await storedTheme(page)).toBe('dark');

    // Reload — no flash, the self-hosted theme-init.js bootstrap script
    // (loaded before the app bundle, see index.html) applies the class
    // before the app even mounts.
    await page.reload();
    expect(await isDarkActive(page)).toBe(true);
    expect(await storedTheme(page)).toBe('dark');

    // Toggle back to light.
    const menu2 = await openThemeMenu(page);
    await menu2.getByTestId('theme-toggle-light').click();
    await expect.poll(() => isDarkActive(page)).toBe(false);
    expect(await storedTheme(page)).toBe('light');

    await page.reload();
    expect(await isDarkActive(page)).toBe(false);
    expect(await storedTheme(page)).toBe('light');
  });

  test('brand-color CSS var format is unaffected by dark mode (hex string, not RGB triplet)', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'theme-brandvar');
    await login(page, { email: user.email, password: user.password });

    const menu = await openThemeMenu(page);
    await menu.getByTestId('theme-toggle-dark').click();
    await expect.poll(() => isDarkActive(page)).toBe(true);

    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--nl-signal-600').trim(),
    );
    // Still a hex string in dark mode — the default cobalt anchor is
    // unchanged across modes (see index.css .dark block + applyBrandColor.ts).
    expect(accent.toLowerCase()).toBe('#2563eb');
  });
});

test.describe('Light / dark mode — System preference', () => {
  test.use({ colorScheme: 'dark' });

  test('System (default) mode follows the emulated OS dark scheme', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'theme-system');
    await login(page, { email: user.email, password: user.password });

    // No stored preference yet → 'system' → OS scheme is emulated dark.
    expect(await storedTheme(page)).toBeNull();
    expect(await isDarkActive(page)).toBe(true);
  });
});

test.describe('Light / dark mode — mobile', () => {
  test.use({ viewport: { width: 393, height: 852 } });

  test('theme toggle is reachable from the header user menu on mobile', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'theme-mobile');
    await login(page, { email: user.email, password: user.password });

    const menu = await openThemeMenu(page);
    await menu.getByTestId('theme-toggle-dark').click();
    await expect.poll(() => isDarkActive(page)).toBe(true);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

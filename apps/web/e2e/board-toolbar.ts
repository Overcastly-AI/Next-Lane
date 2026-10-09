/**
 * Shared locators for the redesigned board toolbar (one "Filter" popover +
 * a "Query" toggle). Idempotent: safe to call when already open.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** Open the board's Filter popover and return its dialog locator. */
export async function openFilterPanel(page: Page): Promise<Locator> {
  const panel = page.getByRole('dialog', { name: 'Filters' });
  if (!(await panel.isVisible())) {
    await page.getByTestId('board-filter-trigger').click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

/** Make sure the NLQL query bar is open; returns the query input. */
export async function openQueryBar(page: Page): Promise<Locator> {
  const toggle = page.getByTestId('board-query-toggle');
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  // An applied `?q=` keeps the bar open (and the toggle disabled).
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  const input = page.getByTestId('nlql-query-input');
  await expect(input).toBeVisible();
  return input;
}

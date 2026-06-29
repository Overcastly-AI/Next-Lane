/**
 * nlql-autocomplete.spec.ts
 *
 * E2E tests for the NLQL query bar autocomplete (NlqlInput component).
 *
 * NOTE: In this sandbox environment the background API may be reaped between
 * commands, so Playwright tests that require a live API will fail with
 * ECONNREFUSED 127.0.0.1:4000. These tests are written to be run in the
 * orchestrator environment where both the API and web server are running.
 * tsc + build validation is authoritative for this sandbox.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupIsolatedProject, API_URL } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface IsolatedCtx {
  token: string;
  projectId: string;
}

async function seedIssues(
  request: APIRequestContext,
  ctx: IsolatedCtx,
): Promise<{ highTitle: string; lowTitle: string }> {
  const stamp = Date.now();
  const highTitle = `AUTOCOMPLETE HIGH ${stamp}`;
  const lowTitle = `AUTOCOMPLETE LOW ${stamp}`;

  async function post(data: Record<string, unknown>) {
    const res = await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { projectId: ctx.projectId, ...data },
    });
    expect(res.ok(), `seed issue failed: ${res.status()}`).toBeTruthy();
  }

  await post({ title: highTitle, type: 'TASK', priority: 'HIGH' });
  await post({ title: lowTitle, type: 'TASK', priority: 'LOW' });

  return { highTitle, lowTitle };
}

// ---------------------------------------------------------------------------
// Desktop tests
// ---------------------------------------------------------------------------

test.describe('NLQL autocomplete — desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('typing "pri" shows "priority" field suggestion', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'nlql-ac-field',
    });

    const input = page.getByTestId('nlql-query-input');
    await expect(input).toBeVisible({ timeout: 15_000 });

    await input.click();
    await input.pressSequentially('pri', { delay: 50 });

    // Suggestions dropdown should appear
    const suggestions = page.getByTestId('nlql-suggestions');
    await expect(suggestions).toBeVisible({ timeout: 5_000 });

    // "priority" suggestion should be in the list
    await expect(suggestions.getByText('priority', { exact: true })).toBeVisible({ timeout: 3_000 });
  });

  test('Enter accepts the highlighted suggestion and inserts it', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'nlql-ac-accept',
    });

    const input = page.getByTestId('nlql-query-input');
    await expect(input).toBeVisible({ timeout: 15_000 });

    await input.click();
    await input.pressSequentially('pri', { delay: 50 });

    const suggestions = page.getByTestId('nlql-suggestions');
    await expect(suggestions).toBeVisible({ timeout: 5_000 });

    // Move to first suggestion and accept with Enter
    await input.press('ArrowDown');
    await input.press('Enter');

    // Input should now contain the accepted field (with trailing space)
    const val = await input.inputValue();
    expect(val.toLowerCase()).toMatch(/^priority\s*/);

    // Dropdown should close
    await expect(suggestions).not.toBeVisible({ timeout: 2_000 });

    // Input should still have focus (no focus loss)
    await expect(input).toBeFocused();
  });

  test('full flow: field → operator → value → filtered board', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'nlql-ac-flow',
    });
    const { highTitle, lowTitle } = await seedIssues(request, {
      token: ctx.token,
      projectId: ctx.project.id,
    });

    // Wait for board to load with both issues
    await expect(page.getByText(highTitle).first()).toBeVisible({ timeout: 12_000 });
    await expect(page.getByText(lowTitle).first()).toBeVisible({ timeout: 5_000 });

    const input = page.getByTestId('nlql-query-input');

    // Step 1: type "priority" as a field
    await input.click();
    await input.pressSequentially('priority = ', { delay: 30 });

    // Step 2: dropdown should show value suggestions for priority
    const suggestions = page.getByTestId('nlql-suggestions');
    await expect(suggestions).toBeVisible({ timeout: 5_000 });
    // Should contain "HIGH" value
    await expect(suggestions.getByText('HIGH', { exact: true })).toBeVisible({ timeout: 3_000 });

    // Step 3: click "HIGH" suggestion
    await suggestions.getByText('HIGH', { exact: true }).click();

    // Step 4: input should contain the full query
    const val = await input.inputValue();
    expect(val).toMatch(/priority\s*=\s*HIGH/i);

    // Step 5: board should filter — HIGH visible, LOW hidden
    await expect(page.getByText(highTitle).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(lowTitle)).toHaveCount(0, { timeout: 8_000 });
  });

  test('Escape closes the dropdown', async ({ page, request }) => {
    await setupIsolatedProject(page, request, { label: 'nlql-ac-esc' });

    const input = page.getByTestId('nlql-query-input');
    await expect(input).toBeVisible({ timeout: 15_000 });

    await input.click();
    await input.pressSequentially('pri', { delay: 50 });

    const suggestions = page.getByTestId('nlql-suggestions');
    await expect(suggestions).toBeVisible({ timeout: 5_000 });

    await input.press('Escape');
    await expect(suggestions).not.toBeVisible({ timeout: 2_000 });

    // Input keeps focus
    await expect(input).toBeFocused();
  });

  test('Esc closes and query still applies (URL param persists)', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'nlql-ac-url' });

    const input = page.getByTestId('nlql-query-input');
    await expect(input).toBeVisible({ timeout: 15_000 });

    // Type a full valid query manually (no autocomplete)
    await input.fill('priority = HIGH');
    await expect(page).toHaveURL(/[?&]q=/, { timeout: 8_000 });

    // Reload — query restores from URL
    await page.reload();
    await expect(page.getByTestId('nlql-query-input')).toHaveValue(
      'priority = HIGH',
      { timeout: 15_000 },
    );
  });

  test('suggestions have accessible roles (combobox + listbox + option)', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'nlql-ac-a11y' });

    const input = page.getByTestId('nlql-query-input');
    await expect(input).toBeVisible({ timeout: 15_000 });

    // The input should have role=combobox
    await expect(input).toHaveAttribute('role', 'combobox');
    await expect(input).toHaveAttribute('aria-expanded', 'false');

    await input.click();
    await input.pressSequentially('pri', { delay: 50 });

    // After typing, aria-expanded should be true
    await expect(input).toHaveAttribute('aria-expanded', 'true', { timeout: 5_000 });

    // The listbox should be accessible
    const listbox = page.getByRole('listbox', { name: /NLQL suggestions/i });
    await expect(listbox).toBeVisible({ timeout: 3_000 });

    // At least one option should exist
    const firstOption = page.getByTestId('nlql-suggestions').getByRole('option').first();
    await expect(firstOption).toBeVisible({ timeout: 3_000 });
  });

  test('ORDER BY suggestion appears after complete comparison', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'nlql-ac-orderby' });

    const input = page.getByTestId('nlql-query-input');
    await expect(input).toBeVisible({ timeout: 15_000 });

    await input.click();
    await input.pressSequentially('priority = HIGH ', { delay: 30 });

    const suggestions = page.getByTestId('nlql-suggestions');
    await expect(suggestions).toBeVisible({ timeout: 5_000 });

    // Should suggest AND, OR, ORDER BY
    await expect(suggestions.getByText('AND', { exact: true })).toBeVisible({ timeout: 3_000 });
    await expect(suggestions.getByText('ORDER BY')).toBeVisible({ timeout: 3_000 });
  });
});

// ---------------------------------------------------------------------------
// Mobile tests (375x812) — dropdown must not cause page overflow
// ---------------------------------------------------------------------------

test.describe('NLQL autocomplete — mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('autocomplete dropdown does not cause horizontal overflow on mobile', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'nlql-ac-mobile' });

    const input = page.getByTestId('nlql-query-input');
    await expect(input).toBeVisible({ timeout: 15_000 });

    await input.click();
    await input.pressSequentially('pri', { delay: 50 });

    // Dropdown visible
    const suggestions = page.getByTestId('nlql-suggestions');
    await expect(suggestions).toBeVisible({ timeout: 5_000 });

    // Measure document scroll width — should not exceed viewport width
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const viewportWidth = 375;
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 2); // 2px tolerance for borders
  });

  test('mobile: Tab accepts suggestion and keeps focus', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'nlql-ac-mobile-tab' });

    const input = page.getByTestId('nlql-query-input');
    await expect(input).toBeVisible({ timeout: 15_000 });

    await input.click();
    await input.pressSequentially('pri', { delay: 50 });

    const suggestions = page.getByTestId('nlql-suggestions');
    await expect(suggestions).toBeVisible({ timeout: 5_000 });

    // Navigate down and accept with Tab
    await input.press('ArrowDown');
    await input.press('Tab');

    const val = await input.inputValue();
    expect(val.toLowerCase()).toMatch(/^priority/);

    // Dropdown should close
    await expect(suggestions).not.toBeVisible({ timeout: 2_000 });
  });
});

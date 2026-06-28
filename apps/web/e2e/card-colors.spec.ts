/**
 * e2e: Conditional card colors — Phase 5.
 *
 * Covers (desktop + mobile):
 * - Opening the Card Colors manager via the toolbar button.
 * - Adding a color rule (priority = HIGH → red) and saving.
 * - Asserting a HIGH-priority card gains the accent stripe (data-color-rule-id).
 * - Adding a second, lower-priority rule and verifying first-match ordering.
 * - Deleting a rule and verifying the accent clears.
 *
 * Uses isolated projects so the shared demo is never polluted.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupIsolatedProject, API_URL } from './helpers';

// ---------------------------------------------------------------------------
// Seed helper
// ---------------------------------------------------------------------------

interface SeedCtx {
  token: string;
  projectId: string;
}

async function seedPriorityIssues(
  request: APIRequestContext,
  ctx: SeedCtx,
): Promise<{ highTitle: string; lowTitle: string }> {
  const stamp = Date.now();
  const highTitle = `HIGH issue ${stamp}`;
  const lowTitle = `LOW issue ${stamp}`;

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

test.describe('Card colors — desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('open manager, add HIGH priority rule, verify accent on card', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'colors-add',
      projectName: 'Card Colors Project',
    });

    const { highTitle, lowTitle } = await seedPriorityIssues(request, {
      token: ctx.token,
      projectId: ctx.project.id,
    });

    // Reload to ensure the seeded issues appear.
    await page.reload();
    await expect(page.getByText(highTitle).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(lowTitle).first()).toBeVisible({ timeout: 10_000 });

    // Verify no card has a color rule set yet.
    await expect(page.locator('[data-color-rule-id]')).toHaveCount(0);

    // Open the Card Colors manager via the toolbar button.
    const colorsBtn = page.getByTestId('card-colors-open').first();
    await expect(colorsBtn).toBeVisible({ timeout: 10_000 });
    await colorsBtn.click();

    // The board settings modal with the colors tab should open.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // We should see the "Card colors" tab already active (since we opened via
    // toolbar button which sets initialTab='colors').
    // Click "Add rule" to add a new rule.
    const addRuleBtn = page.getByTestId('color-rule-add');
    await expect(addRuleBtn).toBeVisible({ timeout: 5_000 });
    await addRuleBtn.click();

    // A rule row should appear.
    const ruleRow = page.getByTestId('color-rule-row').first();
    await expect(ruleRow).toBeVisible({ timeout: 5_000 });

    // Type a NLQL query: priority = HIGH
    const queryInput = ruleRow.getByTestId('color-rule-query');
    await expect(queryInput).toBeVisible();
    await queryInput.click();
    await queryInput.pressSequentially('priority = HIGH', { delay: 20 });

    // No inline error should appear (valid query).
    await expect(ruleRow.locator('[role="alert"]')).toHaveCount(0);

    // Pick the first preset color (red = #ef4444) — click the first swatch.
    const colorPicker = ruleRow.getByTestId('color-rule-color');
    await expect(colorPicker).toBeVisible();
    // Click the first swatch button (Red).
    await colorPicker.getByRole('button', { name: /red/i }).click();

    // Add an optional label.
    const labelInput = ruleRow.locator('input[placeholder*="High priority"]');
    await labelInput.fill('High priority');

    // Save.
    await page.getByRole('button', { name: /save colors/i }).click();

    // Modal stays open (colors tab doesn't close on save); close it.
    await dialog.getByLabel('Close').click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // Now reload to get fresh board data with colorRules applied.
    await page.reload();
    await expect(page.getByText(highTitle).first()).toBeVisible({ timeout: 15_000 });

    // The HIGH-priority card should have data-color-rule-id set.
    const highCard = page.locator('[data-testid="issue-card"]').filter({
      hasText: highTitle,
    });
    await expect(highCard).toBeVisible({ timeout: 10_000 });
    await expect(highCard).toHaveAttribute('data-color-rule-id', /.+/);

    // The LOW-priority card should NOT have data-color-rule-id set.
    const lowCard = page.locator('[data-testid="issue-card"]').filter({
      hasText: lowTitle,
    });
    await expect(lowCard).toBeVisible({ timeout: 5_000 });
    await expect(lowCard).not.toHaveAttribute('data-color-rule-id');

    // The accent stripe should have a background-color inline style.
    // The stripe is the first child div inside the colored card.
    const stripe = highCard.locator('div[style*="background-color"]').first();
    await expect(stripe).toBeVisible();
  });

  test('first-match ordering — second rule does not override first', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'colors-order',
      projectName: 'Card Colors Order Project',
    });

    const { highTitle } = await seedPriorityIssues(request, {
      token: ctx.token,
      projectId: ctx.project.id,
    });

    await page.reload();
    await expect(page.getByText(highTitle).first()).toBeVisible({ timeout: 15_000 });

    // Open manager and add TWO rules:
    // Rule 1: priority = HIGH → Red (#ef4444)
    // Rule 2: priority = HIGH → Blue (#3b82f6)  (same condition, but second)
    const colorsBtn = page.getByTestId('card-colors-open').first();
    await colorsBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const addRuleBtn = page.getByTestId('color-rule-add');

    // Add Rule 1 (Red)
    await addRuleBtn.click();
    const rule1 = page.getByTestId('color-rule-row').nth(0);
    await rule1.getByTestId('color-rule-query').fill('priority = HIGH');
    await rule1.getByTestId('color-rule-color').getByRole('button', { name: /red/i }).click();

    // Add Rule 2 (Blue)
    await addRuleBtn.click();
    const rule2 = page.getByTestId('color-rule-row').nth(1);
    await rule2.getByTestId('color-rule-query').fill('priority = HIGH');
    await rule2.getByTestId('color-rule-color').getByRole('button', { name: /blue/i }).click();

    // Save.
    await page.getByRole('button', { name: /save colors/i }).click();
    await dialog.getByLabel('Close').click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    await page.reload();
    await expect(page.getByText(highTitle).first()).toBeVisible({ timeout: 15_000 });

    // The card should have the FIRST rule's id (not the second's).
    const highCard = page.locator('[data-testid="issue-card"]').filter({
      hasText: highTitle,
    });
    await expect(highCard).toHaveAttribute('data-color-rule-id', /.+/);

    // Verify via API that the first rule is the one applied by checking the
    // card's stripe color is red (rgb(239, 68, 68)) — #ef4444.
    const stripe = highCard.locator('div[style*="background-color"]').first();
    await expect(stripe).toBeVisible();
    // The color should be the first rule's color (red), not blue.
    const bgColor = await stripe.evaluate((el: HTMLElement) => el.style.backgroundColor);
    // rgb(239, 68, 68) = #ef4444, rgb(59, 130, 246) = #3b82f6
    expect(bgColor).not.toMatch(/59.*130.*246/); // NOT blue
  });

  test('delete a rule and verify the accent clears', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'colors-delete',
      projectName: 'Card Colors Delete Project',
    });

    const { highTitle } = await seedPriorityIssues(request, {
      token: ctx.token,
      projectId: ctx.project.id,
    });

    await page.reload();
    await expect(page.getByText(highTitle).first()).toBeVisible({ timeout: 15_000 });

    // Add a color rule via the toolbar.
    const colorsBtn = page.getByTestId('card-colors-open').first();
    await colorsBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await page.getByTestId('color-rule-add').click();
    const rule = page.getByTestId('color-rule-row').first();
    await rule.getByTestId('color-rule-query').fill('priority = HIGH');
    await rule.getByTestId('color-rule-color').getByRole('button', { name: /red/i }).click();

    await page.getByRole('button', { name: /save colors/i }).click();
    await dialog.getByLabel('Close').click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // Reload and verify accent is set.
    await page.reload();
    await expect(page.getByText(highTitle).first()).toBeVisible({ timeout: 15_000 });
    const highCard = page.locator('[data-testid="issue-card"]').filter({
      hasText: highTitle,
    });
    await expect(highCard).toHaveAttribute('data-color-rule-id', /.+/, {
      timeout: 10_000,
    });

    // Now open the manager and delete the rule.
    await colorsBtn.click();
    const dialog2 = page.getByRole('dialog');
    await expect(dialog2).toBeVisible({ timeout: 5_000 });

    const deleteBtn = dialog2.getByTestId('color-rule-delete').first();
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Rule row should be gone.
    await expect(dialog2.getByTestId('color-rule-row')).toHaveCount(0);

    // Save the empty rules array.
    await dialog2.getByRole('button', { name: /save colors/i }).click();
    await dialog2.getByLabel('Close').click();
    await expect(dialog2).toBeHidden({ timeout: 5_000 });

    // Reload and verify accent is gone.
    await page.reload();
    await expect(page.getByText(highTitle).first()).toBeVisible({ timeout: 15_000 });
    const highCard2 = page.locator('[data-testid="issue-card"]').filter({
      hasText: highTitle,
    });
    await expect(highCard2).not.toHaveAttribute('data-color-rule-id', /.+/, {
      timeout: 10_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Mobile tests
// ---------------------------------------------------------------------------

test.describe('Card colors — mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('open manager on mobile, add rule, verify accent', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'colors-mobile',
      projectName: 'Card Colors Mobile Project',
    });

    const { highTitle } = await seedPriorityIssues(request, {
      token: ctx.token,
      projectId: ctx.project.id,
    });

    await page.reload();
    await expect(page.getByText(highTitle).first()).toBeVisible({ timeout: 15_000 });

    // Open Card Colors manager.
    const colorsBtn = page.getByTestId('card-colors-open').first();
    await expect(colorsBtn).toBeVisible({ timeout: 10_000 });
    await colorsBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Add a rule.
    await page.getByTestId('color-rule-add').click();
    const rule = page.getByTestId('color-rule-row').first();
    await rule.getByTestId('color-rule-query').fill('priority = HIGH');
    await rule.getByTestId('color-rule-color').getByRole('button', { name: /red/i }).click();

    // Save.
    await page.getByRole('button', { name: /save colors/i }).click();
    await dialog.getByLabel('Close').click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // Reload and verify.
    await page.reload();
    await expect(page.getByText(highTitle).first()).toBeVisible({ timeout: 15_000 });

    const highCard = page.locator('[data-testid="issue-card"]').filter({
      hasText: highTitle,
    });
    await expect(highCard).toHaveAttribute('data-color-rule-id', /.+/, {
      timeout: 10_000,
    });
  });

  test('move rule up/down on mobile reorders rules', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'colors-mobile-reorder',
      projectName: 'Card Colors Reorder Project',
    });

    await seedPriorityIssues(request, {
      token: ctx.token,
      projectId: ctx.project.id,
    });

    await page.reload();

    // Open manager and add 2 rules.
    const colorsBtn = page.getByTestId('card-colors-open').first();
    await expect(colorsBtn).toBeVisible({ timeout: 10_000 });
    await colorsBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const addBtn = page.getByTestId('color-rule-add');

    // Rule 1
    await addBtn.click();
    const rule1 = page.getByTestId('color-rule-row').nth(0);
    await rule1.getByTestId('color-rule-query').fill('priority = HIGH');

    // Rule 2
    await addBtn.click();
    const rule2 = page.getByTestId('color-rule-row').nth(1);
    await rule2.getByTestId('color-rule-query').fill('priority = LOW');

    // Move rule 2 up — it should become rule 1.
    await page.getByTestId('color-rule-row').nth(1).getByTestId('color-rule-up').click();

    // After moving up, the first row's query should be "priority = LOW".
    const firstQueryAfter = await page.getByTestId('color-rule-row').nth(0).getByTestId('color-rule-query').inputValue();
    expect(firstQueryAfter).toBe('priority = LOW');

    // Close without saving.
    await dialog.getByLabel('Close').click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });
  });
});

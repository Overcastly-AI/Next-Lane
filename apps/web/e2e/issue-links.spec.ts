/**
 * E2E tests for Issue Links / Dependencies feature.
 *
 * Tests cover:
 * - Adding a "blocks" link to another issue (by key).
 * - Verifying the inverse ("is blocked by") appears on the target issue.
 * - Removing the link.
 * - Error handling: self-link and duplicate errors surface as toasts.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  setupIsolatedProject,
  createIssue,
  type IsolatedContext,
} from './helpers';

// ---------------------------------------------------------------------------
// Helper: open an issue card by title and wait for the drawer.
// ---------------------------------------------------------------------------
async function openIssueByTitle(page: Page, title: string): Promise<void> {
  const card = page.getByText(title).first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.click();
  // The drawer is a dialog; wait for it to be visible.
  await expect(page.getByRole('dialog').last()).toBeVisible({ timeout: 8_000 });
}

// ---------------------------------------------------------------------------
// Helper: open a specific issue by key via the board (click the key chip).
// ---------------------------------------------------------------------------
async function openIssueByKey(page: Page, key: string): Promise<void> {
  // Issue key chips appear on cards as monospace text.
  const chip = page.getByText(key).first();
  await expect(chip).toBeVisible({ timeout: 10_000 });
  // Click the card that contains the key chip.
  await chip.click();
  await expect(page.getByRole('dialog').last()).toBeVisible({ timeout: 8_000 });
}

// ---------------------------------------------------------------------------
// Helper: add a link in the open drawer.
// ---------------------------------------------------------------------------
async function addLink(
  page: Page,
  linkTypeLabel: string,
  targetKey: string,
): Promise<void> {
  const drawer = page.getByRole('dialog').last();

  // Open the add-link form.
  await drawer.getByTestId('issue-link-add').click();

  // Select the link type.
  const typeSelect = drawer.getByTestId('issue-link-type');
  await expect(typeSelect).toBeVisible();
  await typeSelect.selectOption({ label: linkTypeLabel });

  // Type the target issue key.
  const targetInput = drawer.getByTestId('issue-link-target');
  await expect(targetInput).toBeVisible();
  await targetInput.fill(targetKey);

  // Submit.
  await drawer.getByRole('button', { name: 'Add', exact: true }).click();
}

// ---------------------------------------------------------------------------
// Helper: close the drawer via the Close button.
// ---------------------------------------------------------------------------
async function closeDrawer(page: Page): Promise<void> {
  await page.getByRole('dialog').last().getByRole('button', { name: 'Close' }).click();
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------
let ctx: IsolatedContext;
let issueAId: string;
let issueAKey: string;
let issueBId: string;
let issueBKey: string;
let issueBTitle: string;
let issueATitle: string;

test.describe('Issue links / dependencies', () => {
  test.beforeEach(async ({ page, request }) => {
    ctx = await setupIsolatedProject(page, request, { label: 'links' });

    // Create two issues.
    const tsA = Date.now();
    issueATitle = `Issue A ${tsA}`;
    const tsB = tsA + 1;
    issueBTitle = `Issue B ${tsB}`;

    const issueA = await createIssue(request, ctx.token, ctx.project.id, {
      title: issueATitle,
    });
    const issueB = await createIssue(request, ctx.token, ctx.project.id, {
      title: issueBTitle,
    });

    issueAId = issueA.id;
    issueAKey = issueA.key;
    issueBId = issueB.id;
    issueBKey = issueB.key;

    // Navigate to the board (may have been opened already, but refresh to pick
    // up the new issues).
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Keep linter happy — these are used in tests below.
    void issueAId;
    void issueBId;
  });

  // --------------------------------------------------------------------------
  test('desktop: add a "blocks" link and see the inverse on the target issue', async ({
    page,
  }) => {
    // Open Issue A.
    await openIssueByTitle(page, issueATitle);

    // Add a "blocks" link pointing to Issue B.
    await addLink(page, 'blocks', issueBKey);

    // A success toast appears.
    await expect(page.getByText('Link added.').first()).toBeVisible({
      timeout: 8_000,
    });

    // The drawer now shows Issue B under "blocks".
    const drawer = page.getByRole('dialog').last();
    const blocksSection = drawer.getByTestId('issue-link-row').filter({
      hasText: issueBKey,
    });
    await expect(blocksSection).toBeVisible({ timeout: 8_000 });

    // Close the drawer.
    await closeDrawer(page);

    // Open Issue B and verify the inverse "is blocked by" appears.
    await openIssueByTitle(page, issueBTitle);
    const drawerB = page.getByRole('dialog').last();

    // The section header "is blocked by" must be present.
    await expect(
      drawerB.getByText(/is blocked by/i).first(),
    ).toBeVisible({ timeout: 8_000 });

    // And the row with Issue A's key is present.
    const inverseRow = drawerB.getByTestId('issue-link-row').filter({
      hasText: issueAKey,
    });
    await expect(inverseRow).toBeVisible({ timeout: 8_000 });
  });

  // --------------------------------------------------------------------------
  test('desktop: remove a link and it disappears', async ({ page }) => {
    // Add the link first.
    await openIssueByTitle(page, issueATitle);
    await addLink(page, 'blocks', issueBKey);
    await expect(page.getByText('Link added.').first()).toBeVisible({
      timeout: 8_000,
    });

    // Row for Issue B is present.
    const drawer = page.getByRole('dialog').last();
    const linkRow = drawer.getByTestId('issue-link-row').filter({
      hasText: issueBKey,
    });
    await expect(linkRow).toBeVisible({ timeout: 8_000 });

    // Click the remove (x) button on that row.
    await linkRow.getByTestId('issue-link-remove').click();

    // Row disappears.
    await expect(linkRow).toHaveCount(0, { timeout: 8_000 });
  });

  // --------------------------------------------------------------------------
  test('desktop: adding a self-link shows an error toast', async ({ page }) => {
    await openIssueByTitle(page, issueATitle);
    await addLink(page, 'blocks', issueAKey);

    // A toast with an error message appears (400 from the API).
    const errorToast = page.locator('[data-toast][data-variant="error"]');
    await expect(errorToast).toBeVisible({ timeout: 8_000 });
  });

  // --------------------------------------------------------------------------
  test('desktop: adding a duplicate link shows an error toast', async ({
    page,
  }) => {
    // Add once.
    await openIssueByTitle(page, issueATitle);
    await addLink(page, 'blocks', issueBKey);
    await expect(page.getByText('Link added.').first()).toBeVisible({
      timeout: 8_000,
    });

    // Add again (same type + target = duplicate).
    await addLink(page, 'blocks', issueBKey);

    // Error toast for conflict/duplicate.
    const errorToast = page.locator('[data-toast][data-variant="error"]');
    await expect(errorToast).toBeVisible({ timeout: 8_000 });
  });

  // --------------------------------------------------------------------------
  test('mobile: add and remove a link', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    // Navigate to board (reload for mobile viewport).
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Open Issue A.
    await openIssueByTitle(page, issueATitle);

    // Add a "relates to" link.
    await addLink(page, 'relates to', issueBKey);
    await expect(page.getByText('Link added.').first()).toBeVisible({
      timeout: 8_000,
    });

    // Row appears.
    const drawer = page.getByRole('dialog').last();
    const linkRow = drawer.getByTestId('issue-link-row').filter({
      hasText: issueBKey,
    });
    await expect(linkRow).toBeVisible({ timeout: 8_000 });

    // Remove the link.
    await linkRow.getByTestId('issue-link-remove').click();
    await expect(linkRow).toHaveCount(0, { timeout: 8_000 });
  });
});

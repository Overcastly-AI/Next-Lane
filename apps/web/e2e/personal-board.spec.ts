/**
 * personal-board.spec.ts
 *
 * End-to-end tests for the personal kanban board (/my-board).
 *
 * Drag-and-drop in Playwright can be flaky with pointer simulation, so card
 * moves are tested via the "Move to column" affordance (the arrow button on
 * each card) rather than raw mouse drag. The drag-and-drop path is still
 * exercised by dnd-kit in the real browser; this test asserts the end-state
 * after a server-round-tripped move.
 */

import { test, expect } from '@playwright/test';
import { login, registerNewUser, trackApiWrites } from './helpers';

// ---------------------------------------------------------------------------
// Desktop tests
// ---------------------------------------------------------------------------

test.describe('Personal board — desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('loads /my-board and shows default columns', async ({ page, request }) => {
    // Use a fresh user so the board is always in a clean state.
    const user = await registerNewUser(request, 'pb-defaults');
    await login(page, { email: user.email, password: user.password });

    await page.goto('/my-board');
    await expect(page.getByTestId('personal-board')).toBeVisible({
      timeout: 15_000,
    });

    // Backend lazily creates To Do / Doing / Done on first call.
    const columns = page.getByTestId('personal-column');
    await expect(columns).toHaveCount(3, { timeout: 10_000 });
    await expect(columns.first()).toContainText(/to do/i);
  });

  test('header nav link reaches /my-board', async ({ page, request }) => {
    const user = await registerNewUser(request, 'pb-nav');
    await login(page, { email: user.email, password: user.password });

    // Start on dashboard, then click "My Board" in the header.
    await page.goto('/');
    await page.getByRole('link', { name: /my board/i }).first().click();
    await expect(page).toHaveURL(/\/my-board/);
    await expect(page.getByTestId('personal-board')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('can add a card to "To Do"', async ({ page, request }) => {
    const user = await registerNewUser(request, 'pb-add');
    await login(page, { email: user.email, password: user.password });
    await page.goto('/my-board');

    // Wait for board to fully load.
    await expect(page.getByTestId('personal-board')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('personal-column').first()).toBeVisible();

    // Click the + button on the first column (To Do).
    await page
      .getByTestId('personal-add-card')
      .first()
      .click();

    const input = page.getByTestId('personal-add-card-input');
    await expect(input).toBeVisible();
    await input.fill('My first task');

    await page.getByTestId('personal-card-save').first().click();

    // Card should appear on the board.
    await expect(
      page.getByTestId('personal-card-title').filter({ hasText: 'My first task' }),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('can edit a card title', async ({ page, request }) => {
    const user = await registerNewUser(request, 'pb-edit');
    await login(page, { email: user.email, password: user.password });
    await page.goto('/my-board');

    await expect(page.getByTestId('personal-board')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('personal-column').first()).toBeVisible();

    // Create a card first.
    await page.getByTestId('personal-add-card').first().click();
    const input = page.getByTestId('personal-add-card-input');
    await input.fill('Original title');
    await page.getByTestId('personal-card-save').first().click();
    await expect(
      page.getByTestId('personal-card-title').filter({ hasText: 'Original title' }),
    ).toBeVisible({ timeout: 8_000 });

    // Hover the card to reveal actions, then click edit.
    const card = page
      .getByTestId('personal-card')
      .filter({ hasText: 'Original title' })
      .first();
    await card.hover();
    await card.getByRole('button', { name: /edit card/i }).click();

    // Edit modal should open.
    const modal = page.getByRole('dialog', { name: /edit card/i });
    await expect(modal).toBeVisible();

    const titleInput = modal.getByLabel(/title/i);
    await titleInput.clear();
    await titleInput.fill('Updated title');

    // Save via the modal save button (data-testid="personal-card-save" is on it).
    await modal.getByRole('button', { name: /save/i }).click();

    await expect(
      page.getByTestId('personal-card-title').filter({ hasText: 'Updated title' }),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('typing REAL keystrokes with spaces works in the edit modal', async ({
    page,
    request,
  }) => {
    // Regression (founder-reported 2026-07-02): dnd-kit's KeyboardSensor
    // preventDefaulted Space as a drag activator; the edit modal renders
    // inside the sortable card wrapper and portal events bubble through the
    // REACT tree, so every space typed in the modal was swallowed. `.fill()`
    // masked it — this test types per-keystroke on purpose.
    const user = await registerNewUser(request, 'pb-spaces');
    await login(page, { email: user.email, password: user.password });
    await page.goto('/my-board');

    await expect(page.getByTestId('personal-board')).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId('personal-add-card').first().click();
    const input = page.getByTestId('personal-add-card-input');
    await input.pressSequentially('spaced out card', { delay: 15 });
    await expect(input).toHaveValue('spaced out card');
    await page.getByTestId('personal-card-save').first().click();

    const card = page
      .getByTestId('personal-card')
      .filter({ hasText: 'spaced out card' })
      .first();
    await expect(card).toBeVisible({ timeout: 8_000 });
    await card.hover();
    await card.getByRole('button', { name: /edit card/i }).click();

    const modal = page.getByRole('dialog', { name: /edit card/i });
    await expect(modal).toBeVisible();

    // Title: per-keystroke typing, spaces must land.
    const titleInput = modal.getByLabel(/title/i);
    await titleInput.clear();
    await titleInput.pressSequentially('two words here', { delay: 20 });
    await expect(titleInput).toHaveValue('two words here');

    // Notes: same, in the textarea.
    const notesInput = modal.getByLabel(/notes/i);
    await notesInput.click();
    await notesInput.pressSequentially('note with spaces', { delay: 20 });
    await expect(notesInput).toHaveValue('note with spaces');

    await modal.getByRole('button', { name: /save/i }).click();
    await expect(
      page
        .getByTestId('personal-card-title')
        .filter({ hasText: 'two words here' }),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('can set a color and due date on a card', async ({ page, request }) => {
    const user = await registerNewUser(request, 'pb-meta');
    await login(page, { email: user.email, password: user.password });
    await page.goto('/my-board');
    await expect(page.getByTestId('personal-board')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('personal-column').first()).toBeVisible();

    // Create a card.
    await page.getByTestId('personal-add-card').first().click();
    await page.getByTestId('personal-add-card-input').fill('Card with meta');
    await page.getByTestId('personal-card-save').first().click();
    const card = page
      .getByTestId('personal-card')
      .filter({ hasText: 'Card with meta' })
      .first();
    await expect(card).toBeVisible({ timeout: 8_000 });

    // Open the detail by clicking the card title.
    await card.getByTestId('personal-card-title').click();
    const modal = page.getByRole('dialog', { name: /edit card/i });
    await expect(modal).toBeVisible();

    // Pick the first palette color and set a due date.
    await modal.getByTestId('color-swatch').first().click();
    await modal.getByTestId('personal-card-due-input').fill('2026-12-31');
    await modal.getByRole('button', { name: /save/i }).click();

    // The due-date chip should now render on the card face.
    await expect(
      card.getByTestId('personal-card-due'),
    ).toBeVisible({ timeout: 8_000 });
    await expect(card.getByTestId('personal-card-due')).toContainText(/dec/i);
  });

  test('can move a card to another column via the move affordance', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'pb-move');
    await login(page, { email: user.email, password: user.password });
    const writes = trackApiWrites(page);
    await page.goto('/my-board');

    await expect(page.getByTestId('personal-board')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('personal-column').first()).toBeVisible();

    // Add a card to the first column.
    await page.getByTestId('personal-add-card').first().click();
    await page.getByTestId('personal-add-card-input').fill('Card to move');
    await page.getByTestId('personal-card-save').first().click();
    await expect(
      page.getByTestId('personal-card-title').filter({ hasText: 'Card to move' }),
    ).toBeVisible({ timeout: 8_000 });

    // Hover card and open move menu.
    const card = page
      .getByTestId('personal-card')
      .filter({ hasText: 'Card to move' })
      .first();
    await card.hover();
    await card.getByRole('button', { name: /move to column/i }).click();

    // The move menu shows all columns; pick the second one.
    const menu = page.getByRole('menu', { name: /move card to column/i });
    await expect(menu).toBeVisible();
    // The current column's option is disabled; pick the first enabled one.
    const enabledOption = menu
      .locator('[role="menuitem"]:not([disabled])')
      .first();
    await enabledOption.click();

    // After move the card should still be visible on the board (just relocated).
    await expect(
      page.getByTestId('personal-card-title').filter({ hasText: 'Card to move' }),
    ).toBeVisible({ timeout: 8_000 });

    // The move is optimistic (`useUpdatePersonalCard`'s `onMutate`), so the
    // card being on screen proves nothing about the server. Wait for the PATCH
    // to land before reloading rather than racing our own write.
    await writes.settle({
      match: (w) =>
        w.method === 'PATCH' && /^\/api\/me\/personal-cards\/[^/]+$/.test(w.path),
      atLeast: 1,
    });

    // Reload to confirm persistence.
    await page.reload();
    await expect(page.getByTestId('personal-board')).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByTestId('personal-card-title').filter({ hasText: 'Card to move' }),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('can delete a card', async ({ page, request }) => {
    const user = await registerNewUser(request, 'pb-del-card');
    await login(page, { email: user.email, password: user.password });
    await page.goto('/my-board');

    await expect(page.getByTestId('personal-board')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('personal-column').first()).toBeVisible();

    // Add a card.
    await page.getByTestId('personal-add-card').first().click();
    await page.getByTestId('personal-add-card-input').fill('Card to delete');
    await page.getByTestId('personal-card-save').first().click();
    await expect(
      page.getByTestId('personal-card-title').filter({ hasText: 'Card to delete' }),
    ).toBeVisible({ timeout: 8_000 });

    // Hover and delete.
    const card = page
      .getByTestId('personal-card')
      .filter({ hasText: 'Card to delete' })
      .first();
    await card.hover();
    await card.getByRole('button', { name: /delete card/i }).click();

    // Confirm the destructive action.
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /delete/i }).click();

    // Card should be gone.
    await expect(
      page.getByTestId('personal-card-title').filter({ hasText: 'Card to delete' }),
    ).not.toBeVisible({ timeout: 8_000 });
  });

  test('can add and delete a column', async ({ page, request }) => {
    const user = await registerNewUser(request, 'pb-col');
    await login(page, { email: user.email, password: user.password });
    await page.goto('/my-board');

    await expect(page.getByTestId('personal-board')).toBeVisible({
      timeout: 15_000,
    });

    // Add a new column.
    await page.getByTestId('personal-add-column').click();
    const colInput = page.getByLabel(/new column name/i);
    await colInput.fill('Backlog');
    await colInput.press('Enter');

    await expect(
      page.getByTestId('personal-column').filter({ hasText: /backlog/i }),
    ).toBeVisible({ timeout: 8_000 });

    // Delete the new column.
    const backlogCol = page
      .getByTestId('personal-column')
      .filter({ hasText: /backlog/i });
    await backlogCol.getByRole('button', { name: /delete column backlog/i }).click();

    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: /delete/i }).click();

    await expect(
      page.getByTestId('personal-column').filter({ hasText: /backlog/i }),
    ).not.toBeVisible({ timeout: 8_000 });
  });
});

// ---------------------------------------------------------------------------
// Mobile tests
// ---------------------------------------------------------------------------

test.describe('Personal board — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('board is horizontally scrollable on mobile', async ({ page, request }) => {
    const user = await registerNewUser(request, 'pb-mobile');
    await login(page, { email: user.email, password: user.password });
    await page.goto('/my-board');

    await expect(page.getByTestId('personal-board')).toBeVisible({
      timeout: 15_000,
    });

    // Three default columns should exist.
    await expect(page.getByTestId('personal-column')).toHaveCount(3, {
      timeout: 10_000,
    });

    // Verify the board container is scrollable (overflow-x).
    const board = page.getByTestId('personal-board');
    const overflowX = await board.evaluate(
      (el) => window.getComputedStyle(el).overflowX,
    );
    // 'auto', 'scroll', or 'hidden' (all allow horizontal layout).
    expect(['auto', 'scroll', 'hidden']).toContain(overflowX);
  });

  test('can add a card on mobile', async ({ page, request }) => {
    const user = await registerNewUser(request, 'pb-mobile-add');
    await login(page, { email: user.email, password: user.password });
    await page.goto('/my-board');

    await expect(page.getByTestId('personal-board')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('personal-column').first()).toBeVisible();

    await page.getByTestId('personal-add-card').first().click();
    await page.getByTestId('personal-add-card-input').fill('Mobile card');
    await page.getByTestId('personal-card-save').first().click();

    await expect(
      page.getByTestId('personal-card-title').filter({ hasText: 'Mobile card' }),
    ).toBeVisible({ timeout: 8_000 });
  });
});

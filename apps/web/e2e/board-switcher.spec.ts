/**
 * e2e: Board switcher — multiple boards per project.
 *
 * Covers (desktop + mobile):
 * - Default board is visible on the board page.
 * - Board switcher button is rendered.
 * - Create a new Scrum board via the switcher.
 * - Switch between boards.
 * - Rename a board via board settings.
 * - Delete a non-default board.
 * - Confirm the default board cannot be deleted (button disabled / toast).
 *
 * Board creation, update, and delete are done via the API where the backend is
 * expected to be running. Because the backend for "multiple boards per project"
 * is being built in a parallel slice, these tests are authored to the fixed
 * contract and will pass once the API endpoints land. All API calls follow the
 * pattern used in helpers.ts.
 *
 * Uses isolated projects so the shared demo is never polluted.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupIsolatedProject, API_URL } from './helpers';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

interface BoardSummary {
  id: string;
  name: string;
  type: 'KANBAN' | 'SCRUM';
  isDefault: boolean;
}

/** List all boards for a project via the API. */
async function listBoards(
  request: APIRequestContext,
  token: string,
  projectId: string,
): Promise<BoardSummary[]> {
  const res = await request.get(
    `${API_URL}/api/projects/${projectId}/boards`,
    { headers: authHeaders(token) },
  );
  expect(res.ok(), `list boards failed: ${res.status()}`).toBeTruthy();
  return res.json() as Promise<BoardSummary[]>;
}

/** Create a board for a project via the API. */
async function createBoard(
  request: APIRequestContext,
  token: string,
  projectId: string,
  name: string,
  type: 'KANBAN' | 'SCRUM' = 'KANBAN',
): Promise<BoardSummary> {
  const res = await request.post(
    `${API_URL}/api/projects/${projectId}/boards`,
    { headers: authHeaders(token), data: { name, type } },
  );
  expect(res.ok(), `create board failed: ${res.status()}`).toBeTruthy();
  return res.json() as Promise<BoardSummary>;
}

// ---------------------------------------------------------------------------
// Desktop tests
// ---------------------------------------------------------------------------

test.describe('Board switcher — desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('default board is visible and switcher is rendered', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'switcher-default',
      projectName: 'Switcher Project',
    });

    // The board page should already be open (setupIsolatedProject navigates there).
    // The board switcher trigger should be visible.
    const switcher = page.getByTestId('board-switcher');
    await expect(switcher).toBeVisible({ timeout: 15_000 });

    // It should show the default board name.
    const boards = await listBoards(request, ctx.token, ctx.project.id);
    const defaultBoard = boards.find((b) => b.isDefault) ?? boards[0];
    if (defaultBoard) {
      await expect(switcher).toContainText(defaultBoard.name);
    }

    // Basic board columns are visible (the project is seeded with default statuses).
    await expect(page.getByText(/to do/i).first()).toBeVisible();
  });

  test('create a new Scrum board and switch to it', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'switcher-create',
      projectName: 'Create Board Project',
    });

    const switcher = page.getByTestId('board-switcher');
    await expect(switcher).toBeVisible({ timeout: 15_000 });

    // Open the switcher dropdown.
    await switcher.click();

    // Click "New board" to open the create modal.
    await page.getByRole('button', { name: /new board/i }).click();

    // Fill in the name.
    const stamp = Date.now();
    const boardName = `Scrum Board ${stamp}`;
    const nameInput = page.getByTestId('board-create-name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(boardName);

    // Change type to Scrum.
    const typeSelect = page.getByTestId('board-type-select');
    await typeSelect.selectOption({ label: 'Scrum' });

    // Submit.
    const createBtn = page.getByTestId('board-create-button');
    await createBtn.click();

    // The new board should now be selected — its name appears in the switcher.
    await expect(switcher).toContainText(boardName, { timeout: 10_000 });

    // The Scrum badge should appear on the switcher.
    await expect(switcher).toContainText(/scrum/i);

    // Verify via API that the board was created.
    const boards = await listBoards(request, ctx.token, ctx.project.id);
    const created = boards.find((b) => b.name === boardName);
    expect(created).toBeDefined();
    expect(created?.type).toBe('SCRUM');
  });

  test('switch between boards', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'switcher-switch',
      projectName: 'Switch Board Project',
    });

    // Seed a second board via the API.
    const stamp = Date.now();
    const secondName = `Second Board ${stamp}`;
    await createBoard(request, ctx.token, ctx.project.id, secondName, 'KANBAN');

    // Reload the board page so the boards list is fresh.
    await page.reload();

    const switcher = page.getByTestId('board-switcher');
    await expect(switcher).toBeVisible({ timeout: 15_000 });

    // Open the switcher and click the second board.
    await switcher.click();
    const secondOption = page.getByTestId('board-switcher-option').filter({
      hasText: secondName,
    });
    await expect(secondOption).toBeVisible({ timeout: 5_000 });
    await secondOption.click();

    // The switcher should now show the second board's name.
    await expect(switcher).toContainText(secondName, { timeout: 10_000 });
  });

  test('rename a board via board settings', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'switcher-rename',
      projectName: 'Rename Board Project',
    });

    // Seed a second board to rename (so we don't rename the default).
    const stamp = Date.now();
    const originalName = `Rename Me ${stamp}`;
    await createBoard(request, ctx.token, ctx.project.id, originalName, 'KANBAN');

    await page.reload();

    const switcher = page.getByTestId('board-switcher');
    await expect(switcher).toBeVisible({ timeout: 15_000 });

    // Open the switcher.
    await switcher.click();

    // Hover over the second board row to reveal the settings gear.
    const boardRow = page.getByTestId('board-switcher-option').filter({
      hasText: originalName,
    });
    await expect(boardRow).toBeVisible({ timeout: 5_000 });
    await boardRow.hover();

    // Click the settings button for that board.
    const settingsBtn = boardRow
      .locator('..') // the parent group div
      .getByTestId('board-settings-button');
    await settingsBtn.click();

    // The settings modal should open.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Rename the board.
    const renamedName = `Renamed Board ${stamp}`;
    const nameInput = dialog.getByLabel('Name');
    await nameInput.fill('');
    await nameInput.pressSequentially(renamedName, { delay: 10 });

    // Save.
    await dialog.getByRole('button', { name: /save/i }).click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // The renamed board should appear in the switcher.
    await switcher.click();
    await expect(
      page.getByTestId('board-switcher-option').filter({ hasText: renamedName }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('delete a non-default board', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'switcher-delete',
      projectName: 'Delete Board Project',
    });

    // Seed a second board to delete.
    const stamp = Date.now();
    const deletableName = `Delete Me ${stamp}`;
    await createBoard(
      request,
      ctx.token,
      ctx.project.id,
      deletableName,
      'KANBAN',
    );

    await page.reload();

    const switcher = page.getByTestId('board-switcher');
    await expect(switcher).toBeVisible({ timeout: 15_000 });

    // Open switcher, hover the board, click its settings.
    await switcher.click();
    const boardRow = page.getByTestId('board-switcher-option').filter({
      hasText: deletableName,
    });
    await expect(boardRow).toBeVisible({ timeout: 5_000 });
    await boardRow.hover();
    const settingsBtn = boardRow.locator('..').getByTestId('board-settings-button');
    await settingsBtn.click();

    // Delete via the settings modal.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const deleteBtn = dialog.getByTestId('board-delete-button');
    await expect(deleteBtn).toBeEnabled();
    await deleteBtn.click();

    // Confirm the destructive action. The ConfirmDialog uses role="alertdialog"
    // (correct a11y for a destructive confirm), and the settings modal is hidden
    // while the confirm is open, so query the alertdialog specifically.
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible({ timeout: 5_000 });
    await confirmDialog.getByRole('button', { name: /delete board/i }).click();

    // The modal should close and the board should no longer appear.
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // Verify via API that the board is gone.
    const boards = await listBoards(request, ctx.token, ctx.project.id);
    expect(boards.find((b) => b.name === deletableName)).toBeUndefined();
  });

  test('default board cannot be deleted', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'switcher-nodelete',
      projectName: 'No Delete Default Project',
    });

    const switcher = page.getByTestId('board-switcher');
    await expect(switcher).toBeVisible({ timeout: 15_000 });

    // Open the switcher and open settings for the default board.
    await switcher.click();

    // Get all board options; the default one is the only one (just seeded).
    const defaultOption = page.getByTestId('board-switcher-option').first();
    await defaultOption.hover();
    const settingsBtn = defaultOption.locator('..').getByTestId('board-settings-button');
    await settingsBtn.click();

    // In the settings modal the delete button should be disabled.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    const deleteBtn = dialog.getByTestId('board-delete-button');
    await expect(deleteBtn).toBeDisabled();

    // Close the modal.
    await dialog.getByRole('button', { name: /cancel/i }).click();
  });
});

// ---------------------------------------------------------------------------
// Mobile tests
// ---------------------------------------------------------------------------

test.describe('Board switcher — mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('board switcher is visible and functional on mobile', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'switcher-mobile',
      projectName: 'Mobile Switcher Project',
    });

    const switcher = page.getByTestId('board-switcher');
    await expect(switcher).toBeVisible({ timeout: 15_000 });

    // Open the switcher.
    await switcher.click();

    // The dropdown should appear.
    const dropdown = page.getByRole('listbox', { name: /board list/i });
    await expect(dropdown).toBeVisible({ timeout: 5_000 });

    // Close by pressing Escape.
    await page.keyboard.press('Escape');
    await expect(dropdown).toBeHidden({ timeout: 5_000 });
  });

  test('create a new board on mobile', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'switcher-mobile-create',
      projectName: 'Mobile Create Board Project',
    });

    const switcher = page.getByTestId('board-switcher');
    await expect(switcher).toBeVisible({ timeout: 15_000 });

    await switcher.click();
    await page.getByRole('button', { name: /new board/i }).click();

    const stamp = Date.now();
    const boardName = `Mobile Board ${stamp}`;
    await page.getByTestId('board-create-name').fill(boardName);

    // Leave type as Kanban (default).
    await page.getByTestId('board-create-button').click();

    // New board should be selected.
    await expect(switcher).toContainText(boardName, { timeout: 10_000 });
  });

  test('default board cannot be deleted on mobile', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, {
      label: 'switcher-mobile-nodelete',
      projectName: 'Mobile No Delete Project',
    });

    const switcher = page.getByTestId('board-switcher');
    await expect(switcher).toBeVisible({ timeout: 15_000 });

    await switcher.click();

    const defaultOption = page.getByTestId('board-switcher-option').first();
    await defaultOption.hover();
    const settingsBtn = defaultOption.locator('..').getByTestId('board-settings-button');
    await settingsBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByTestId('board-delete-button')).toBeDisabled();

    await dialog.getByRole('button', { name: /cancel/i }).click();
  });
});

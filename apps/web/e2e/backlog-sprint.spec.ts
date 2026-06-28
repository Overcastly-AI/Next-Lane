import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * End-to-end coverage of the backlog + sprint planning view:
 *  - create a sprint,
 *  - move a backlog issue into it,
 *  - start the sprint (the issue then appears on the board),
 *  - complete the sprint (its incomplete issues return to the backlog).
 *
 * Each test creates its OWN project (unique key) so the single-active-sprint
 * invariant never causes cross-test contention when desktop + mobile run in
 * parallel against the shared API.
 */

let seq = 0;

/** Create a fresh project via the dashboard and land on its empty board. */
async function createProject(page: Page): Promise<{ key: string }> {
  await login(page);
  const stamp = `${Date.now()}${seq++}`.slice(-9);
  const key = `Q${stamp}`.slice(0, 8).toUpperCase();
  const name = `QA Backlog ${stamp}`;

  await page.getByRole('button', { name: '+ New Project' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill(name);
  // The key auto-derives from the name; overwrite it to guarantee uniqueness.
  const keyInput = dialog.getByLabel('Key');
  await keyInput.fill('');
  await keyInput.fill(key);
  // Submit via Enter (the submit button targets form="create-project-form").
  // A pointer click races footer-button hit-testing on emulated mobile.
  await keyInput.press('Enter');
  await expect(page).toHaveURL(/\/board/, { timeout: 15_000 });
  return { key };
}

/** Create one issue on the current board and return its title. */
async function createIssue(page: Page): Promise<string> {
  const title = `Backlog issue ${Date.now()}${seq++}`;
  await page.getByRole('button', { name: /\+ Create issue/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 });
  return title;
}

async function gotoBacklog(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Backlog' }).click();
  await expect(page).toHaveURL(/\/backlog/, { timeout: 15_000 });
  await expect(
    page.getByRole('heading', { level: 1, name: 'Backlog' }),
  ).toBeVisible();
  await expect(page.locator('[data-testid="section-backlog"]')).toBeVisible();
}

async function createSprint(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '+ Create sprint' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}

function sprintSection(page: Page, name: string) {
  return page
    .locator('[data-testid="section-sprint"]')
    .filter({ hasText: name });
}

test.describe('Backlog & sprint planning', () => {
  test('create sprint, move issue in, start, then complete returns it to backlog', async ({
    page,
  }) => {
    await createProject(page);
    await createIssue(page);
    await gotoBacklog(page);

    const sprintName = `QA Sprint ${Date.now()}`;
    await createSprint(page, sprintName);

    const section = sprintSection(page, sprintName);
    await expect(section).toBeVisible();
    await expect(section.getByText('Planned')).toBeVisible();

    // Move the only backlog issue into the sprint.
    const backlog = page.locator('[data-testid="section-backlog"]');
    const firstIssue = backlog.locator('[data-testid="backlog-issue"]').first();
    await expect(firstIssue).toBeVisible();
    const issueKey = await firstIssue.getAttribute('data-issue-key');
    expect(issueKey).toBeTruthy();

    await firstIssue.getByRole('button', { name: /move to/i }).click();
    await page.getByRole('menuitem', { name: sprintName }).click();

    await expect(
      section.locator(`[data-issue-key="${issueKey}"]`),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      backlog.locator(`[data-issue-key="${issueKey}"]`),
    ).toHaveCount(0);

    // Start the sprint (no other sprint exists in this isolated project).
    await section.getByRole('button', { name: 'Start sprint' }).click();
    await expect(section.getByText('Active')).toBeVisible({ timeout: 10_000 });

    // The issue now appears on the kanban board (active-sprint issues show there).
    // Use exact match: a "My Board" header link also exists.
    await page.getByRole('link', { name: 'Board', exact: true }).click();
    await expect(page).toHaveURL(/\/board/, { timeout: 15_000 });
    await expect(page.getByText(issueKey!).first()).toBeVisible({
      timeout: 10_000,
    });

    // Complete the sprint — its incomplete issue returns to the backlog.
    await gotoBacklog(page);
    await sprintSection(page, sprintName)
      .getByRole('button', { name: 'Complete sprint' })
      .click();
    // ConfirmDialog uses role="alertdialog" (the ARIA role for destructive confirmations).
    const completeDialog = page.getByRole('alertdialog');
    await expect(completeDialog).toBeVisible();
    await completeDialog
      .getByRole('button', { name: 'Complete sprint' })
      .click();
    await expect(completeDialog).toBeHidden({ timeout: 10_000 });

    // COMPLETED sprints are archived from the planning view; the issue is back.
    await expect(sprintSection(page, sprintName)).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(
      page
        .locator('[data-testid="section-backlog"]')
        .locator(`[data-issue-key="${issueKey}"]`),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('cannot start a second sprint while one is active', async ({ page }) => {
    await createProject(page);
    await gotoBacklog(page);

    const nameA = `QA Active ${Date.now()}`;
    const nameB = `QA Blocked ${Date.now()}`;
    await createSprint(page, nameA);
    await createSprint(page, nameB);

    const sectionA = sprintSection(page, nameA);
    await sectionA.getByRole('button', { name: 'Start sprint' }).click();
    await expect(sectionA.getByText('Active')).toBeVisible({ timeout: 10_000 });

    // The other planned sprint's Start button is disabled with a guidance note.
    const sectionB = sprintSection(page, nameB);
    await expect(
      sectionB.getByRole('button', { name: 'Start sprint' }),
    ).toBeDisabled();
    await expect(sectionB.getByText(/already active/i)).toBeVisible();
  });
});

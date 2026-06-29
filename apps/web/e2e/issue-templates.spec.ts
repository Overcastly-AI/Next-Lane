/**
 * issue-templates.spec.ts
 *
 * End-to-end tests for the Issue Templates feature:
 *  1. Admin creates a template in Settings → it appears in the list.
 *  2. "From template" menu on the board creates an issue with the template's
 *     type/priority applied and opens the issue drawer.
 *  3. Mobile (390px): templates manager renders without horizontal overflow.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupIsolatedProject, API_URL } from './helpers';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Create an issue template via the API; returns the created template id. */
async function createTemplate(
  request: APIRequestContext,
  token: string,
  projectId: string,
  opts: {
    name: string;
    issueType?: string;
    priority?: string;
    titleTemplate?: string;
    descriptionTemplate?: string;
  },
): Promise<string> {
  const res = await request.post(
    `${API_URL}/api/projects/${projectId}/issue-templates`,
    {
      headers: auth(token),
      data: {
        name: opts.name,
        issueType: opts.issueType ?? 'BUG',
        priority: opts.priority ?? 'HIGH',
        titleTemplate: opts.titleTemplate,
        descriptionTemplate: opts.descriptionTemplate,
      },
    },
  );
  expect(res.ok(), `create template failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

// ---------------------------------------------------------------------------
// Desktop tests
// ---------------------------------------------------------------------------

test.describe('Issue Templates — Settings UI (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('admin creates a template in Settings and it appears in the list', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'tpl-create',
      openBoard: false,
    });

    await page.goto(`/projects/${ctx.project.id}/settings`);

    // Wait for the templates section to appear.
    const section = page.getByTestId('templates-manager');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Click "Add template".
    await section.getByTestId('template-add').click();

    // Modal opens — fill in the name.
    const modal = page.getByRole('dialog', { name: /add issue template/i });
    await expect(modal).toBeVisible();
    await modal.getByTestId('template-name-input').fill('Bug Report');

    // Submit.
    await modal.getByTestId('template-save').click();

    // Modal closes; new template appears in the list.
    await expect(modal).not.toBeVisible({ timeout: 8_000 });
    await expect(
      section.getByTestId('template-row').filter({ hasText: 'Bug Report' }),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('duplicate template name shows friendly error', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'tpl-dup',
      openBoard: false,
    });

    // Pre-create a template via API.
    await createTemplate(request, ctx.token, ctx.project.id, { name: 'Existing' });

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const section = page.getByTestId('templates-manager');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Try to create another with the same name.
    await section.getByTestId('template-add').click();
    const modal = page.getByRole('dialog', { name: /add issue template/i });
    await expect(modal).toBeVisible();
    await modal.getByTestId('template-name-input').fill('Existing');
    await modal.getByTestId('template-save').click();

    // Friendly toast about duplicate.
    await expect(page.getByRole('alert')).toContainText(
      /already exists|duplicate|conflict/i,
      { timeout: 8_000 },
    );
  });

  test('admin can delete a template', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'tpl-del',
      openBoard: false,
    });

    // Pre-create a template via API.
    await createTemplate(request, ctx.token, ctx.project.id, { name: 'ToDelete' });

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const section = page.getByTestId('templates-manager');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Find the row.
    const row = section
      .getByTestId('template-row')
      .filter({ hasText: 'ToDelete' });
    await expect(row).toBeVisible({ timeout: 8_000 });

    // Click the delete icon button within that row.
    await row.getByRole('button', { name: /delete ToDelete/i }).click();

    // Confirm dialog.
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /delete template/i }).click();

    // Row disappears.
    await expect(row).not.toBeVisible({ timeout: 8_000 });
  });

  test('"From template" menu on the board creates an issue with template type/priority', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'tpl-board',
      openBoard: false,
    });

    // Pre-create a template with a specific type and priority.
    await createTemplate(request, ctx.token, ctx.project.id, {
      name: 'Quick Bug',
      issueType: 'BUG',
      priority: 'HIGH',
      titleTemplate: 'Bug from template',
    });

    // Navigate to the board.
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // The "From template" button should be visible.
    const menuButton = page.getByTestId('new-from-template-menu');
    await expect(menuButton).toBeVisible({ timeout: 8_000 });

    // Click to open the menu.
    await menuButton.click();

    // The template option should appear.
    const option = page.getByTestId('new-from-template-option').filter({
      hasText: 'Quick Bug',
    });
    await expect(option).toBeVisible({ timeout: 5_000 });

    // Select it.
    await option.click();

    // The new issue should appear on the board and the drawer should open.
    const issueTitle = 'Bug from template';
    // Wait for either the card or the drawer to show the pre-filled title.
    await expect(
      page.getByText(issueTitle).first(),
    ).toBeVisible({ timeout: 15_000 });

    // The drawer should be open — verify the issue type and priority inside it.
    const drawer = page.getByRole('dialog').last();
    await expect(drawer).toBeVisible({ timeout: 8_000 });

    // Priority select inside the drawer should show "High".
    const prioritySelect = drawer.getByLabel('Priority');
    await expect(prioritySelect).toHaveValue('HIGH', { timeout: 5_000 });

    // Type select inside the drawer should show "Bug".
    const typeSelect = drawer.getByLabel('Type');
    await expect(typeSelect).toHaveValue('BUG', { timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Mobile test — overflow check
// ---------------------------------------------------------------------------

test.describe('Issue Templates — mobile (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('templates manager renders without horizontal page overflow', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'tpl-mob',
      openBoard: false,
    });

    // Seed a template so the list is non-empty.
    await createTemplate(request, ctx.token, ctx.project.id, {
      name: 'Mobile Test Template',
    });

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const section = page.getByTestId('templates-manager');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Verify no horizontal overflow.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

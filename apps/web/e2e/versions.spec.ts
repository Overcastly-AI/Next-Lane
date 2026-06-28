/**
 * versions.spec.ts
 *
 * End-to-end tests for the Versions / Releases feature:
 *  1. Admin creates a version in Settings → appears in list.
 *  2. Admin releases a version → state badge updates to Released.
 *  3. Assign a version to an issue via the drawer multi-select → shows as chip.
 *  4. Duplicate version name shows friendly error toast.
 *  5. Admin can delete a version.
 *  6. Mobile: Settings versions section renders without horizontal overflow.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupIsolatedProject, createIssue, API_URL } from './helpers';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Create a version via the API. Returns the created version id. */
async function createVersion(
  request: APIRequestContext,
  token: string,
  projectId: string,
  name: string,
  description?: string,
): Promise<string> {
  const res = await request.post(
    `${API_URL}/api/projects/${projectId}/versions`,
    {
      headers: auth(token),
      data: { name, description },
    },
  );
  expect(res.ok(), `create version failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

// ---------------------------------------------------------------------------
// Desktop tests
// ---------------------------------------------------------------------------

test.describe('Versions — Settings UI (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('admin creates a version in Settings and it appears in the list', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ver-create',
      openBoard: false,
    });

    await page.goto(`/projects/${ctx.project.id}/settings`);

    // Wait for the versions section to be visible.
    const section = page.getByTestId('versions-section');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Click "Add version".
    await section.getByTestId('version-add').click();

    // Modal opens — fill in the name.
    const modal = page.getByRole('dialog', { name: 'Add version' });
    await expect(modal).toBeVisible();
    await modal.getByTestId('version-name-input').fill('v1.0.0');

    // Submit.
    await modal.getByTestId('version-save').click();

    // Modal closes and the new version appears in the list.
    await expect(modal).not.toBeVisible({ timeout: 8_000 });
    await expect(
      section.getByTestId('version-row').filter({ hasText: 'v1.0.0' }),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('admin can release a version — state badge updates to Released', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ver-release',
      openBoard: false,
    });

    // Pre-create a version via API.
    await createVersion(request, ctx.token, ctx.project.id, 'v2.0.0');

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const section = page.getByTestId('versions-section');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Find the version row.
    const row = section
      .getByTestId('version-row')
      .filter({ hasText: 'v2.0.0' });
    await expect(row).toBeVisible({ timeout: 8_000 });

    // The row should initially show the "Unreleased" state badge.
    await expect(row).toContainText('Unreleased');

    // Click the release action button.
    await row.getByTestId('version-release').click();

    // State badge should now show "Released".
    await expect(row).toContainText('Released', { timeout: 8_000 });
  });

  test('version appears in issue drawer multi-select and can be assigned', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ver-drawer',
      openBoard: false,
    });

    // Create a version via API.
    await createVersion(
      request,
      ctx.token,
      ctx.project.id,
      'v1.1.0',
      'First patch release',
    );

    // Create an issue.
    await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Test version assign',
    });

    // Navigate to the board and open the issue drawer.
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Click the issue card to open the drawer.
    await page.getByText('Test version assign').first().click();

    // The drawer should be visible.
    const drawer = page.getByRole('dialog').last();
    await expect(drawer).toBeVisible({ timeout: 10_000 });

    // The versions picker should be present.
    const picker = drawer.getByTestId('issue-versions-picker');
    await expect(picker).toBeVisible();

    // Click "Add version" to open the dropdown.
    await picker.getByRole('button', { name: /add version/i }).click();

    // Select the "v1.1.0" version in the listbox.
    const listbox = picker.getByRole('listbox');
    await expect(listbox).toBeVisible();
    await listbox.getByText('v1.1.0').click();

    // The chip "v1.1.0" should appear in the picker area.
    await expect(picker).toContainText('v1.1.0', { timeout: 8_000 });

    // Close drawer and reopen to verify persistence.
    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible({ timeout: 8_000 });

    await page.getByText('Test version assign').first().click();
    const drawerAgain = page.getByRole('dialog').last();
    await expect(drawerAgain).toBeVisible({ timeout: 10_000 });

    // Versions chip should still be present.
    const pickerAgain = drawerAgain.getByTestId('issue-versions-picker');
    await expect(pickerAgain).toBeVisible();
    await expect(pickerAgain).toContainText('v1.1.0', { timeout: 8_000 });
  });

  test('duplicate version name shows friendly error', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ver-dup',
      openBoard: false,
    });

    // Pre-create a version via API.
    await createVersion(request, ctx.token, ctx.project.id, 'v1.0.0-beta');

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const section = page.getByTestId('versions-section');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Try to create another version with the same name.
    await section.getByTestId('version-add').click();
    const modal = page.getByRole('dialog', { name: 'Add version' });
    await expect(modal).toBeVisible();
    await modal.getByTestId('version-name-input').fill('v1.0.0-beta');
    await modal.getByTestId('version-save').click();

    // Should show an error toast about duplicate name.
    await expect(page.getByRole('alert')).toContainText(
      /already exists|duplicate|conflict/i,
      { timeout: 8_000 },
    );
  });

  test('admin can delete a version', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ver-del',
      openBoard: false,
    });

    // Pre-create a version via API.
    await createVersion(request, ctx.token, ctx.project.id, 'v-to-delete');

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const section = page.getByTestId('versions-section');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Find the row.
    const row = section
      .getByTestId('version-row')
      .filter({ hasText: 'v-to-delete' });
    await expect(row).toBeVisible({ timeout: 8_000 });

    // Click the delete icon button within that row.
    await row.getByRole('button', { name: /delete v-to-delete/i }).click();

    // Confirm dialog appears.
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /delete version/i }).click();

    // Row should disappear.
    await expect(row).not.toBeVisible({ timeout: 8_000 });
  });
});

// ---------------------------------------------------------------------------
// Mobile test — overflow check
// ---------------------------------------------------------------------------

test.describe('Versions — mobile (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Settings versions section renders without horizontal page overflow', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ver-mob',
      openBoard: false,
    });

    // Seed a version so the list is non-empty.
    await createVersion(request, ctx.token, ctx.project.id, 'v1.0.0-mobile');

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const section = page.getByTestId('versions-section');
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

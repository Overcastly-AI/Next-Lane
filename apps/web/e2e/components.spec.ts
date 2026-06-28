/**
 * components.spec.ts
 *
 * End-to-end tests for the Components feature:
 *  1. Admin creates a component in Settings → it appears in the list.
 *  2. Set the component on an issue via the drawer picker → it shows.
 *  3. Mobile: Settings components section renders without horizontal overflow.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupIsolatedProject, createIssue, API_URL } from './helpers';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Create a component via the API. Returns the created component id. */
async function createComponent(
  request: APIRequestContext,
  token: string,
  projectId: string,
  name: string,
  description?: string,
): Promise<string> {
  const res = await request.post(
    `${API_URL}/api/projects/${projectId}/components`,
    {
      headers: auth(token),
      data: { name, description },
    },
  );
  expect(res.ok(), `create component failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

// ---------------------------------------------------------------------------
// Desktop tests
// ---------------------------------------------------------------------------

test.describe('Components — Settings UI (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('admin creates a component in Settings and it appears in the list', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'comp-create',
      openBoard: false,
    });

    await page.goto(`/projects/${ctx.project.id}/settings`);

    // Wait for the components section to be visible.
    const section = page.getByTestId('components-section');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Click "Add component".
    await section.getByTestId('component-add').click();

    // Modal opens — fill in the name.
    const modal = page.getByRole('dialog', { name: 'Add component' });
    await expect(modal).toBeVisible();
    await modal.getByTestId('component-name-input').fill('Authentication');

    // Submit.
    await modal.getByTestId('component-save').click();

    // Modal closes and the new component appears in the list.
    await expect(modal).not.toBeVisible({ timeout: 8_000 });
    await expect(section.getByTestId('component-row').filter({ hasText: 'Authentication' })).toBeVisible({
      timeout: 8_000,
    });
  });

  test('component appears in issue drawer picker and can be set', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'comp-drawer',
      openBoard: false,
    });

    // Create a component via API.
    await createComponent(
      request,
      ctx.token,
      ctx.project.id,
      'Backend',
      'Server-side logic',
    );

    // Create an issue.
    await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Test component assign',
    });

    // Navigate to the board and open the issue drawer.
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Click the issue card to open the drawer.
    await page.getByText('Test component assign').first().click();

    // The drawer should be visible.
    const drawer = page.getByRole('dialog').last();
    await expect(drawer).toBeVisible({ timeout: 10_000 });

    // The component picker should be present.
    const picker = drawer.getByTestId('issue-component-picker');
    await expect(picker).toBeVisible();

    // Select the "Backend" component.
    await picker.selectOption({ label: 'Backend' });

    // The selected value should now reflect "Backend".
    await expect(picker).toHaveValue(/\S+/, { timeout: 8_000 });

    // Close drawer and reopen to verify persistence.
    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible({ timeout: 8_000 });

    await page.getByText('Test component assign').first().click();
    const drawerAgain = page.getByRole('dialog').last();
    await expect(drawerAgain).toBeVisible({ timeout: 10_000 });

    // Component should still be set to Backend.
    const pickerAgain = drawerAgain.getByTestId('issue-component-picker');
    await expect(pickerAgain).toBeVisible();
    const selectedValue = await pickerAgain.inputValue();
    expect(selectedValue.length).toBeGreaterThan(0);
  });

  test('duplicate component name shows friendly error', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'comp-dup',
      openBoard: false,
    });

    // Pre-create a component via API.
    await createComponent(request, ctx.token, ctx.project.id, 'Frontend');

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const section = page.getByTestId('components-section');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Try to create another component with the same name.
    await section.getByTestId('component-add').click();
    const modal = page.getByRole('dialog', { name: 'Add component' });
    await expect(modal).toBeVisible();
    await modal.getByTestId('component-name-input').fill('Frontend');
    await modal.getByTestId('component-save').click();

    // Should show an error toast about duplicate name.
    await expect(page.getByRole('alert')).toContainText(
      /already exists|duplicate|conflict/i,
      { timeout: 8_000 },
    );
  });

  test('admin can delete a component', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'comp-del',
      openBoard: false,
    });

    // Pre-create a component via API.
    await createComponent(request, ctx.token, ctx.project.id, 'ToDelete');

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const section = page.getByTestId('components-section');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Find the row.
    const row = section
      .getByTestId('component-row')
      .filter({ hasText: 'ToDelete' });
    await expect(row).toBeVisible({ timeout: 8_000 });

    // Click the delete icon button within that row.
    await row.getByRole('button', { name: /delete toDelete/i }).click();

    // Confirm dialog appears.
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /delete component/i }).click();

    // Row should disappear.
    await expect(row).not.toBeVisible({ timeout: 8_000 });
  });
});

// ---------------------------------------------------------------------------
// Mobile test — overflow check
// ---------------------------------------------------------------------------

test.describe('Components — mobile (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Settings components section renders without horizontal page overflow', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'comp-mob',
      openBoard: false,
    });

    // Seed a component so the list is non-empty.
    await createComponent(request, ctx.token, ctx.project.id, 'Mobile UI');

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const section = page.getByTestId('components-section');
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

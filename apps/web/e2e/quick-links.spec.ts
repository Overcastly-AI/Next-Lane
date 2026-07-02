/**
 * Quick Links menu (AppHeader) — e2e coverage.
 *
 * This is one of the two zero-coverage surfaces flagged by two consecutive
 * audit passes (the other is workspace rename/delete, see
 * `workspace-settings.spec.ts`). Quick links are per-user shortcuts, so a
 * freshly-registered user always starts with an empty list — perfect for
 * asserting the empty state without any special setup.
 *
 * Runs on desktop AND mobile (both Playwright projects) except the explicit
 * 393px overflow check, which pins its own viewport per house style (see
 * `wip-limits.spec.ts`).
 */
import { test, expect, type Page } from '@playwright/test';
import { setupIsolatedProject } from './helpers';

// ── Local helpers ────────────────────────────────────────────────────────────

async function openMenu(page: Page): Promise<void> {
  await page.getByTestId('quick-links-button').click();
  await expect(page.getByRole('menu', { name: 'Quick links' })).toBeVisible();
}

/** The add-link form (there are two "Quick link label" inputs whenever a row
 * is mid-edit — the add form and the edit form both share the same testids —
 * so callers must scope to the right `<form>` via its accessible name. */
function addForm(page: Page) {
  return page.getByRole('form', { name: 'Add link' });
}

async function fillAddForm(
  page: Page,
  { label, url, group }: { label: string; url: string; group?: string },
): Promise<void> {
  const form = addForm(page);
  await form.getByTestId('add-quick-link-label').pressSequentially(label, {
    delay: 20,
  });
  await form.getByTestId('add-quick-link-url').pressSequentially(url, {
    delay: 20,
  });
  if (group) {
    await form.getByTestId('add-quick-link-group').pressSequentially(group, {
      delay: 20,
    });
  }
}

// ---------------------------------------------------------------------------
// Core flows — run on desktop AND mobile
// ---------------------------------------------------------------------------

test.describe('Quick Links menu', () => {
  test('shows an empty state on first open', async ({ page, request }) => {
    await setupIsolatedProject(page, request, { label: 'ql-empty' });
    await openMenu(page);
    await expect(page.getByTestId('quick-links-empty')).toBeVisible();
    await expect(page.getByTestId('quick-link-row')).toHaveCount(0);
  });

  test('adding a link with a spaced label and https URL renders as a new-tab anchor with the right href', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'ql-add' });
    await openMenu(page);

    await fillAddForm(page, {
      label: 'My Design Tool',
      url: 'https://figma.com/files',
    });
    await addForm(page).getByTestId('add-quick-link-submit').click();

    const anchor = page.getByRole('menuitem', { name: 'My Design Tool' });
    await expect(anchor).toBeVisible({ timeout: 10_000 });
    await expect(anchor).toHaveAttribute('href', 'https://figma.com/files');
    await expect(anchor).toHaveAttribute('target', '_blank');
    await expect(anchor).toHaveAttribute('rel', /noopener/);

    // Empty state is gone, the add form is still present (menu stays open).
    await expect(page.getByTestId('quick-links-empty')).toHaveCount(0);
  });

  test('rejects a non-http(s) URL (javascript:) with an inline error and does not save', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'ql-badproto' });
    await openMenu(page);

    await fillAddForm(page, {
      label: 'Sneaky Link',
      url: 'javascript:alert(1)',
    });
    await addForm(page).getByTestId('add-quick-link-submit').click();

    const error = page.getByTestId('add-quick-link-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText(/http/i);

    // Nothing was saved.
    await expect(page.getByTestId('quick-links-empty')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Sneaky Link' })).toHaveCount(0);
  });

  test('rejects a malformed URL ("not a url") and does not save', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'ql-badurl' });
    await openMenu(page);

    await fillAddForm(page, { label: 'Broken Link', url: 'not a url' });
    const urlField = addForm(page).getByTestId('add-quick-link-url');
    await addForm(page).getByTestId('add-quick-link-submit').click();

    // The <input type="url"> fails the browser's native URL constraint before
    // our custom `onSubmit` handler ever runs, so the app's styled
    // `add-quick-link-error` element does NOT appear for this particular
    // malformed input (unlike the javascript: case above, which IS valid URL
    // syntax and does reach our JS validator). This is a real, observable UX
    // inconsistency — two different invalid-URL inputs produce two different
    // feedback mechanisms (native browser tooltip vs. styled inline text) —
    // but it is not a data-integrity bug: nothing is ever saved either way.
    // Assert on the actual (native) feedback mechanism here.
    await expect(async () => {
      const validity = await urlField.evaluate((el: HTMLInputElement) => ({
        valid: el.validity.valid,
        message: el.validationMessage,
      }));
      expect(validity.valid).toBe(false);
      expect(validity.message.length).toBeGreaterThan(0);
    }).toPass({ timeout: 5_000 });

    await expect(page.getByTestId('quick-links-empty')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Broken Link' })).toHaveCount(0);
  });

  test('editing a link\'s label persists across a reload', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'ql-edit' });
    await openMenu(page);

    await fillAddForm(page, {
      label: 'Original Label Here',
      url: 'https://example.com/',
    });
    await addForm(page).getByTestId('add-quick-link-submit').click();
    await expect(
      page.getByRole('menuitem', { name: 'Original Label Here' }),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('quick-link-edit').click();
    const editForm = page.getByRole('form', { name: 'Save' });
    const editLabel = editForm.getByTestId('add-quick-link-label');
    await editLabel.click();
    await editLabel.press('Control+A');
    await editLabel.press('Backspace');
    await editLabel.pressSequentially('Updated Label Here', { delay: 20 });
    await editForm.getByTestId('add-quick-link-submit').click();

    await expect(
      page.getByRole('menuitem', { name: 'Updated Label Here' }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Original Label Here')).toHaveCount(0);

    // Cross-page/reload coherence: the rename must survive a full reload.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await openMenu(page);
    await expect(
      page.getByRole('menuitem', { name: 'Updated Label Here' }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Original Label Here')).toHaveCount(0);
  });

  test('deleting a link removes it, and it stays gone after a reload', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'ql-delete' });
    await openMenu(page);

    await fillAddForm(page, {
      label: 'Delete Me Please',
      url: 'https://example.com/',
    });
    await addForm(page).getByTestId('add-quick-link-submit').click();
    await expect(
      page.getByRole('menuitem', { name: 'Delete Me Please' }),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('quick-link-delete').click();
    await expect(page.getByTestId('quick-links-empty')).toBeVisible({
      timeout: 10_000,
    });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await openMenu(page);
    await expect(page.getByTestId('quick-links-empty')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('quick-link-row')).toHaveCount(0);
  });

  test('adding a link with a group and accent color renders under a group header', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'ql-group' });
    await openMenu(page);

    await fillAddForm(page, {
      label: 'Grouped Design Tool',
      url: 'https://figma.com/',
      group: 'Design Apps',
    });
    // Pick an accent color swatch (first curated swatch after "no color").
    await addForm(page).getByTestId('color-swatch').first().click();
    await addForm(page).getByTestId('add-quick-link-submit').click();

    await expect(
      page.getByRole('menuitem', { name: 'Grouped Design Tool' }),
    ).toBeVisible({ timeout: 10_000 });

    const groupHeader = page.getByTestId('quick-link-group-header');
    await expect(groupHeader).toBeVisible();
    await expect(groupHeader).toContainText(/design apps/i);

    // Group survives a reload too (same server-side persistence path).
    await page.reload();
    await page.waitForLoadState('networkidle');
    await openMenu(page);
    await expect(page.getByTestId('quick-link-group-header')).toContainText(
      /design apps/i,
      { timeout: 10_000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Mobile-specific: no horizontal overflow when the menu is open
// ---------------------------------------------------------------------------

test.describe('Quick Links menu — mobile (393px)', () => {
  test.use({ viewport: { width: 393, height: 851 } });

  test('menu opens and is usable at 393px without horizontal page overflow', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'ql-mobile' });

    const overflowBefore = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflowBefore).toBeLessThanOrEqual(1);

    await openMenu(page);
    await expect(page.getByTestId('quick-links-empty')).toBeVisible();

    // The dropdown itself must stay within the viewport (no clipped/offscreen
    // panel forcing a horizontal scrollbar on a 393px phone).
    const overflowAfter = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflowAfter).toBeLessThanOrEqual(1);

    // The form is actually usable: type into it and submit.
    await fillAddForm(page, {
      label: 'Mobile Quick Link',
      url: 'https://example.com/',
    });
    await addForm(page).getByTestId('add-quick-link-submit').click();
    await expect(
      page.getByRole('menuitem', { name: 'Mobile Quick Link' }),
    ).toBeVisible({ timeout: 10_000 });

    const overflowFinal = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflowFinal).toBeLessThanOrEqual(1);
  });
});

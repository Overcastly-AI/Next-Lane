/**
 * Workspace General settings — rename + delete (danger zone).
 *
 * This is one of the two zero-coverage surfaces flagged by two consecutive
 * audit passes (the other is the Quick Links menu, see
 * `quick-links.spec.ts`). Rename/delete is exactly the kind of
 * cross-page-state-coherence surface called out by the workspace-switcher
 * bug cluster (see `workspace-switcher.spec.ts`): a rename here must be
 * reflected by BOTH the header chip and the dashboard selector, survive a
 * reload, and a delete must heal every surface to a remaining workspace.
 *
 * Runs on desktop AND mobile (both Playwright projects).
 */
import { test, expect, type Page } from '@playwright/test';
import {
  addWorkspaceMember,
  createWorkspace,
  login,
  registerNewUser,
} from './helpers';

const chip = (page: Page) => page.getByTestId('workspace-chip');
const wsSelect = (page: Page) => page.locator('#pulse-ws-select');

/** Unique-suffixed workspace name pair per house style (slug de-dup safety). */
function suffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

async function gotoSettings(page: Page, workspaceId: string): Promise<void> {
  await page.goto(`/workspaces/${workspaceId}/settings`);
  await expect(
    page.getByRole('heading', { name: 'General settings' }),
  ).toBeVisible({ timeout: 15_000 });
}

async function typeIntoNameField(page: Page, value: string): Promise<void> {
  const input = page.getByTestId('workspace-name-input');
  await input.click();
  await input.press('Control+A');
  await input.press('Backspace');
  await input.pressSequentially(value, { delay: 20 });
}

// ---------------------------------------------------------------------------
// Rename — cross-page coherence
// ---------------------------------------------------------------------------

test.describe('Workspace settings — rename', () => {
  test('renaming updates the header chip AND the dashboard selector, and survives navigation + reload', async ({
    page,
    request,
  }) => {
    const s = suffix();
    const user = await registerNewUser(request, 'wsrename');
    const wsAId = await createWorkspace(request, user.token, `Rename A ${s}`);
    // A second workspace is required for the chip to render as a dropdown
    // (single-workspace users get a plain settings link instead) and for the
    // dashboard selector to show more than one option.
    await createWorkspace(request, user.token, `Rename B ${s}`);
    await login(page, { email: user.email, password: user.password });

    await gotoSettings(page, wsAId);
    const nameInput = page.getByTestId('workspace-name-input');
    await expect(nameInput).toHaveValue(new RegExp(`Rename A ${s}`), {
      timeout: 10_000,
    });

    const newName = `Renamed Alpha Space ${s}`;
    await typeIntoNameField(page, newName);

    const saveBtn = page.getByTestId('workspace-name-save');
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Surface A: the input itself reflects the save (button becomes disabled
    // again once the trimmed value matches the persisted name).
    await expect(saveBtn).toBeDisabled({ timeout: 10_000 });
    // Surface B: header chip, same page.
    await expect(chip(page)).toContainText(newName, { timeout: 10_000 });

    // Navigate away (dashboard) — surface C: the dashboard selector.
    await page.goto('/');
    await expect(chip(page)).toContainText(newName, { timeout: 10_000 });
    await expect(wsSelect(page).locator('option:checked')).toHaveText(
      newName,
      { timeout: 10_000 },
    );

    // Full reload — the rename must persist, not just live in client state.
    await page.reload();
    await expect(chip(page)).toContainText(newName, { timeout: 15_000 });
    await expect(wsSelect(page).locator('option:checked')).toHaveText(
      newName,
      { timeout: 15_000 },
    );
  });

  test('empty name is rejected (save stays disabled, nothing is submitted)', async ({
    page,
    request,
  }) => {
    const s = suffix();
    const user = await registerNewUser(request, 'wsrename-empty');
    const wsId = await createWorkspace(
      request,
      user.token,
      `Empty Guard ${s}`,
    );
    await login(page, { email: user.email, password: user.password });

    await gotoSettings(page, wsId);
    const nameInput = page.getByTestId('workspace-name-input');
    await expect(nameInput).toHaveValue(new RegExp(`Empty Guard ${s}`), {
      timeout: 10_000,
    });

    await nameInput.click();
    await nameInput.press('Control+A');
    await nameInput.press('Backspace');

    const saveBtn = page.getByTestId('workspace-name-save');
    await expect(saveBtn).toBeDisabled();

    // Reload proves nothing was submitted server-side.
    await page.reload();
    await expect(page.getByTestId('workspace-name-input')).toHaveValue(
      new RegExp(`Empty Guard ${s}`),
      { timeout: 15_000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Delete — type-to-confirm + healing
// ---------------------------------------------------------------------------

test.describe('Workspace settings — delete', () => {
  test('wrong confirmation text blocks delete; correct text deletes and lands on a healthy remaining workspace', async ({
    page,
    request,
  }) => {
    const s = suffix();
    const user = await registerNewUser(request, 'wsdelete');
    const survivorId = await createWorkspace(
      request,
      user.token,
      `Delete Survivor ${s}`,
    );
    const doomedName = `Delete Doomed ${s}`;
    const doomedId = await createWorkspace(request, user.token, doomedName);
    await login(page, { email: user.email, password: user.password });

    await gotoSettings(page, doomedId);
    await page.getByTestId('delete-workspace-button').click();

    const dialog = page.getByTestId('delete-workspace-dialog');
    await expect(dialog).toBeVisible();
    const confirmInput = dialog.getByTestId('delete-workspace-confirm-input');
    const confirmBtn = dialog.getByTestId('delete-workspace-confirm-button');

    // Wrong text keeps the button disabled/blocked — a real HTML `disabled`
    // button, so it cannot fire its click handler at all.
    await confirmInput.pressSequentially('definitely not the name', {
      delay: 20,
    });
    await expect(confirmBtn).toBeDisabled();
    await expect(dialog).toBeVisible();

    // Correct text unlocks and deletes.
    await confirmInput.click();
    await confirmInput.press('Control+A');
    await confirmInput.press('Backspace');
    await confirmInput.pressSequentially(doomedName, { delay: 20 });
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // Lands on a healthy dashboard.
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/, {
      timeout: 15_000,
    });
    await expect(dialog).toHaveCount(0);

    // Every surface heals to the surviving workspace — no blank chip, no
    // crash, no dangling reference to the deleted workspace.
    await expect(chip(page)).toContainText('Delete Survivor', {
      timeout: 15_000,
    });
    await expect(wsSelect(page).locator('option:checked')).toHaveText(
      /Delete Survivor/,
      { timeout: 15_000 },
    );
    await expect(page.getByText(doomedName)).toHaveCount(0);

    // A reload doesn't resurrect the deleted workspace or break the chip.
    await page.reload();
    await expect(chip(page)).toContainText('Delete Survivor', {
      timeout: 15_000,
    });

    // The deleted workspace's settings page is no longer reachable.
    await page.goto(`/workspaces/${doomedId}/settings`);
    await expect(
      page.getByRole('heading', { name: 'General settings' }),
    ).toHaveCount(0, { timeout: 10_000 });

    expect(survivorId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Non-admin — read-only view
// ---------------------------------------------------------------------------

test.describe('Workspace settings — non-admin', () => {
  test('a MEMBER sees a read-only view with no delete affordance', async ({
    page,
    request,
  }) => {
    const s = suffix();
    const owner = await registerNewUser(request, 'wsmember-owner');
    const workspaceName = `Member Scope ${s}`;
    const wsId = await createWorkspace(request, owner.token, workspaceName);

    const member = await registerNewUser(request, 'wsmember-member');
    await addWorkspaceMember(request, owner.token, wsId, member.email, 'MEMBER');

    await login(page, { email: member.email, password: member.password });
    await gotoSettings(page, wsId);

    // Read-only note is shown; workspace name is visible but not editable.
    // (The name legitimately also appears in the chip and the settings-nav
    // breadcrumb, so scope to the read-only section itself.)
    await expect(page.getByText(/only workspace administrators/i)).toBeVisible();
    const readOnlySection = page
      .locator('section')
      .filter({ hasText: /only workspace administrators/i });
    await expect(readOnlySection).toContainText(workspaceName);

    // No admin affordances at all.
    await expect(page.getByTestId('workspace-name-input')).toHaveCount(0);
    await expect(page.getByTestId('workspace-name-save')).toHaveCount(0);
    await expect(page.getByTestId('delete-workspace-button')).toHaveCount(0);
    await expect(page.getByTestId('workspace-danger-zone')).toHaveCount(0);
  });
});

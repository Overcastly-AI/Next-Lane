/**
 * Workspace Members — row geometry regression.
 *
 * Bug (2026-10-09): `cn` was plain clsx, so Select's hard-coded `w-full` beat
 * the caller's `w-28`; for non-self members the role select stretched ~680px,
 * the name/email vanished and Remove rendered outside the card (unreachable
 * on a 393px viewport). Runs on desktop AND mobile projects.
 */
import { test, expect } from '@playwright/test';
import { addWorkspaceMember, registerNewUser, setupIsolatedProject } from './helpers';

test.describe('Workspace members — row geometry', () => {
  test('non-self row keeps identity, role select and Remove inside the card', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'members-geometry',
      openBoard: false,
    });
    const other = await registerNewUser(request, 'members-geometry-other');
    await addWorkspaceMember(request, ctx.token, ctx.workspaceId, other.email, 'MEMBER');

    await page.goto(`/workspaces/${ctx.workspaceId}/members`);
    await expect(page.getByTestId('workspace-members-page')).toBeVisible({ timeout: 10_000 });

    const row = page.getByTestId('member-row').filter({ hasText: other.email });
    await expect(row).toBeVisible({ timeout: 10_000 });
    // Name + email are rendered (not collapsed to zero width).
    await expect(row.getByText(other.email)).toBeVisible();
    await expect(row.getByText(other.name, { exact: false }).first()).toBeVisible();

    const card = page.locator('section').filter({ has: row });
    const cardBox = (await card.boundingBox())!;
    const viewport = page.viewportSize()!;

    const select = row.getByTestId('member-role-select');
    const remove = row.getByTestId('remove-member-button');
    for (const [label, el] of [
      ['role select', select],
      ['remove button', remove],
    ] as const) {
      const b = (await el.boundingBox())!;
      expect(b.x, `${label} left edge`).toBeGreaterThanOrEqual(cardBox.x);
      expect(b.x + b.width, `${label} inside card`).toBeLessThanOrEqual(
        cardBox.x + cardBox.width + 0.5,
      );
      expect(b.x + b.width, `${label} inside viewport`).toBeLessThanOrEqual(viewport.width);
    }
    // The role select is a compact control, not a stretched fill.
    expect((await select.boundingBox())!.width).toBeLessThan(200);

    // Remove is reachable: clicking it opens the confirm dialog.
    await remove.click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByRole('alertdialog')).toContainText(other.email);
    // No horizontal page overflow.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

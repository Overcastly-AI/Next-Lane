import { test, expect } from '@playwright/test';
import {
  setupIsolatedProject,
  createWorkspace,
  createProject,
  registerNewUser,
  addWorkspaceMember,
  login,
} from './helpers';

/**
 * Inline issue creation in the backlog ("ghost row"):
 *  - typing a title + Enter in the Backlog section creates a backlog issue,
 *  - the input clears so the next title can be typed straight away,
 *  - the same works for a sprint section (issue lands in that sprint),
 *  - VIEWERs (read-only) never see the ghost row.
 *
 * Uses an isolated project per spec so writes never touch the seeded demo.
 */

async function gotoBacklog(page: import('@playwright/test').Page, projectId: string) {
  await page.goto(`/projects/${projectId}/backlog`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Backlog' }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="section-backlog"]')).toBeVisible();
}

test.describe('Inline issue creation in the backlog', () => {
  test('creates backlog issues from the ghost row and clears for the next', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'inline',
      openBoard: false,
    });
    await gotoBacklog(page, ctx.project.id);

    const ghost = page.getByTestId('ghost-row-backlog');
    await expect(ghost).toBeVisible();

    const titleA = `Inline A ${Date.now()}`;
    await ghost.click();
    await ghost.pressSequentially(titleA);
    await ghost.press('Enter');

    // The new issue appears in the backlog section...
    const backlog = page.locator('[data-testid="section-backlog"]');
    await expect(backlog.getByText(titleA)).toBeVisible({ timeout: 10_000 });
    // ...and the input has cleared, ready for the next title.
    await expect(ghost).toHaveValue('', { timeout: 10_000 });

    // A second one, back to back, without any modal.
    const titleB = `Inline B ${Date.now()}`;
    await ghost.pressSequentially(titleB);
    await ghost.press('Enter');
    await expect(backlog.getByText(titleB)).toBeVisible({ timeout: 10_000 });
    await expect(ghost).toHaveValue('', { timeout: 10_000 });

    // Both issues are now present in the backlog.
    await expect(backlog.getByText(titleA)).toBeVisible();
  });

  test('creates an issue inside a sprint section via its ghost row', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'inline-sprint',
      openBoard: false,
    });
    await gotoBacklog(page, ctx.project.id);

    const sprintName = `Inline Sprint ${Date.now()}`;
    await page.getByRole('button', { name: '+ Create sprint' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Name').fill(sprintName);
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    const section = page
      .locator('[data-testid="section-sprint"]')
      .filter({ hasText: sprintName });
    await expect(section).toBeVisible();

    const sprintGhost = section.getByPlaceholder(
      new RegExp(`Add an issue to ${sprintName}`, 'i'),
    );
    await expect(sprintGhost).toBeVisible();

    const title = `Sprint inline ${Date.now()}`;
    await sprintGhost.click();
    await sprintGhost.pressSequentially(title);
    await sprintGhost.press('Enter');

    // The issue shows up inside this sprint section, not the backlog.
    await expect(section.getByText(title)).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-testid="section-backlog"]').getByText(title),
    ).toHaveCount(0);
    await expect(sprintGhost).toHaveValue('', { timeout: 10_000 });
  });

  test('hides the ghost row for read-only viewers', async ({ page, request }) => {
    // Owner creates a workspace + project, then invites a VIEWER who logs in.
    const owner = await registerNewUser(request, 'inline-owner');
    const workspaceId = await createWorkspace(request, owner.token);
    const project = await createProject(request, owner.token, workspaceId, {
      name: 'Inline Viewer Project',
    });

    const viewer = await registerNewUser(request, 'inline-viewer');
    await addWorkspaceMember(
      request,
      owner.token,
      workspaceId,
      viewer.email,
      'VIEWER',
    );

    await login(page, { email: viewer.email, password: viewer.password });
    await gotoBacklog(page, project.id);

    // Read-only hint is shown and no ghost row exists anywhere.
    await expect(page.getByTestId('readonly-hint')).toBeVisible();
    await expect(page.getByTestId('ghost-row-backlog')).toHaveCount(0);
  });
});

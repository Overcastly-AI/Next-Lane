import { test, expect } from '@playwright/test';
import {
  login,
  setupIsolatedProject,
  registerNewUser,
  addWorkspaceMember,
  createIssue,
  trackApiWrites,
} from './helpers';

/**
 * The drawer header's Status quick-picker (`#d-status-header`,
 * data-testid="issue-status-quickpick") was added alongside the sidebar's
 * existing Status field (`#d-status`) so Status is reachable without
 * scrolling on mobile. Two controls writing the same `issue.statusId` is
 * exactly the shape of cross-surface state the workspace-switcher bug
 * cluster taught us to distrust by default — assert the header pill and the
 * sidebar field never disagree, in either direction, and that the change
 * survives a reload.
 */
test.describe('Issue drawer status quick-picker', () => {
  test('header quick-pick and sidebar Status field stay in sync both ways, and persist on reload', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'qp' });
    await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Quickpick sync issue',
    });

    await page.goto(`/projects/${ctx.project.id}/board`);
    await page.getByText('Quickpick sync issue').first().click();
    const drawer = page.getByRole('dialog').last();
    await expect(drawer).toBeVisible({ timeout: 10_000 });

    const header = drawer.getByTestId('issue-status-quickpick');
    const sidebar = drawer.locator('#d-status');
    await expect(header).toBeVisible();
    await expect(sidebar).toBeVisible();

    // Both start on the same (default) status.
    await expect(header).toHaveValue(await sidebar.inputValue());

    const writes = trackApiWrites(page);

    // Change via the HEADER quick-pick -> sidebar must follow.
    await header.selectOption({ label: 'In Progress' });
    await writes.settle({ match: (w) => w.method === 'PATCH', atLeast: 1 });
    await expect(sidebar).toHaveValue(await header.inputValue());
    await expect(sidebar.locator('option:checked')).toHaveText('In Progress');

    // Change via the SIDEBAR field -> header must follow.
    await sidebar.selectOption({ label: 'Done' });
    await writes.settle({ match: (w) => w.method === 'PATCH', atLeast: 2 });
    await expect(header).toHaveValue(await sidebar.inputValue());
    await expect(header.locator('option:checked')).toHaveText('Done');

    // Reload: both controls must still show "Done", not silently reset.
    await page.reload();
    const drawerAfterReload = page.getByRole('dialog').last();
    await expect(drawerAfterReload).toBeVisible({ timeout: 10_000 });
    const headerAfter = drawerAfterReload.getByTestId('issue-status-quickpick');
    const sidebarAfter = drawerAfterReload.locator('#d-status');
    await expect(headerAfter.locator('option:checked')).toHaveText('Done');
    await expect(sidebarAfter.locator('option:checked')).toHaveText('Done');
  });

  test('header quick-pick is disabled for a non-editable (VIEWER) role', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'qp-viewer',
      openBoard: false,
    });
    const issue = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Viewer quickpick issue',
    });

    const viewer = await registerNewUser(request, 'qp-viewer-user');
    await addWorkspaceMember(
      request,
      ctx.token,
      ctx.workspaceId,
      viewer.email,
      'VIEWER',
    );
    await login(page, { email: viewer.email, password: viewer.password });

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByText(issue.key).first().click();
    const drawer = page.getByRole('dialog').last();
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    await expect(drawer.getByTestId('issue-status-quickpick')).toBeDisabled();
  });
});

/**
 * e2e tests for the Workspace Audit Log.
 *
 * Runs on both chromium-desktop (1280x800) and mobile-chrome (Pixel 5) via
 * the playwright.config.ts project matrix.
 *
 * Covered flows:
 *   - ADMIN: perform an audited action (create API token), open audit log, confirm event appears
 *   - ADMIN: add + remove a member, confirm membership events appear in audit log
 *   - Non-admin (VIEWER): audit log nav button is not visible (hidden for non-ADMINs)
 *   - Non-admin (VIEWER): direct navigation to /workspaces/:id/audit-log shows access-denied
 *   - ADMIN: member management page — Remove button present; non-admin (VIEWER) has no Remove button
 *
 * All tests use the isolated-user fixture (setupIsolatedProject / fresh users) so
 * they never touch the shared demo account or collide with parallel specs.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  setupIsolatedProject,
  registerNewUser,
  addWorkspaceMember,
  login,
  API_URL,
} from './helpers';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Navigate to the dashboard and get the workspace ID from the audit-log nav
 * button's URL (the button is only visible to ADMIN users).
 *
 * Returns the workspaceId extracted from the button href, or null if the button
 * is not visible (non-admin user).
 */
async function getWorkspaceIdFromDashboard(
  page: Parameters<typeof login>[0],
): Promise<string | null> {
  await page.goto('/');
  const navBtn = page.getByTestId('audit-log-nav-link');
  const isVisible = await navBtn.isVisible().catch(() => false);
  if (!isVisible) return null;

  // Navigate there and extract the workspaceId from the URL.
  await navBtn.click();
  await page.waitForURL(/\/workspaces\/[^/]+\/audit-log/);
  const url = page.url();
  const match = /\/workspaces\/([^/]+)\/audit-log/.exec(url);
  return match?.[1] ?? null;
}

/** Create an API token via the API and return its name for audit log matching. */
async function createApiTokenViaApi(
  request: APIRequestContext,
  token: string,
  name = 'audit-test-token',
): Promise<void> {
  const res = await request.post(`${API_URL}/api/me/tokens`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  expect(res.ok(), `create token failed: ${res.status()}`).toBeTruthy();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Workspace audit log', () => {
  test('ADMIN can open audit log from dashboard nav button', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'auditlog-nav',
      openBoard: false,
    });

    await page.goto('/');

    // The Audit log button is visible for ADMIN.
    const auditBtn = page.getByTestId('audit-log-nav-link');
    await expect(auditBtn).toBeVisible();

    await auditBtn.click();
    await expect(page).toHaveURL(
      new RegExp(`/workspaces/${ctx.workspaceId}/audit-log`),
    );

    // The audit log page renders with the table or empty state.
    await expect(page.getByTestId('audit-log-page')).toBeVisible();
  });

  test('ADMIN: creating an API token produces an audit event', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'auditlog-token',
      openBoard: false,
    });

    // Perform the audited action: create an API token via the API.
    const tokenName = `audit-token-${Date.now()}`;
    await createApiTokenViaApi(request, ctx.token, tokenName);

    // Navigate to the audit log.
    await page.goto(`/workspaces/${ctx.workspaceId}/audit-log`);
    await expect(page.getByTestId('audit-log-page')).toBeVisible({ timeout: 10_000 });

    // Wait for the table (it may take a moment for the query to load).
    await expect(page.getByTestId('audit-log-table')).toBeVisible({ timeout: 10_000 });

    // Confirm the token creation event is listed.
    const rows = page.getByTestId('audit-log-table').locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });

    // The page should contain "API token created" and the token name.
    await expect(page.getByTestId('audit-log-table')).toContainText('API token created');
    await expect(page.getByTestId('audit-log-table')).toContainText(tokenName);
  });

  test('ADMIN: adding a member produces a membership.add audit event', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'auditlog-add-member',
      openBoard: false,
    });

    // Add a new member to the workspace via the API.
    const newUser = await registerNewUser(request, 'auditlog-invited');
    await addWorkspaceMember(
      request,
      ctx.token,
      ctx.workspaceId,
      newUser.email,
      'VIEWER',
    );

    // Navigate to the audit log.
    await page.goto(`/workspaces/${ctx.workspaceId}/audit-log`);
    await expect(page.getByTestId('audit-log-page')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('audit-log-table')).toBeVisible({ timeout: 10_000 });

    // The member-add event should be in the table.
    await expect(page.getByTestId('audit-log-table')).toContainText('Member added');
    await expect(page.getByTestId('audit-log-table')).toContainText(newUser.email);
  });

  test('ADMIN: remove member via UI — membership.remove event appears in audit log', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'auditlog-rm-member',
      openBoard: false,
    });

    // Add a member first.
    const newUser = await registerNewUser(request, 'auditlog-removable');
    await addWorkspaceMember(
      request,
      ctx.token,
      ctx.workspaceId,
      newUser.email,
      'VIEWER',
    );

    // Navigate to the workspace members page and remove the member via UI.
    await page.goto(`/workspaces/${ctx.workspaceId}/members`);
    await expect(page.getByTestId('workspace-members-page')).toBeVisible({ timeout: 10_000 });

    // Find the removable member row and click Remove.
    const memberRows = page.getByTestId('member-row');
    // Locate the row containing the new user's email.
    const targetRow = memberRows.filter({ hasText: newUser.email });
    await expect(targetRow).toBeVisible({ timeout: 10_000 });

    const removeBtn = targetRow.getByTestId('remove-member-button');
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();

    // Confirm the dialog.
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Remove member');
    await expect(dialog).toContainText(newUser.email);

    await dialog.getByRole('button', { name: 'Remove member' }).click();

    // The member row should disappear.
    await expect(targetRow).not.toBeVisible({ timeout: 10_000 });

    // Navigate to the audit log; the remove event should appear.
    await page.goto(`/workspaces/${ctx.workspaceId}/audit-log`);
    await expect(page.getByTestId('audit-log-table')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('audit-log-table')).toContainText('Member removed');
    await expect(page.getByTestId('audit-log-table')).toContainText(newUser.email);
  });

  test('non-admin VIEWER: audit log nav button is hidden on dashboard', async ({
    page,
    request,
  }) => {
    // Register an admin user to create the workspace.
    const adminCtx = await setupIsolatedProject(page, request, {
      label: 'auditlog-admin-for-viewer',
      openBoard: false,
    });

    // Add a VIEWER.
    const viewerUser = await registerNewUser(request, 'auditlog-viewer');
    await addWorkspaceMember(
      request,
      adminCtx.token,
      adminCtx.workspaceId,
      viewerUser.email,
      'VIEWER',
    );

    // Log in as the VIEWER.
    await login(page, { email: viewerUser.email, password: viewerUser.password });

    await page.goto('/');
    // The Audit log button must NOT be visible for a non-admin.
    const auditBtn = page.getByTestId('audit-log-nav-link');
    await expect(auditBtn).not.toBeVisible();
    // The Members button must NOT be visible for a non-admin.
    const membersBtn = page.getByTestId('members-nav-link');
    await expect(membersBtn).not.toBeVisible();
  });

  test('non-admin VIEWER: direct navigation to audit log shows access denied', async ({
    page,
    request,
  }) => {
    // Register an admin to create workspace.
    const adminCtx = await setupIsolatedProject(page, request, {
      label: 'auditlog-viewer-direct',
      openBoard: false,
    });

    // Add a VIEWER.
    const viewerUser = await registerNewUser(request, 'auditlog-viewer-direct');
    await addWorkspaceMember(
      request,
      adminCtx.token,
      adminCtx.workspaceId,
      viewerUser.email,
      'VIEWER',
    );

    // Log in as the VIEWER.
    await login(page, { email: viewerUser.email, password: viewerUser.password });

    // Directly navigate to the audit log URL.
    await page.goto(`/workspaces/${adminCtx.workspaceId}/audit-log`);

    // The access-denied message should be shown (no table).
    await expect(
      page.getByText(/admin access required/i),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('audit-log-table')).not.toBeVisible();
  });

  test('non-admin MEMBER: audit log nav button is hidden on dashboard', async ({
    page,
    request,
  }) => {
    // Register an admin user to create the workspace.
    const adminCtx = await setupIsolatedProject(page, request, {
      label: 'auditlog-admin-for-member',
      openBoard: false,
    });

    // Add a MEMBER.
    const memberUser = await registerNewUser(request, 'auditlog-member');
    await addWorkspaceMember(
      request,
      adminCtx.token,
      adminCtx.workspaceId,
      memberUser.email,
      'MEMBER',
    );

    // Log in as the MEMBER.
    await login(page, { email: memberUser.email, password: memberUser.password });

    await page.goto('/');
    // The Audit log button must NOT be visible for a non-admin MEMBER.
    const auditBtn = page.getByTestId('audit-log-nav-link');
    await expect(auditBtn).not.toBeVisible();
  });
});

// ── Member management UI tests ────────────────────────────────────────────────

test.describe('Workspace member management UI', () => {
  test('ADMIN sees Remove button on other members, not on self', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'members-admin',
      openBoard: false,
    });

    // Add a second member to the workspace.
    const otherUser = await registerNewUser(request, 'members-other');
    await addWorkspaceMember(
      request,
      ctx.token,
      ctx.workspaceId,
      otherUser.email,
      'MEMBER',
    );

    // Navigate to the members page.
    await page.goto(`/workspaces/${ctx.workspaceId}/members`);
    await expect(page.getByTestId('workspace-members-page')).toBeVisible({ timeout: 10_000 });

    // Should have 2 rows.
    const memberRows = page.getByTestId('member-row');
    await expect(memberRows).toHaveCount(2);

    // Row for the other user should have a Remove button.
    const otherRow = memberRows.filter({ hasText: otherUser.email });
    await expect(otherRow.getByTestId('remove-member-button')).toBeVisible();

    // Row for self (the ADMIN) should NOT have a Remove button.
    const selfRow = memberRows.filter({ hasText: ctx.user.email });
    await expect(selfRow.getByTestId('remove-member-button')).not.toBeVisible();
  });

  test('VIEWER: no Remove buttons are shown on members page', async ({
    page,
    request,
  }) => {
    // Admin creates workspace with a viewer.
    const adminCtx = await setupIsolatedProject(page, request, {
      label: 'members-viewer-noremove',
      openBoard: false,
    });
    const viewerUser = await registerNewUser(request, 'members-viewer-nr');
    await addWorkspaceMember(
      request,
      adminCtx.token,
      adminCtx.workspaceId,
      viewerUser.email,
      'VIEWER',
    );

    // Log in as the VIEWER.
    await login(page, { email: viewerUser.email, password: viewerUser.password });

    // Navigate directly to the members page.
    await page.goto(`/workspaces/${adminCtx.workspaceId}/members`);
    await expect(page.getByTestId('workspace-members-page')).toBeVisible({ timeout: 10_000 });

    // No Remove buttons should appear.
    await expect(page.getByTestId('remove-member-button')).not.toBeVisible();
  });

  test('ADMIN: remove member via UI removes them from the list', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'members-rm-ui',
      openBoard: false,
    });

    // Add a member.
    const memberUser = await registerNewUser(request, 'members-rm-target');
    await addWorkspaceMember(
      request,
      ctx.token,
      ctx.workspaceId,
      memberUser.email,
      'MEMBER',
    );

    await page.goto(`/workspaces/${ctx.workspaceId}/members`);
    await expect(page.getByTestId('workspace-members-page')).toBeVisible({ timeout: 10_000 });

    // Initially 2 members.
    await expect(page.getByTestId('member-row')).toHaveCount(2);

    // Click Remove on the target member.
    const targetRow = page
      .getByTestId('member-row')
      .filter({ hasText: memberUser.email });
    await targetRow.getByTestId('remove-member-button').click();

    // Confirm dialog.
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Remove member');

    await dialog.getByRole('button', { name: 'Remove member' }).click();

    // The member list should now have only 1 row.
    await expect(page.getByTestId('member-row')).toHaveCount(1, { timeout: 10_000 });
    // And the removed user's email should not appear.
    await expect(page.getByText(memberUser.email)).not.toBeVisible();
  });

  test('ADMIN sees Members nav button on dashboard', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, {
      label: 'members-nav',
      openBoard: false,
    });

    await page.goto('/');
    const membersBtn = page.getByTestId('members-nav-link');
    await expect(membersBtn).toBeVisible();
  });
});

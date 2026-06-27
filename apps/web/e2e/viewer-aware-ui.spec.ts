import { test, expect, type Page } from '@playwright/test';
import {
  login,
  setupIsolatedProject,
  registerNewUser,
  addWorkspaceMember,
  createIssue,
} from './helpers';

/**
 * ITEM A — VIEWER-aware UI.
 *
 * Roles are enforced server-side (VIEWER gets 403 on mutations) but the UI used
 * to render every edit/create affordance to VIEWERs, who then hit a confusing
 * 403 toast. These tests build a fresh workspace + project (via setupIsolatedProject)
 * owned by a freshly-registered ADMIN, add a freshly-registered VIEWER, then drive
 * the real UI as each role:
 *  - VIEWER: no "+ Create issue", a "View only" hint, and the issue drawer
 *    shows no Delete and disabled fields. (Column CRUD lives in Settings now.)
 *  - ADMIN: still sees the create affordance (positive control).
 *
 * Each test registers its own users so the demo account is never touched.
 */

async function gotoBoard(page: Page, projectId: string): Promise<void> {
  await page.goto(`/projects/${projectId}/board`);
  // A column header confirms the board rendered.
  await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });
}

test.describe('VIEWER-aware UI', () => {
  test('VIEWER sees no create/edit affordances on the board', async ({
    page,
    request,
  }) => {
    // Set up an isolated workspace as the admin owner.
    const ctx = await setupIsolatedProject(page, request, {
      label: 'vui-viewer',
      openBoard: false,
    });

    // Seed one issue (so the board has something to click) as the admin.
    const issue = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Seed issue for viewer test',
    });

    // Register a VIEWER and add to the workspace.
    const viewer = await registerNewUser(request, 'vui-viewer-user');
    await addWorkspaceMember(
      request,
      ctx.token,
      ctx.workspaceId,
      viewer.email,
      'VIEWER',
    );

    // Log in as the VIEWER.
    await login(page, { email: viewer.email, password: viewer.password });
    await gotoBoard(page, ctx.project.id);

    // Read-only hint present; create/add controls absent.
    await expect(page.getByTestId('readonly-hint').first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: /create issue/i }),
    ).toHaveCount(0);

    // Opening an issue: drawer is read-only (no Delete, status select disabled).
    await page.getByText(issue.key).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('readonly-hint')).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: /^delete$/i }),
    ).toHaveCount(0);
    await expect(dialog.locator('#d-status')).toBeDisabled();
  });

  test('ADMIN still sees the create-issue affordance (positive control)', async ({
    page,
    request,
  }) => {
    // The admin is logged in by setupIsolatedProject automatically.
    const ctx = await setupIsolatedProject(page, request, {
      label: 'vui-admin',
    });

    // Suppress unused-variable lint; we need the ctx call for the side-effect
    // of creating the isolated project and logging in as the admin.
    void ctx;

    await expect(page.getByTestId('readonly-hint')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /create issue/i }),
    ).toBeVisible();
  });

  test('VIEWER sees no create-sprint on the backlog; ADMIN does', async ({
    page,
    request,
  }) => {
    // Set up an isolated workspace.
    const ctx = await setupIsolatedProject(page, request, {
      label: 'vui-sprint',
      openBoard: false,
    });

    // Register a VIEWER.
    const viewer = await registerNewUser(request, 'vui-sprint-viewer');
    await addWorkspaceMember(
      request,
      ctx.token,
      ctx.workspaceId,
      viewer.email,
      'VIEWER',
    );

    // Log in as VIEWER, navigate to backlog.
    await login(page, { email: viewer.email, password: viewer.password });
    await page.goto(`/projects/${ctx.project.id}/backlog`);
    await expect(
      page.getByRole('heading', { level: 1, name: /backlog/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('readonly-hint')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /create sprint/i }),
    ).toHaveCount(0);

    // Positive control as ADMIN (the workspace owner).
    await login(page, { email: ctx.user.email, password: ctx.user.password });
    await page.goto(`/projects/${ctx.project.id}/backlog`);
    await expect(
      page.getByRole('button', { name: /create sprint/i }),
    ).toBeVisible({ timeout: 15_000 });
  });
});

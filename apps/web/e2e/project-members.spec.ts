/**
 * project-members.spec.ts
 *
 * Per-project role override — frontend UI (Phase 2 of 2, docs/BACKLOG.md).
 * Backend surface (Phase 1, commit 13b2e55): GET/PUT/DELETE
 * /projects/:id/members[/:userId/role].
 *
 * Exercises the new Settings → Members section (MembersSection.tsx):
 *  - an ADMIN sees the project's EFFECTIVE members with their workspace role
 *    and effective role, all "Inherited" by default;
 *  - setting a role override flips the row's badge to "Override" and the
 *    server-side effect is REAL, not just cosmetic — a MEMBER demoted to
 *    VIEWER on this one project genuinely loses write access here (verified
 *    via an actual create-issue attempt through the real UI, not an API
 *    ping) while a positive-control baseline (before the override) proves
 *    the same action worked moments earlier;
 *  - "Revert to inherited" (behind a ConfirmDialog) restores write access;
 *  - a workspace ADMIN's row is immune — role control disabled with a
 *    tooltip, mirroring the server's 400.
 *
 * Runs on both configured Playwright projects (chromium-desktop 1280,
 * mobile-chrome ~393px) via the shared playwright.config.ts.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  registerNewUser,
  addWorkspaceMember,
  setupIsolatedProject,
  openProjectBoard,
  type RegisteredUser,
} from './helpers';

async function gotoSettings(page: Page, projectId: string): Promise<void> {
  await page.goto(`/projects/${projectId}/settings`);
  await expect(
    page.getByRole('heading', { name: /^settings$/i }).first(),
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * A success toast identified by its COPY, not just by `data-variant`.
 *
 * This spec raises several success toasts per run, and they overlap: a toast
 * lives for a few seconds, so on a slow runner the "Set … role" one is still
 * on screen when the "Reverted …" one arrives. A bare
 * `[data-toast][data-variant="success"]` then matches two elements and fails
 * strict mode — which is how this spec went red on CI. Naming the copy fixes
 * that and strengthens the assertion: it now says *which* operation succeeded
 * rather than that something, somewhere, did.
 */
function successToast(page: Page, copy: RegExp) {
  return page
    .locator('[data-toast][data-variant="success"]')
    .filter({ hasText: copy });
}

/** Row locator for a given user's email inside the Members section. */
function memberRow(page: Page, email: string) {
  return page
    .getByTestId('members-section')
    .getByTestId('project-member-row')
    .filter({ hasText: email });
}

/**
 * Log a user into a fresh browser context (token injected, no UI login).
 *
 * Seeded with `addInitScript` so the token exists BEFORE the app's first
 * script runs. Doing it after `goto('/login')` let the app boot logged-out
 * and fire an unauthenticated request whose 401 then cleared the token that
 * had just been injected, bouncing the next navigation back to /login.
 *
 * Still clears any cached identity (`nl_user`, read as `initialData` by
 * AuthContext) so the helper is safe to reuse against an authenticated page.
 */
async function loginViaToken(
  ctx: BrowserContext,
  user: RegisteredUser,
): Promise<Page> {
  await ctx.addInitScript(
    ({ token, key }) => {
      localStorage.clear();
      localStorage.setItem(key, token);
    },
    { token: user.token, key: 'nl_token' },
  );
  const page = await ctx.newPage();
  await page.goto('/login');
  return page;
}

/** Attempt to create an issue through the real board UI (per-keystroke title). */
async function attemptCreateIssue(
  page: Page,
  projectId: string,
  title: string,
): Promise<void> {
  await openProjectBoard(page, projectId);
  await page.getByRole('button', { name: /\+ create issue/i }).click();
  const titleInput = page.locator('#issue-title');
  await expect(titleInput).toBeVisible();
  await titleInput.pressSequentially(title, { delay: 10 });
  await page.getByRole('button', { name: /^create$/i }).click();
}

test.describe('Project members — role override', () => {
  test('admin sees the effective members list with inherited roles', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'pm-list',
      openBoard: false,
    });

    const member = await registerNewUser(request, 'pm-list-member');
    await addWorkspaceMember(
      request,
      ctx.token,
      ctx.workspaceId,
      member.email,
      'MEMBER',
    );

    await gotoSettings(page, ctx.project.id);
    const section = page.getByTestId('members-section');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Owner (workspace ADMIN) row: fixed ADMIN, no override affordance —
    // always shows "Inherited" (never overridable) rather than "Override".
    const ownerRow = memberRow(page, ctx.user.email);
    await expect(ownerRow).toBeVisible();
    await expect(ownerRow.getByTestId('project-member-inherited-badge')).toBeVisible();
    await expect(ownerRow.getByTestId('project-member-override-badge')).toHaveCount(0);
    await expect(ownerRow.getByRole('combobox')).toBeDisabled();

    // Co-member row: workspace MEMBER, effective role inherited (MEMBER).
    const memberRowLocator = memberRow(page, member.email);
    await expect(memberRowLocator).toBeVisible();
    await expect(
      memberRowLocator.getByTestId('project-member-inherited-badge'),
    ).toBeVisible();
    await expect(memberRowLocator.getByRole('combobox')).toHaveValue('MEMBER');
  });

  test('setting an override flips the badge, demotes real access, and reverting restores it', async ({
    page,
    request,
    browser,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'pm-override',
      openBoard: false,
    });

    const member = await registerNewUser(request, 'pm-override-member');
    await addWorkspaceMember(
      request,
      ctx.token,
      ctx.workspaceId,
      member.email,
      'MEMBER',
    );

    // Second, independent browser session for the target member so we can
    // exercise the real board UI as them (not just an API ping) both before
    // and after the override.
    const memberContext = await browser.newContext();
    const memberPage = await loginViaToken(memberContext, member);

    // --- Baseline (positive control): the MEMBER can create an issue. ---
    const baselineTitle = `PM baseline ${Date.now()}`;
    await attemptCreateIssue(memberPage, ctx.project.id, baselineTitle);
    await expect(successToast(memberPage, /^Created /i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(memberPage.getByRole('dialog')).toHaveCount(0);

    // --- Admin sets a VIEWER override for the member on this project. ---
    await gotoSettings(page, ctx.project.id);
    const row = memberRow(page, member.email);
    await expect(row).toBeVisible({ timeout: 15_000 });
    const roleSelect = row.getByRole('combobox');
    await expect(roleSelect).toHaveValue('MEMBER');
    await roleSelect.selectOption('VIEWER');

    // Assert the toast's TEXT, not just `[data-variant="success"]`. Two success
    // toasts are raised in this spec (set override, then revert) and the first
    // is still on screen when the second arrives on a slow runner — the generic
    // locator then matches both and fails strict mode, which is exactly how
    // this spec went red on CI. Matching the copy also makes the assertion
    // mean "the override was set" rather than "something succeeded".
    await expect(
      successToast(page, /role for this project to VIEWER/i),
    ).toBeVisible({ timeout: 10_000 });
    await expect(row.getByTestId('project-member-override-badge')).toBeVisible();
    await expect(row.getByTestId('project-member-inherited-badge')).toHaveCount(0);
    await expect(roleSelect).toHaveValue('VIEWER');

    // --- Concrete effect: the demoted member's write attempt now fails. ---
    const restrictedTitle = `PM restricted ${Date.now()}`;
    await attemptCreateIssue(memberPage, ctx.project.id, restrictedTitle);
    const errorToast = memberPage.locator('[data-toast][data-variant="error"]');
    await expect(errorToast).toBeVisible({ timeout: 10_000 });
    await expect(errorToast).toContainText(/requires member role in this project/i);
    // The modal stays open (create failed) rather than closing on success.
    await expect(memberPage.locator('#issue-title')).toBeVisible();
    await memberPage.keyboard.press('Escape');
    // The restricted-title issue was never created.
    await memberPage.reload();
    await expect(memberPage.getByText(baselineTitle).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(memberPage.getByText(restrictedTitle)).toHaveCount(0);

    // --- Revert to inherited restores access. ---
    await row.getByTestId('project-member-revert').click();
    const confirmDialog = page.getByRole('alertdialog', { name: /revert to inherited role/i });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: /^revert to inherited$/i }).click();

    await expect(
      successToast(page, /to their workspace role/i),
    ).toBeVisible({ timeout: 10_000 });
    await expect(row.getByTestId('project-member-inherited-badge')).toBeVisible();
    await expect(row.getByTestId('project-member-override-badge')).toHaveCount(0);
    await expect(roleSelect).toHaveValue('MEMBER');

    // Access is restored — the member can create issues again.
    const restoredTitle = `PM restored ${Date.now()}`;
    await attemptCreateIssue(memberPage, ctx.project.id, restoredTitle);
    await expect(successToast(memberPage, /^Created /i)).toBeVisible({
      timeout: 10_000,
    });

    await memberContext.close();
  });

  test('a workspace ADMIN row cannot be overridden', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'pm-wsadmin',
      openBoard: false,
    });

    const coAdmin = await registerNewUser(request, 'pm-wsadmin-co');
    await addWorkspaceMember(
      request,
      ctx.token,
      ctx.workspaceId,
      coAdmin.email,
      'ADMIN',
    );

    await gotoSettings(page, ctx.project.id);
    const row = memberRow(page, coAdmin.email);
    await expect(row).toBeVisible({ timeout: 15_000 });

    const select = row.getByRole('combobox');
    await expect(select).toBeDisabled();
    await expect(select).toHaveValue('ADMIN');
    await expect(row.getByTestId('project-member-revert')).toHaveCount(0);
    await expect(row.getByTestId('project-member-override-badge')).toHaveCount(0);

    // Tooltip hint mirrors the server's 400.
    const hintWrapper = row.locator('[title*="always have full access"]');
    await expect(hintWrapper).toHaveCount(1);
  });

  test('a non-admin project member sees a read-only members list', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'pm-readonly',
      openBoard: false,
    });

    const viewer = await registerNewUser(request, 'pm-readonly-viewer');
    await addWorkspaceMember(
      request,
      ctx.token,
      ctx.workspaceId,
      viewer.email,
      'VIEWER',
    );

    await page.goto('/login');
    // Clear the ADMIN's cached identity (`nl_user`, read as `initialData` by
    // AuthContext) as well as the token — otherwise the app briefly (or, in
    // a fast local test run, durably enough to matter) renders with the
    // PREVIOUS user's identity while already using the new token for API
    // calls, which would make the section think it's still the admin.
    await page.evaluate(
      ({ token, key }) => {
        localStorage.clear();
        localStorage.setItem(key, token);
      },
      { token: viewer.token, key: 'nl_token' },
    );
    await gotoSettings(page, ctx.project.id);

    const section = page.getByTestId('members-section');
    await expect(section).toBeVisible({ timeout: 15_000 });
    await expect(section.getByTestId('project-member-row')).not.toHaveCount(0);
    // No role controls anywhere in the section for a non-project-admin viewer.
    await expect(section.getByRole('combobox')).toHaveCount(0);
    await expect(section.getByTestId('project-member-revert')).toHaveCount(0);
  });
});

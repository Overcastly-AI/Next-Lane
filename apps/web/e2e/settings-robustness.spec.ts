/**
 * settings-robustness.spec.ts
 *
 * Founder-directed QA sweep (2026-07-02, "Settings pages should be more
 * robust"): exercises validation, error-toast friendliness, and persistence
 * across EVERY project- and workspace-settings surface with per-keystroke
 * typing (never `.fill()`), deliberately invalid input, and reload checks —
 * the exact shape of quality bar set by the personal-board spaces-in-edit-
 * modal defect.
 *
 * This file has two halves:
 *   1. Green regression tests that LOCK IN currently-correct behavior found
 *      during the sweep (WIP-limit validation, webhook/GitHub format guards,
 *      custom-field option requirements, project-details persistence).
 *   2. Regression tests for SETTINGS-1..4, the confirmed defects filed in
 *      `docs/UI-REVIEW.md` under "Settings robustness sweep — 2026-07-02".
 *      These were originally `test.fixme()` placeholders encoding the
 *      CORRECT behavior; now that the fixes have shipped they are un-fixme'd
 *      and run as regular regression gates.
 *
 * See docs/UI-REVIEW.md for the full findings write-up, priorities, and
 * screenshots referenced by defect id (SETTINGS-1..4).
 */
import { test, expect, type Page } from '@playwright/test';
import {
  addWorkspaceMember,
  createWorkspace,
  login,
  registerNewUser,
  setupIsolatedProject,
} from './helpers';

async function gotoSettings(page: Page, projectId: string): Promise<void> {
  await page.goto(`/projects/${projectId}/settings`);
  await expect(
    page.getByRole('heading', { name: /settings/i }).first(),
  ).toBeVisible({ timeout: 15_000 });
}

async function openAddColumnModal(page: Page): Promise<void> {
  await page.getByRole('button', { name: '+ Add column' }).click();
  await expect(page.locator('#column-name')).toBeVisible();
}

// ===========================================================================
// 1. Green regression tests — lock in current CORRECT behavior
// ===========================================================================

test.describe('Settings robustness — columns (WIP limit validation)', () => {
  test('WIP limit rejects 0, a negative number, and a decimal — column is never created', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'wip-valid',
      openBoard: false,
    });
    await gotoSettings(page, ctx.project.id);

    // --- zero: blocked by the native min=1 constraint before submit ---
    await openAddColumnModal(page);
    await page.locator('#column-name').pressSequentially('WIP Zero', {
      delay: 15,
    });
    const wipInput = page.getByTestId('column-wip-limit-input');
    await wipInput.pressSequentially('0', { delay: 15 });
    await page.getByRole('button', { name: 'Add column', exact: true }).click();
    // Native constraint validation fires before any request — modal stays
    // open, the column is never created.
    await expect(page.locator('#column-name')).toBeVisible();
    let validity0 = await wipInput.evaluate(
      (el: HTMLInputElement) => el.validity.valid,
    );
    expect(validity0).toBe(false);

    // --- negative (native number input still lets you type a leading "-") ---
    await wipInput.press('Control+a');
    await wipInput.pressSequentially('-5', { delay: 15 });
    await page.getByRole('button', { name: 'Add column', exact: true }).click();
    await expect(page.locator('#column-name')).toBeVisible();
    const validityNeg = await wipInput.evaluate(
      (el: HTMLInputElement) => el.validity.valid,
    );
    expect(validityNeg).toBe(false);

    // --- decimal: blocked by the native step=1 constraint before submit ---
    await wipInput.press('Control+a');
    await wipInput.pressSequentially('3.5', { delay: 15 });
    const validity = await wipInput.evaluate(
      (el: HTMLInputElement) => el.validity.valid,
    );
    expect(validity).toBe(false);

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('settings-column-row')).toHaveCount(3); // seeded To Do/In Progress/Done only
  });
});

test.describe('Settings robustness — webhooks & GitHub format guards', () => {
  test('webhook form blocks a malformed URL and a too-short secret before submit', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'webhook-valid',
      openBoard: false,
    });
    await gotoSettings(page, ctx.project.id);

    await page.getByRole('button', { name: /add webhook/i }).first().click();
    await expect(page.locator('#webhook-url')).toBeVisible();

    await page.locator('#webhook-url').pressSequentially('not a url at all', {
      delay: 15,
    });
    await page.locator('#webhook-secret').pressSequentially('short', {
      delay: 15,
    });
    await page
      .getByRole('button', { name: /add webhook/i })
      .last()
      .click();

    // Native constraint validation blocks the submit entirely — modal stays
    // open, no request is sent.
    await expect(page.locator('#webhook-url')).toBeVisible();
    const urlValidity = await page
      .locator('#webhook-url')
      .evaluate((el: HTMLInputElement) => el.validity.typeMismatch);
    expect(urlValidity).toBe(true);
    const secretValidity = await page
      .locator('#webhook-secret')
      .evaluate((el: HTMLInputElement) => el.validity.tooShort);
    expect(secretValidity).toBe(true);
  });

  test('GitHub integration rejects a malformed "owner/repo" value with a visible error, no integration created', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'github-valid',
      openBoard: false,
    });
    await gotoSettings(page, ctx.project.id);

    const repoInput = page.getByTestId('github-repo-input');
    await repoInput.scrollIntoViewIfNeeded();
    await repoInput.pressSequentially('not-a-valid-repo-format!!', {
      delay: 10,
    });
    await page
      .getByTestId('github-token-input')
      .pressSequentially('ghp_1234567890abcdefTESTTOKEN', { delay: 5 });
    await page.getByTestId('github-save').click();

    // Assert on the error TOAST specifically ([data-variant="error"], role
    // alert). A bare `getByText(/owner\/repo.*format/i)` was ambiguous and
    // self-defeating: the Gitea section's static hint on this same settings
    // page ('"owner/repo" format, e.g. "acme/widgets".') also matches, so the
    // expectation was satisfied by a permanent hint before the real error ever
    // rendered — and the moment the toast DID land first, strict mode failed
    // the test with two matches. It now checks the surface it means.
    const errorToast = page.locator('[data-toast][data-variant="error"]').first();
    await expect(errorToast).toContainText(/owner\/repo.*format/i, {
      timeout: 10_000,
    });
    // No "Connected to ..." summary should ever appear.
    await expect(
      page.getByText(/connected to not-a-valid-repo-format/i),
    ).toHaveCount(0);
  });
});

test.describe('Settings robustness — custom fields', () => {
  test('a SELECT field requires at least one option — submitting with none keeps the modal open', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'cf-valid',
      openBoard: false,
    });
    await gotoSettings(page, ctx.project.id);

    await page.getByRole('button', { name: /add field|add custom field/i }).first().click();
    await expect(page.locator('#cf-name')).toBeVisible();
    await page.locator('#cf-name').pressSequentially('Severity Level', {
      delay: 15,
    });
    await page.locator('#cf-type').selectOption('SELECT');
    // Leave the options textarea blank.
    await page.getByRole('button', { name: 'Create field' }).click();

    await expect(page.getByText(/requires at least one option/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('#cf-name')).toBeVisible(); // modal still open
    await expect(page.locator('#cf-name')).toHaveValue('Severity Level');
    // No field was actually created — closing and re-checking the list finds nothing.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Severity Level')).toHaveCount(0);
  });
});

test.describe('Settings robustness — project details persistence', () => {
  test('renaming the project persists across reload and updates the breadcrumb', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'details-persist',
      projectName: 'Persist Me',
      openBoard: false,
    });
    await gotoSettings(page, ctx.project.id);

    const newName = `Persisted Name ${Date.now()}`;
    const nameInput = page.locator('#settings-name');
    await nameInput.click();
    await nameInput.press('Control+a');
    await nameInput.press('Backspace');
    await nameInput.pressSequentially(newName, { delay: 15 });
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/project details saved/i)).toBeVisible({
      timeout: 10_000,
    });

    await page.reload();
    await expect(page.locator('#settings-name')).toHaveValue(newName, {
      timeout: 15_000,
    });
    // Cross-page coherence: the breadcrumb reflects the rename too.
    //
    // Target the breadcrumb explicitly. A bare `getByText(newName).first()`
    // is ambiguous here: the always-mounted `AppSidebar` (App.tsx) also lists
    // the project by name and sits BEFORE the header in the DOM, so `.first()`
    // resolved to the sidebar row — which is `hidden lg:flex`, i.e. genuinely
    // display:none on mobile. That made this line pass on desktop and fail on
    // mobile the moment the sidebar's own projects query happened to have
    // landed, which is why it rotated in and out of CI. Nothing about the
    // product is wrong; the assertion just has to name the surface it means.
    await expect(page.getByTestId('project-breadcrumb-name')).toHaveText(newName);
  });

  test('a trailing-space-only edit does not falsely enable Save (trim-aware dirty check)', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'details-trim',
      projectName: 'Trim Check',
      openBoard: false,
    });
    await gotoSettings(page, ctx.project.id);

    const nameInput = page.locator('#settings-name');
    await nameInput.click();
    await nameInput.press('End');
    await nameInput.pressSequentially('   ', { delay: 30 });
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    // Empty name also keeps Save disabled (required field).
    await nameInput.press('Control+a');
    await nameInput.press('Backspace');
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });
});

// ===========================================================================
// 2. SETTINGS-1..4 — confirmed defects (see docs/UI-REVIEW.md, "Settings
//    robustness sweep — 2026-07-02"), now fixed. Each body encodes and
//    regression-gates the CORRECT behavior.
// ===========================================================================

test.describe('Settings robustness — confirmed defects (fixed, regression-gated)', () => {
  test(
    'SETTINGS-1 (P1): self-inviting your own email in the workspace Invite form must not silently strip your last admin seat',
    async ({ page, request }) => {
      // Repro: a solo workspace admin types their OWN email into the generic
      // "Invite member" form (defaulted to role=MEMBER) and clicks Invite.
      // Today this silently upserts their membership to MEMBER with no
      // confirmation and no last-admin guard — server-side (workspaces.
      // service.ts#addMember has no last-admin check, mirroring removeMember)
      // — permanently locking the workspace out of Settings/Branding/Member
      // management with no recovery path in the UI (verified via reload: the
      // demotion is persisted, not merely a stale client cache).
      const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
      const user = await registerNewUser(request, 'selfdemote');
      const workspaceId = await createWorkspace(
        request,
        user.token,
        `SelfDemote ${suffix}`,
      );
      await login(page, { email: user.email, password: user.password });

      await page.goto(`/workspaces/${workspaceId}/members`);
      await expect(page.getByTestId('workspace-members-page')).toBeVisible({
        timeout: 15_000,
      });

      await page
        .getByTestId('invite-email-input')
        .pressSequentially(user.email, { delay: 15 });
      // Role select defaults to MEMBER — the dangerous case.
      await page.getByTestId('invite-member-submit').click();

      // CORRECT behavior: either the action is rejected (you already have
      // access — self-management isn't done through this form) or it
      // requires an explicit confirmation naming the consequence ("you will
      // lose admin access"). Either way the actor must NOT end up demoted
      // with zero admins left and no recovery path.
      await expect(page.getByTestId('member-role-badge')).toHaveText(
        /admin/i,
      );
      await page.reload();
      await expect(page.getByTestId('invite-member-form')).toBeVisible(); // still admin
    },
  );

  test(
    'SETTINGS-2 (P2): workspace branding hex validation must match between client preview and server (3-digit shorthand)',
    async ({ page, request }) => {
      // Repro: the accent-color hex input's client-side regex accepts BOTH
      // 3-digit (#fff) and 6-digit hex and live-previews it as valid, but the
      // backend DTO (UpdateWorkspaceDto) only accepts 6-digit hex. Saving a
      // 3-digit value round-trips a raw 400 with the internal DTO field name
      // ("brandColor must be a valid 6-digit hex color…") instead of either
      // (a) normalizing #fff -> #ffffff client-side, or (b) rejecting the
      // 3-digit shorthand up front with a friendly inline message.
      const ctx = await setupIsolatedProject(page, request, {
        label: 'hex-valid',
        openBoard: false,
      });
      await page.goto(`/workspaces/${ctx.workspaceId}/branding`);
      await expect(page.getByTestId('branding-settings')).toBeVisible({
        timeout: 15_000,
      });

      const hexInput = page.getByTestId('brand-color-input');
      await hexInput.click();
      await hexInput.press('Control+a');
      await hexInput.pressSequentially('#fff', { delay: 20 });
      await page.getByTestId('brand-color-save').click();

      // CORRECT behavior: this either saves successfully (client normalizes
      // to #ffffff) or shows a friendly, non-technical inline validation
      // message BEFORE hitting the server — never a raw "brandColor must be…"
      // string surfaced verbatim in a toast.
      await expect(page.getByText(/brand color saved/i)).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText(/brandColor must be/i)).toHaveCount(0);
    },
  );

  test(
    'SETTINGS-3 (P2): board columns must reject a duplicate column name',
    async ({ page, request }) => {
      // Repro: Status has no @@unique([projectId, name]) constraint (unlike
      // Label/Component/Version), so Settings → Columns → "+ Add column"
      // happily creates a second column literally named "To Do" next to the
      // seeded one — confusing on both the board and this list, and
      // ambiguous for any name-keyed lookup (workflow transitions, filters).
      const ctx = await setupIsolatedProject(page, request, {
        label: 'col-dup',
        openBoard: false,
      });
      await gotoSettings(page, ctx.project.id);

      await openAddColumnModal(page);
      await page.locator('#column-name').pressSequentially('To Do', {
        delay: 15,
      });
      await page.getByRole('button', { name: 'Add column', exact: true }).click();

      // CORRECT behavior: rejected with a friendly duplicate-name error,
      // mirroring Labels/Components/Versions — modal stays open, no second
      // "To Do" column is created. The column form surfaces the error BOTH
      // as a toast and inline in the modal (a richer pattern than the
      // Labels/Components toast-only convention), so scope to `.first()` to
      // avoid a strict-mode ambiguous match while still asserting the
      // message reaches the user.
      await expect(page.getByText(/already exists/i).first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        page.getByTestId('settings-column-row').filter({ hasText: 'To Do' }),
      ).toHaveCount(1);
    },
  );

  test(
    'SETTINGS-4 (P2): duplicate label name must show a friendly per-entity error, not the raw backend message',
    async ({ page, request }) => {
      // Repro: Label DOES have @@unique([projectId, name]) so the duplicate
      // is correctly rejected server-side (409), but labels.service.ts never
      // catches P2002 the way components.service.ts / versions.service.ts /
      // issue-templates.service.ts do, so the generic AllExceptionsFilter
      // fallback message ("A record with this value already exists.") leaks
      // straight into the toast instead of `A label named "X" already exists.`
      const ctx = await setupIsolatedProject(page, request, {
        label: 'label-dup',
        labels: ['bug'],
        openBoard: false,
      });
      await gotoSettings(page, ctx.project.id);

      await page
        .locator('#settings-label-name')
        .pressSequentially('bug', { delay: 15 });
      await page.getByRole('button', { name: 'Add label' }).click();

      // CORRECT behavior: a friendly, label-specific message — consistent
      // with the Components/Versions/Templates pattern — not the generic
      // Prisma-fallback string.
      await expect(
        page.getByText(/a label named "bug" already exists/i),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByText(/a record with this value already exists/i),
      ).toHaveCount(0);
      await expect(page.getByTestId('settings-label-row')).toHaveCount(1);
    },
  );
});

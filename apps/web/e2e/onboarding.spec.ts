/**
 * Onboarding / empty-state spec.
 *
 * Covers the v1.0 release criterion:
 *   "First-run experience isn't an empty void: onboarding offers a sample
 *   project or clear 'create your first project' guidance."
 *
 * Runs on desktop AND mobile (both projects in playwright.config.ts).
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { registerNewUser, createWorkspace, API_URL } from './helpers';

// ---------------------------------------------------------------------------
// Helper: register a brand-new user and land on the dashboard (no project yet)
// ---------------------------------------------------------------------------

async function loginFreshUser(
  page: Page,
  request: APIRequestContext,
): Promise<void> {
  // Register a unique user with their own workspace so there are zero projects.
  const user = await registerNewUser(request, 'onboard');
  // The register endpoint auto-creates a workspace, but no projects.
  // Make sure at least one workspace exists (the auto-created one is enough).
  void createWorkspace; // imported but not called here – auto-ws is created on register

  // Log in through the UI using pressSequentially (per-keystroke, not .fill).
  await page.goto('/login');
  const emailInput = page.getByLabel(/email/i);
  const passwordInput = page.getByLabel(/password/i);
  await emailInput.click();
  await emailInput.pressSequentially(user.email, { delay: 30 });
  await passwordInput.click();
  await passwordInput.pressSequentially(user.password, { delay: 30 });
  await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
  // Wait for redirect away from /login.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Onboarding panel tests
// ---------------------------------------------------------------------------

test.describe('Onboarding panel (no projects)', () => {
  test('shows the welcome panel with a CTA when user has no projects', async ({
    page,
    request,
  }) => {
    await loginFreshUser(page, request);

    // The onboarding panel must be visible and have the expected heading.
    const panel = page.getByTestId('onboarding-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(
      panel.getByRole('heading', { name: /welcome to next lane/i }),
    ).toBeVisible();

    // The primary CTA button must be keyboard-focusable and visible.
    const cta = page.getByTestId('onboarding-create-project');
    await expect(cta).toBeVisible();
    await expect(cta).toBeEnabled();
  });

  test('CTA opens the create-project modal', async ({ page, request }) => {
    await loginFreshUser(page, request);

    const cta = page.getByTestId('onboarding-create-project');
    await expect(cta).toBeVisible({ timeout: 15_000 });
    await cta.click();

    // The CreateProjectModal should now be open.
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole('heading', { name: /new project/i }),
    ).toBeVisible();
  });

  test('creating a project through the CTA navigates to the board', async ({
    page,
    request,
  }) => {
    await loginFreshUser(page, request);

    // Click the onboarding CTA.
    const cta = page.getByTestId('onboarding-create-project');
    await expect(cta).toBeVisible({ timeout: 15_000 });
    await cta.click();

    // Fill in project name.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const nameInput = dialog.getByLabel(/name/i);
    await nameInput.click();
    await nameInput.pressSequentially('My First Project', { delay: 30 });

    // Submit.
    await dialog.getByRole('button', { name: /create project/i }).click();

    // Should navigate to the project board.
    await expect(page).toHaveURL(/\/projects\/.+\/board/, { timeout: 15_000 });
  });

  test('panel disappears after the first project is created', async ({
    page,
    request,
  }) => {
    await loginFreshUser(page, request);

    // Click the CTA.
    const cta = page.getByTestId('onboarding-create-project');
    await expect(cta).toBeVisible({ timeout: 15_000 });
    await cta.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const nameInput = dialog.getByLabel(/name/i);
    await nameInput.click();
    await nameInput.pressSequentially('Seeded Project', { delay: 30 });
    await dialog.getByRole('button', { name: /create project/i }).click();

    // After creation we're on the board. Navigate back to the dashboard.
    await expect(page).toHaveURL(/\/projects\/.+\/board/, { timeout: 15_000 });
    await page.goto('/');

    // The onboarding panel should no longer be visible (we now have a project).
    await expect(page.getByTestId('onboarding-panel')).not.toBeVisible({
      timeout: 10_000,
    });

    // At least one project card should be present.
    await expect(
      page.getByRole('button', { name: /seeded project/i }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Board empty state (no issues on a fresh project)
// ---------------------------------------------------------------------------

test.describe('Board empty state', () => {
  test('shows add-issue affordances when a fresh board has no issues', async ({
    page,
    request,
  }) => {
    await loginFreshUser(page, request);

    // Create a project via the UI (CTA flow).
    const cta = page.getByTestId('onboarding-create-project');
    await expect(cta).toBeVisible({ timeout: 15_000 });
    await cta.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    const nameInput = dialog.getByLabel(/name/i);
    await nameInput.click();
    await nameInput.pressSequentially('Empty Board Project', { delay: 30 });
    await dialog.getByRole('button', { name: /create project/i }).click();

    // Now on the board – it has columns but no issues.
    await expect(page).toHaveURL(/\/projects\/.+\/board/, { timeout: 15_000 });

    // The toolbar "Create issue" button should be accessible.
    await expect(page.getByRole('button', { name: /\+ Create issue/i })).toBeVisible();

    // The board columns render their "To Do" status (seeded by default).
    await expect(page.getByText(/to do/i).first()).toBeVisible();

    // Each empty column shows a "+ Add issue" affordance (column header + dashed area).
    await expect(page.getByRole('button', { name: /add issue to to do/i }).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Notifications empty state
// ---------------------------------------------------------------------------

test.describe('Notifications empty state', () => {
  test('shows a descriptive empty state when there are no notifications', async ({
    page,
    request,
  }) => {
    await loginFreshUser(page, request);

    // Open the notification bell.
    const bell = page.getByRole('button', { name: /notifications/i });
    await expect(bell).toBeVisible({ timeout: 10_000 });
    await bell.click();

    // The "all caught up" empty state should be visible.
    const empty = page.getByTestId('notifications-empty');
    await expect(empty).toBeVisible({ timeout: 5_000 });
    await expect(empty.getByText(/all caught up/i)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// My Work empty state
// ---------------------------------------------------------------------------

test.describe('My Work empty state', () => {
  test('shows a descriptive empty state when user has no assigned or reported issues', async ({
    page,
    request,
  }) => {
    await loginFreshUser(page, request);

    // Navigate to My Work.
    await page.goto('/my-work');

    const empty = page.getByTestId('my-work-empty');
    await expect(empty).toBeVisible({ timeout: 10_000 });
    await expect(empty.getByText(/no work items yet/i)).toBeVisible();
  });
});

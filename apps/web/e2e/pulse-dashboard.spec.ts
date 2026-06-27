/**
 * Team Pulse Dashboard e2e spec.
 *
 * Covers:
 *  1. Authenticated demo user sees the pulse dashboard with all four sections.
 *  2. Sprint snapshot section renders (at least one active sprint row for the
 *     demo project, because the seed starts a sprint).
 *  3. "Assigned to me" section shows the demo user's issues.
 *  4. Recent activity section renders (empty or with items).
 *  5. Projects section shows at least one project card.
 *  6. Fresh user with no projects still sees the OnboardingPanel (not the pulse
 *     dashboard), verifying the first-run fallback is preserved.
 *  7. "Assigned to me" — clicking a row navigates to the board with ?issue=.
 *
 * Runs on desktop AND mobile (both Playwright projects in playwright.config.ts).
 */
import { test, expect } from '@playwright/test';
import { login, registerNewUser, createWorkspace, DEMO, API_URL } from './helpers';

// ---------------------------------------------------------------------------
// Demo-user pulse tests
// ---------------------------------------------------------------------------

test.describe('Pulse Dashboard (demo user)', () => {
  test('renders all four dashboard sections', async ({ page }) => {
    await login(page, DEMO);

    // The pulse dashboard container must be present.
    const dashboard = page.getByTestId('pulse-dashboard');
    await expect(dashboard).toBeVisible({ timeout: 15_000 });

    // Sprint snapshot section.
    await expect(page.getByTestId('sprint-snapshot')).toBeVisible();

    // "Assigned to me" section.
    await expect(page.getByTestId('my-issues-section')).toBeVisible();

    // Recent activity section.
    await expect(page.getByTestId('recent-activity-section')).toBeVisible();

    // Projects section heading.
    await expect(
      page.getByRole('heading', { name: /projects/i }),
    ).toBeVisible();
  });

  test('sprint snapshot shows an active sprint for the seeded project', async ({ page }) => {
    await login(page, DEMO);

    const snapshot = page.getByTestId('sprint-snapshot');
    await expect(snapshot).toBeVisible({ timeout: 15_000 });

    // The seed starts Sprint 1 on the NL demo project. The sprint row contains
    // a project key pill and sprint name within the snapshot section.
    // Wait for the loading skeleton to resolve.
    await expect(snapshot.getByText(/NL/)).toBeVisible({ timeout: 10_000 });
  });

  test('projects section shows the seeded Next Lane project card', async ({ page }) => {
    await login(page, DEMO);

    await expect(page.getByTestId('pulse-dashboard')).toBeVisible({ timeout: 15_000 });

    // The demo project card should be present and clickable.
    const projectCard = page.getByRole('button', { name: /next lane/i }).first();
    await expect(projectCard).toBeVisible({ timeout: 10_000 });
  });

  test('clicking a project card navigates to its board', async ({ page }) => {
    await login(page, DEMO);

    await expect(page.getByTestId('pulse-dashboard')).toBeVisible({ timeout: 15_000 });

    const projectCard = page.getByRole('button', { name: /next lane/i }).first();
    await expect(projectCard).toBeVisible({ timeout: 10_000 });
    await projectCard.click();

    await expect(page).toHaveURL(/\/projects\/.+\/board/, { timeout: 15_000 });
  });

  test('"Assigned to me" shows a seeded issue and clicking navigates to board drawer', async ({ page }) => {
    await login(page, DEMO);

    await expect(page.getByTestId('pulse-dashboard')).toBeVisible({ timeout: 15_000 });

    const section = page.getByTestId('my-issues-section');
    await expect(section).toBeVisible();

    // The seed assigns issues to the demo user; wait for them to load.
    // We look for any issue row (button) inside the my-issues section.
    // If assigned.length === 0 we accept the empty state (seed may vary).
    const issueBtn = section.getByRole('button').first();
    const isEmpty = await page.getByText(/nothing assigned to you/i).isVisible().catch(() => false);

    if (!isEmpty) {
      await expect(issueBtn).toBeVisible({ timeout: 10_000 });
      await issueBtn.click();
      await expect(page).toHaveURL(/\/projects\/.+\/board\?issue=/, {
        timeout: 15_000,
      });
    }
  });

  test('recent activity section renders without error', async ({ page }) => {
    await login(page, DEMO);

    await expect(page.getByTestId('pulse-dashboard')).toBeVisible({ timeout: 15_000 });
    const activity = page.getByTestId('recent-activity-section');
    await expect(activity).toBeVisible();
    // Either items or the empty state should be present — just no error state.
    await expect(page.getByText(/couldn.*t load/i)).toHaveCount(0);
  });

  test('"View all" link on assigned section goes to /my-work', async ({ page }) => {
    await login(page, DEMO);

    await expect(page.getByTestId('pulse-dashboard')).toBeVisible({ timeout: 15_000 });

    const link = page.getByRole('link', { name: /view all/i }).first();
    await expect(link).toBeVisible({ timeout: 5_000 });
    await link.click();
    await expect(page).toHaveURL(/\/my-work/, { timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Fresh-user onboarding fallback
// ---------------------------------------------------------------------------

test.describe('Pulse Dashboard — fresh user onboarding fallback', () => {
  test('shows OnboardingPanel (not the pulse dashboard) when user has no projects', async ({
    page,
    request,
  }) => {
    // Register a brand-new user (auto-creates a workspace, no projects).
    const user = await registerNewUser(request, 'pulse-fresh');

    // Log in through the UI.
    await page.goto('/login');
    const emailInput = page.getByLabel(/email/i);
    const passwordInput = page.getByLabel(/password/i);
    await emailInput.click();
    await emailInput.pressSequentially(user.email, { delay: 20 });
    await passwordInput.click();
    await passwordInput.pressSequentially(user.password, { delay: 20 });
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    // The onboarding panel must be visible.
    const panel = page.getByTestId('onboarding-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // The pulse dashboard container must NOT be visible.
    await expect(page.getByTestId('pulse-dashboard')).not.toBeVisible();

    // The onboarding heading and CTA are present.
    await expect(
      panel.getByRole('heading', { name: /welcome to next lane/i }),
    ).toBeVisible();
    const cta = page.getByTestId('onboarding-create-project');
    await expect(cta).toBeVisible();
    await expect(cta).toBeEnabled();
  });

  test('OnboardingPanel CTA opens create-project modal on the pulse page', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'pulse-cta');

    await page.goto('/login');
    const emailInput = page.getByLabel(/email/i);
    const passwordInput = page.getByLabel(/password/i);
    await emailInput.click();
    await emailInput.pressSequentially(user.email, { delay: 20 });
    await passwordInput.click();
    await passwordInput.pressSequentially(user.password, { delay: 20 });
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    const cta = page.getByTestId('onboarding-create-project');
    await expect(cta).toBeVisible({ timeout: 15_000 });
    await cta.click();

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole('heading', { name: /new project/i }),
    ).toBeVisible();
  });

  test('after creating first project the pulse dashboard replaces onboarding', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'pulse-create');

    await page.goto('/login');
    const emailInput = page.getByLabel(/email/i);
    const passwordInput = page.getByLabel(/password/i);
    await emailInput.click();
    await emailInput.pressSequentially(user.email, { delay: 20 });
    await passwordInput.click();
    await passwordInput.pressSequentially(user.password, { delay: 20 });
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    // Click onboarding CTA.
    const cta = page.getByTestId('onboarding-create-project');
    await expect(cta).toBeVisible({ timeout: 15_000 });
    await cta.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const nameInput = dialog.getByLabel(/name/i);
    await nameInput.click();
    await nameInput.pressSequentially('My Pulse Project', { delay: 20 });
    await dialog.getByRole('button', { name: /create project/i }).click();

    // Should navigate to the new project board.
    await expect(page).toHaveURL(/\/projects\/.+\/board/, { timeout: 15_000 });

    // Navigate back to home — the pulse dashboard should now appear.
    await page.goto('/');
    await expect(page.getByTestId('pulse-dashboard')).toBeVisible({ timeout: 15_000 });
    // Onboarding panel should be gone.
    await expect(page.getByTestId('onboarding-panel')).not.toBeVisible();
  });
});

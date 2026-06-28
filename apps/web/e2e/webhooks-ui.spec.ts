import { test, expect } from '@playwright/test';
import {
  setupIsolatedProject,
  registerNewUser,
  addWorkspaceMember,
  login,
} from './helpers';

// UI verification of the Webhooks settings section. An ADMIN registers a webhook
// through the modal on the Project Settings page, sees it listed, sends a test
// event, and observes a delivery row appear in the per-subscription log.
//
// The webhook URL points at a deliberately unreachable host so the test never
// makes a successful external call; the delivery is still recorded (as failed),
// which is exactly what we assert appears in the log.
//
// Both tests use setupIsolatedProject so the demo account is never touched.

test.describe('Webhooks settings UI', () => {
  // ENV DEPENDENCY: the "log a delivery" assertion requires Redis. When REDIS_URL
  // is set but Redis is unreachable, BullMQ jobs fail and no delivery row is
  // recorded. In CI (e2e.yml) a Redis service container is present. In this
  // local harness (no Redis), this test fails — that is expected and not a
  // product bug. The webhook registration and listing portions work without Redis.
  test('an admin can add a webhook and see it listed, then log a delivery', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'wh-ui',
      projectName: 'Webhook UI Project',
      openBoard: false,
    });

    await page.goto(`/projects/${ctx.project.id}/settings`);

    const section = page
      .locator('section')
      .filter({ hasText: 'Webhooks' });
    await expect(
      section.getByRole('heading', { name: 'Webhooks' }),
    ).toBeVisible();

    // Open the add-webhook modal.
    await section.getByRole('button', { name: '+ Add webhook' }).click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Add webhook' }),
    ).toBeVisible();

    // Unreachable host: keeps the test fully local (no successful external call).
    const hookUrl = 'http://127.0.0.1:1/next-lane-hook';
    await dialog.getByLabel('Payload URL').fill(hookUrl);
    // Subscribe to a single event so the summary reads "1 event".
    await dialog.getByLabel('Issue created').check();
    await dialog.getByRole('button', { name: 'Add webhook' }).click();

    // The new subscription appears in the list.
    const row = page.getByTestId('settings-webhook-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(hookUrl);
    await expect(row).toContainText('1 event');

    // Send a test event; a delivery row should be logged (failed, since the
    // host is unreachable) and the delivery log auto-expands.
    await row.getByRole('button', { name: 'Send test' }).click();

    await expect(page.getByTestId('webhook-delivery-list')).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByTestId('webhook-delivery-row').first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('the webhooks section is hidden from non-admins', async ({
    page,
    request,
  }) => {
    // setupIsolatedProject registers the user as the workspace owner (ADMIN),
    // so to test a non-admin we add a second VIEWER and view as them.
    const ctx = await setupIsolatedProject(page, request, {
      label: 'wh-viewer-admin',
      openBoard: false,
    });

    // Register a viewer and add them to the workspace.
    const viewer = await registerNewUser(request, 'wh-viewer');
    await addWorkspaceMember(
      request,
      ctx.token,
      ctx.workspaceId,
      viewer.email,
      'VIEWER',
    );

    await login(page, { email: viewer.email, password: viewer.password });
    await page.goto(`/projects/${ctx.project.id}/settings`);

    // Settings page renders, but the Webhooks section is not shown to viewers.
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Webhooks' }),
    ).toHaveCount(0);
  });
});

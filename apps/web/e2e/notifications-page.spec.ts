/**
 * notifications-page.spec.ts
 *
 * The /notifications center page: lists notifications, filters by type,
 * bulk mark-all-read, and is reachable from the bell's "See all" link.
 */

import { test, expect } from '@playwright/test';
import {
  registerNewUser,
  createWorkspace,
  createProject,
  addWorkspaceMember,
  createIssue,
  login,
} from './helpers';

test.describe('Notifications center (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('lists notifications, filters by type, and marks all read', async ({
    page,
    request,
  }) => {
    // userA assigns an issue to userB → B gets an ASSIGNED notification.
    const userA = await registerNewUser(request, 'np-a');
    const userB = await registerNewUser(request, 'np-b');
    const wsId = await createWorkspace(request, userA.token);
    await addWorkspaceMember(request, userA.token, wsId, userB.email);
    const project = await createProject(request, userA.token, wsId);
    await createIssue(request, userA.token, project.id, {
      title: 'Assigned to B',
      assigneeId: userB.userId,
    });

    await login(page, { email: userB.email, password: userB.password });
    await page.goto('/notifications');

    await expect(page.getByTestId('notifications-page')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('notification-row').first()).toBeVisible({
      timeout: 10_000,
    });

    // Filter by Assigned — the row stays; filter group is present.
    await expect(page.getByTestId('notification-filter')).toBeVisible();
    await page.getByTestId('notification-filter-assigned').click();
    await expect(page.getByTestId('notification-row').first()).toBeVisible();

    // Mark all read works without error.
    await page.getByTestId('notifications-mark-all-read').click();
    await expect(page.getByTestId('notifications-page')).toBeVisible();
  });

  test('bell "See all" link reaches the notifications page', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'np-nav');
    await login(page, { email: user.email, password: user.password });
    await page.goto('/');

    // Open the bell (its trigger button is labelled "Notifications…"), then "See all".
    await page.getByRole('button', { name: /notification/i }).first().click();
    await page.getByTestId('notification-bell-see-all').click();
    await expect(page).toHaveURL(/\/notifications/);
    await expect(page.getByTestId('notifications-page')).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe('Notifications center (mobile)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('renders without horizontal overflow', async ({ page, request }) => {
    const user = await registerNewUser(request, 'np-mob');
    await login(page, { email: user.email, password: user.password });
    await page.goto('/notifications');
    await expect(page.getByTestId('notifications-page')).toBeVisible({
      timeout: 15_000,
    });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

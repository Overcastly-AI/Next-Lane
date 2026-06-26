import { test, expect } from '@playwright/test';
import {
  registerNewUser,
  createWorkspace,
  createProject,
  addWorkspaceMember,
  createIssue,
  login,
} from './helpers';

/**
 * End-to-end coverage for Notifications & @mentions, against ISOLATED users /
 * workspaces / projects so the seeded demo is never touched.
 *
 * Flow: user A owns a workspace+project and adds user B as a co-member. A
 * assigns an issue to B (ASSIGNED notification) and posts a comment mentioning
 * B by @<email> (MENTIONED notification). B then logs into the UI, sees the
 * bell's unread badge, opens the panel, and clicking a notification navigates
 * to the issue's board (?issue=) and marks it read (badge decrements).
 */
test.describe('Notifications & @mentions', () => {
  test('assignee + mentioned co-member sees notifications and opens the issue', async ({
    page,
    request,
  }) => {
    // --- API setup: A owns the project, B is a co-member ---
    const userA = await registerNewUser(request, 'notif-a');
    const userB = await registerNewUser(request, 'notif-b');
    const workspaceId = await createWorkspace(request, userA.token);
    const project = await createProject(request, userA.token, workspaceId, {
      name: 'Notif Project',
    });
    await addWorkspaceMember(request, userA.token, workspaceId, userB.email);

    // A assigns an issue to B -> ASSIGNED notification for B.
    const issue = await createIssue(request, userA.token, project.id, {
      title: 'Please handle this',
      assigneeId: userB.userId,
    });

    // A comments mentioning B by @<email> -> MENTIONED notification for B.
    const commentRes = await request.post(
      `${process.env.PW_API_URL ?? 'http://localhost:4000'}/api/issues/${
        issue.id
      }/comments`,
      {
        headers: { Authorization: `Bearer ${userA.token}` },
        data: { body: `please review @${userB.email}` },
      },
    );
    expect(commentRes.ok(), `comment failed: ${commentRes.status()}`).toBeTruthy();

    // --- UI: B logs in and checks the bell ---
    await login(page, { email: userB.email, password: userB.password });

    const badge = page.getByTestId('notification-badge');
    await expect(badge).toBeVisible({ timeout: 15_000 });
    // Two notifications: ASSIGNED + MENTIONED.
    await expect(badge).toHaveText('2');

    // Open the panel.
    await page.getByRole('button', { name: /notifications/i }).click();
    const panel = page.getByRole('menu', { name: /notifications/i });
    await expect(panel).toBeVisible();

    // Both notifications reference the issue key and the actor's name (A).
    await expect(panel.getByText(issue.key).first()).toBeVisible();
    await expect(panel.getByText(/mentioned you/i)).toBeVisible();
    await expect(panel.getByText(/assigned/i).first()).toBeVisible();

    // Click the MENTIONED notification -> navigates to the board with ?issue=,
    // and marks that one read (badge drops to 1).
    await panel.getByText(/mentioned you/i).click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/${project.id}/board\\?issue=${issue.id}`),
    );
    await expect(badge).toHaveText('1');
  });

  test('mark all read clears the unread badge', async ({ page, request }) => {
    const userA = await registerNewUser(request, 'notif-c');
    const userB = await registerNewUser(request, 'notif-d');
    const workspaceId = await createWorkspace(request, userA.token);
    const project = await createProject(request, userA.token, workspaceId);
    await addWorkspaceMember(request, userA.token, workspaceId, userB.email);
    await createIssue(request, userA.token, project.id, {
      title: 'Assigned to B',
      assigneeId: userB.userId,
    });

    await login(page, { email: userB.email, password: userB.password });

    const badge = page.getByTestId('notification-badge');
    await expect(badge).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /notifications/i }).click();
    const panel = page.getByRole('menu', { name: /notifications/i });
    await expect(panel).toBeVisible();

    await panel.getByRole('button', { name: /mark all read/i }).click();
    // Badge disappears once nothing is unread.
    await expect(badge).toHaveCount(0);
  });
});

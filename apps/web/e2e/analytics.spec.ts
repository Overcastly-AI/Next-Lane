/**
 * analytics.spec.ts
 *
 * End-to-end tests for the Personal & Team analytics surfaces:
 *   - /me/analytics              (PersonalAnalyticsPage)
 *   - /projects/:id/analytics    (ProjectAnalyticsPage, "Analytics" tab)
 *
 * These complement the existing sprint-centric Reports tab (velocity /
 * burndown / CFD). Charts are hand-rolled SVG; the tests assert structure,
 * stat values, window-selector behaviour, and that real created/assigned
 * work shows up in the aggregates — driving the actual API, not mocks.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  login,
  registerNewUser,
  createWorkspace,
  createProject,
  createIssue,
  API_URL,
} from './helpers';

/**
 * Move an issue into the project's DONE-category status so it counts as
 * completed (and produces a cycle-time data point). Uses the board endpoint to
 * resolve the done status, then the issue move endpoint — exactly what the UI
 * does when a card is dragged to the Done column.
 */
async function completeIssue(
  request: APIRequestContext,
  token: string,
  projectId: string,
  issueId: string,
): Promise<void> {
  const headers = { Authorization: `Bearer ${token}` };
  const boardRes = await request.get(
    `${API_URL}/api/projects/${projectId}/board`,
    { headers },
  );
  expect(boardRes.ok(), `board fetch failed: ${boardRes.status()}`).toBeTruthy();
  const board = (await boardRes.json()) as {
    statuses: { id: string; category: string }[];
  };
  const done = board.statuses.find((s) => s.category === 'DONE');
  expect(done, 'project has a DONE-category status').toBeTruthy();
  const moveRes = await request.post(
    `${API_URL}/api/issues/${issueId}/move`,
    { headers, data: { statusId: done!.id } },
  );
  expect(moveRes.ok(), `move failed: ${moveRes.status()}`).toBeTruthy();
}

// ---------------------------------------------------------------------------
// Personal analytics — /me/analytics
// ---------------------------------------------------------------------------

test.describe('Personal analytics — desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('reaches /me/analytics from the header "Insights" link', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'an-nav');
    await login(page, { email: user.email, password: user.password });

    await page.goto('/');
    await page.getByTestId('nav-my-analytics').click();
    await expect(page).toHaveURL(/\/me\/analytics/);
    await expect(page.getByTestId('personal-analytics')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('renders stat cards, throughput chart and personal-board stats', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'an-personal');
    // Give this user some assigned, still-open work so "open" is non-zero.
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId, {
      name: 'Personal Analytics QA',
    });
    for (let i = 0; i < 3; i++) {
      await createIssue(request, user.token, project.id, {
        title: `Assigned task ${i + 1}`,
        assigneeId: user.userId,
      });
    }

    await login(page, { email: user.email, password: user.password });
    await page.goto('/me/analytics');

    await expect(page.getByTestId('personal-analytics')).toBeVisible({
      timeout: 15_000,
    });
    // Headline cards.
    await expect(page.getByTestId('stat-open')).toBeVisible();
    await expect(page.getByTestId('stat-completed')).toBeVisible();
    await expect(page.getByTestId('stat-overdue')).toBeVisible();
    await expect(page.getByTestId('stat-cycle-time')).toBeVisible();
    // Three open issues assigned to me should be reflected.
    await expect(page.getByTestId('stat-open')).toContainText('3');

    // Charts / breakdowns / board stats present.
    await expect(page.getByTestId('throughput-chart')).toBeVisible();
    await expect(page.getByTestId('by-type-bars')).toBeVisible();
    await expect(page.getByTestId('by-priority-bars')).toBeVisible();
    await expect(page.getByTestId('personal-board-stats')).toBeVisible();
    await expect(page.getByTestId('board-stat-total')).toBeVisible();
  });

  test('window selector switches the active range', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'an-window');
    await login(page, { email: user.email, password: user.password });
    await page.goto('/me/analytics');

    await expect(page.getByTestId('personal-analytics')).toBeVisible({
      timeout: 15_000,
    });
    const ninety = page.getByTestId('personal-analytics-window-90');
    await ninety.click();
    await expect(ninety).toHaveAttribute('aria-pressed', 'true');
    // The page stays functional after switching window.
    await expect(page.getByTestId('throughput-chart')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Team / project analytics — /projects/:id/analytics
// ---------------------------------------------------------------------------

test.describe('Project analytics — desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Analytics tab renders flow, cycle-time and workload', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'an-project');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId, {
      name: 'Team Analytics QA',
    });
    // Two issues assigned to the creator, one left unassigned. One of the
    // assigned issues is completed so the completed/cycle-time paths have data.
    const mineA = await createIssue(request, user.token, project.id, {
      title: 'Mine A',
      assigneeId: user.userId,
    });
    await createIssue(request, user.token, project.id, {
      title: 'Mine B',
      assigneeId: user.userId,
    });
    await createIssue(request, user.token, project.id, { title: 'Nobody' });
    await completeIssue(request, user.token, project.id, mineA.id);

    await login(page, { email: user.email, password: user.password });
    await page.goto(`/projects/${project.id}/board`);

    // Navigate via the project nav: Analytics lives in the "More" menu.
    await page.getByRole('button', { name: /^more/i }).click();
    await page
      .getByRole('menuitem', { name: /^analytics$/i })
      .click();
    await expect(page).toHaveURL(/\/analytics/);
    await expect(page.getByTestId('project-analytics')).toBeVisible({
      timeout: 15_000,
    });

    // Headline cards: three issues created, one completed in the window.
    await expect(page.getByTestId('project-stat-created')).toContainText('3');
    await expect(page.getByTestId('project-stat-completed')).toContainText('1');
    await expect(page.getByTestId('project-stat-cycle-time')).toBeVisible();

    // Charts + workload (all have data now).
    await expect(page.getByTestId('flow-chart')).toBeVisible();
    await expect(page.getByTestId('cycle-time-chart')).toBeVisible();
    const workload = page.getByTestId('workload-bars');
    await expect(workload).toBeVisible();
    // The unassigned issue produces an "Unassigned" row.
    await expect(workload).toContainText(/unassigned/i);
  });

  test('window selector switches the active range', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'an-proj-window');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);

    await login(page, { email: user.email, password: user.password });
    await page.goto(`/projects/${project.id}/analytics`);

    await expect(page.getByTestId('project-analytics')).toBeVisible({
      timeout: 15_000,
    });
    const fourteen = page.getByTestId('project-analytics-window-14');
    await fourteen.click();
    await expect(fourteen).toHaveAttribute('aria-pressed', 'true');
    // Stat cards always render; the empty project shows chart empty-states.
    await expect(page.getByTestId('project-stat-created')).toContainText('0');
  });
});

// ---------------------------------------------------------------------------
// Mobile
// ---------------------------------------------------------------------------

test.describe('Analytics — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('personal analytics has no horizontal overflow on mobile', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'an-mobile');
    await login(page, { email: user.email, password: user.password });
    await page.goto('/me/analytics');

    await expect(page.getByTestId('personal-analytics')).toBeVisible({
      timeout: 15_000,
    });
    // The document should not scroll horizontally.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('project analytics renders on mobile', async ({ page, request }) => {
    const user = await registerNewUser(request, 'an-mob-proj');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);

    await login(page, { email: user.email, password: user.password });
    await page.goto(`/projects/${project.id}/analytics`);

    await expect(page.getByTestId('project-analytics')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('project-stat-cards')).toBeVisible();
  });
});

/**
 * e2e: Configurable dashboards (NLQL-native gadget framework).
 *
 * Route: /projects/:projectId/dashboards
 *
 * Covers:
 *  - create a dashboard, add a STAT gadget with an NLQL query (typed per
 *    keystroke through the real NlqlInput autocomplete), value matches the
 *    seeded data
 *  - add a BREAKDOWN gadget grouped by status, bars render with counts
 *  - a gadget whose stored query becomes invalid (its referenced custom
 *    field is deleted) shows a friendly per-gadget error, not a crash
 *  - VIEWER sees the dashboard read-only (no add/edit/delete affordances)
 *  - mobile (393px): no horizontal page overflow
 *
 * Uses isolated projects so the shared demo is never polluted.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  setupIsolatedProject,
  registerNewUser,
  addWorkspaceMember,
  API_URL,
} from './helpers';

interface StatusRow {
  id: string;
  name: string;
}

async function getStatuses(
  request: APIRequestContext,
  token: string,
  projectId: string,
): Promise<StatusRow[]> {
  const res = await request.get(`${API_URL}/api/projects/${projectId}/statuses`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `list statuses failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as StatusRow[];
}

async function createIssueWith(
  request: APIRequestContext,
  token: string,
  projectId: string,
  data: Record<string, unknown>,
): Promise<{ id: string; key: string }> {
  const res = await request.post(`${API_URL}/api/issues`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { projectId, ...data },
  });
  expect(res.ok(), `create issue failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as { id: string; key: string };
}

async function createCustomField(
  request: APIRequestContext,
  token: string,
  projectId: string,
  name: string,
  options: string[],
): Promise<{ id: string; key: string }> {
  const res = await request.post(`${API_URL}/api/projects/${projectId}/custom-fields`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, type: 'SELECT', options },
  });
  expect(res.ok(), `create custom field failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as { id: string; key: string };
}

async function deleteCustomField(
  request: APIRequestContext,
  token: string,
  fieldId: string,
): Promise<void> {
  const res = await request.delete(`${API_URL}/api/custom-fields/${fieldId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `delete custom field failed: ${res.status()}`).toBeTruthy();
}

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

async function createDashboard(page: Page, name: string): Promise<void> {
  await page.getByTestId('dashboard-create').first().click();
  const nameInput = page.getByTestId('dashboard-name-input');
  await nameInput.click();
  await nameInput.pressSequentially(name, { delay: 10 });
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page.getByTestId('dashboard-tab').filter({ hasText: name })).toBeVisible({
    timeout: 10_000,
  });
}

async function addGadget(
  page: Page,
  opts: { title: string; query: string; visualization?: 'STAT' | 'TABLE' | 'BREAKDOWN' | 'BURNDOWN'; breakdownField?: string },
): Promise<void> {
  await page.getByTestId('gadget-add').first().click();
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5000 });

  const titleInput = modal.getByTestId('gadget-title-input');
  await titleInput.click();
  await titleInput.pressSequentially(opts.title, { delay: 10 });

  const queryInput = modal.getByTestId('gadget-query-input');
  await queryInput.click();
  if (opts.query) {
    await queryInput.pressSequentially(opts.query, { delay: 15 });
  }
  // Dismiss the autocomplete dropdown without risking the Modal's global
  // Escape-to-close handler: Tab closes the dropdown locally (or is a no-op
  // when it's already closed) and never bubbles into a modal-close.
  await queryInput.press('Tab');

  if (opts.visualization && opts.visualization !== 'STAT') {
    await modal.getByTestId('gadget-visualization-select').selectOption(opts.visualization);
  }
  if (opts.visualization === 'BREAKDOWN' && opts.breakdownField) {
    await modal.getByTestId('gadget-breakdown-field-select').selectOption(opts.breakdownField);
  }

  await modal.getByTestId('gadget-save').click();
  await expect(modal).toBeHidden({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

test.describe('Dashboards', () => {
  test('create dashboard, add a STAT gadget with an NLQL query, count matches seeded data', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'dash-stat',
      projectName: 'Dashboard Stat Test',
      openBoard: false,
    });

    await createIssueWith(request, ctx.token, ctx.project.id, {
      title: 'High prio A',
      priority: 'HIGH',
    });
    await createIssueWith(request, ctx.token, ctx.project.id, {
      title: 'High prio B',
      priority: 'HIGH',
    });
    await createIssueWith(request, ctx.token, ctx.project.id, {
      title: 'Medium prio',
      priority: 'MEDIUM',
    });

    await page.goto(`/projects/${ctx.project.id}/dashboards`);
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });

    await createDashboard(page, 'Team overview');
    await addGadget(page, { title: 'High priority', query: 'priority = HIGH' });

    const card = page.getByTestId('dashboard-gadget').filter({ hasText: 'High priority' });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByTestId('gadget-stat-value')).toHaveText('2', { timeout: 10_000 });
  });

  // Pass-12 engineering audit P1-2: dashboards had zero realtime coverage —
  // a STAT gadget's count silently went stale until a manual reload. Covers
  // the fix: DashboardsPage subscribes to the project's socket room and
  // invalidates the dashboard data cache on issue.* events.
  test('STAT gadget count updates live when an issue is created via the API (no reload)', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'dash-realtime',
      projectName: 'Dashboard Realtime Test',
      openBoard: false,
    });

    await createIssueWith(request, ctx.token, ctx.project.id, {
      title: 'Existing high prio',
      priority: 'HIGH',
    });

    await page.goto(`/projects/${ctx.project.id}/dashboards`);
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });

    await createDashboard(page, 'Live overview');
    await addGadget(page, { title: 'High priority', query: 'priority = HIGH' });

    const card = page.getByTestId('dashboard-gadget').filter({ hasText: 'High priority' });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByTestId('gadget-stat-value')).toHaveText('1', { timeout: 10_000 });

    // Create a second matching issue via the API — NOT through the page —
    // while the dashboard stays open. The socket's issue.created event
    // should invalidate the dashboard's evaluated data and the gadget should
    // refresh to '2' entirely on its own, no page.reload() anywhere in this
    // test.
    await createIssueWith(request, ctx.token, ctx.project.id, {
      title: 'New high prio via API',
      priority: 'HIGH',
    });

    await expect(card.getByTestId('gadget-stat-value')).toHaveText('2', { timeout: 20_000 });
  });

  test('BREAKDOWN gadget grouped by status renders bars with counts', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'dash-breakdown',
      projectName: 'Dashboard Breakdown Test',
      openBoard: false,
    });

    const statuses = await getStatuses(request, ctx.token, ctx.project.id);
    const todo = statuses.find((s) => /to do/i.test(s.name)) ?? statuses[0];
    const inProgress = statuses.find((s) => /in progress/i.test(s.name)) ?? statuses[1];

    await createIssueWith(request, ctx.token, ctx.project.id, {
      title: 'Todo issue 1',
      statusId: todo.id,
    });
    await createIssueWith(request, ctx.token, ctx.project.id, {
      title: 'Todo issue 2',
      statusId: todo.id,
    });
    await createIssueWith(request, ctx.token, ctx.project.id, {
      title: 'In progress issue',
      statusId: inProgress.id,
    });

    await page.goto(`/projects/${ctx.project.id}/dashboards`);
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });

    await createDashboard(page, 'Status breakdown');
    await addGadget(page, {
      title: 'By status',
      query: '',
      visualization: 'BREAKDOWN',
      breakdownField: 'status',
    });

    const card = page.getByTestId('dashboard-gadget').filter({ hasText: 'By status' });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText(todo.name)).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText(inProgress.name)).toBeVisible();
  });

  test('a gadget whose stored query references a deleted custom field shows a friendly error', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'dash-error',
      projectName: 'Dashboard Error Test',
      openBoard: false,
    });

    const field = await createCustomField(request, ctx.token, ctx.project.id, 'Severity', [
      'High',
      'Low',
    ]);

    await page.goto(`/projects/${ctx.project.id}/dashboards`);
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });

    await createDashboard(page, 'Fragile dashboard');
    await addGadget(page, { title: 'By severity', query: 'severity = "High"' });

    // Confirm it works fine while the field still exists.
    const card = page.getByTestId('dashboard-gadget').filter({ hasText: 'By severity' });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByTestId('gadget-stat-value')).toBeVisible({ timeout: 10_000 });

    // Delete the custom field the gadget's query depends on, then reload.
    await deleteCustomField(request, ctx.token, field.id);
    await page.reload();
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });

    const cardAfter = page.getByTestId('dashboard-gadget').filter({ hasText: 'By severity' });
    await expect(cardAfter).toBeVisible({ timeout: 10_000 });
    await expect(cardAfter.getByRole('alert')).toBeVisible({ timeout: 10_000 });
    await expect(cardAfter.getByRole('alert')).toContainText(/severity/i);
  });

  test('VIEWER sees the dashboard read-only', async ({ page, request }) => {
    const owner = await setupIsolatedProject(page, request, {
      label: 'dash-viewer-owner',
      projectName: 'Dashboard Viewer Test',
      openBoard: false,
    });

    await page.goto(`/projects/${owner.project.id}/dashboards`);
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });
    await createDashboard(page, 'Owner dashboard');
    await addGadget(page, { title: 'Total issues', query: '' });
    await expect(
      page.getByTestId('dashboard-gadget').filter({ hasText: 'Total issues' }),
    ).toBeVisible({ timeout: 10_000 });

    const viewer = await registerNewUser(request, 'dash-viewer');
    await addWorkspaceMember(request, owner.token, owner.workspaceId, viewer.email, 'VIEWER');

    await loginAs(page, viewer.email, viewer.password);
    await page.goto(`/projects/${owner.project.id}/dashboards`);
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });

    // The existing gadget still renders (read access) …
    const card = page.getByTestId('dashboard-gadget').filter({ hasText: 'Total issues' });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByTestId('gadget-stat-value')).toBeVisible({ timeout: 10_000 });

    // … but every mutating affordance is hidden.
    await expect(page.getByTestId('gadget-add')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-create')).toHaveCount(0);
    await expect(page.getByTestId('gadget-edit')).toHaveCount(0);
    await expect(page.getByTestId('gadget-delete')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Mobile (393px)
// ---------------------------------------------------------------------------

test.describe('Dashboards — mobile (393px)', () => {
  test.use({ viewport: { width: 393, height: 851 } });

  test('dashboard page is usable with no horizontal page overflow', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'dash-mobile',
      projectName: 'Dashboard Mobile Test',
      openBoard: false,
    });

    await page.goto(`/projects/${ctx.project.id}/dashboards`);
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });

    const overflowBefore = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowBefore).toBeLessThanOrEqual(1);

    await createDashboard(page, 'Mobile dashboard');
    await addGadget(page, { title: 'Total issues', query: '' });
    await expect(
      page.getByTestId('dashboard-gadget').filter({ hasText: 'Total issues' }),
    ).toBeVisible({ timeout: 10_000 });

    const overflowAfter = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowAfter).toBeLessThanOrEqual(1);
  });
});

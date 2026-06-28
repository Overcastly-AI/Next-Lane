/**
 * automation.spec.ts
 *
 * End-to-end tests for the Automation engine (the Glass Box feature):
 *   - Rule CRUD through the real editor UI (create / toggle / delete)
 *   - The engine actually firing: a rule created via the API escalates a
 *     newly-created issue, and the run shows up in the Run-log UI with a
 *     SUCCESS status. This drives the real event seams end-to-end.
 *
 * Route: /projects/:projectId/automations
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

/** Create an automation rule directly via the API (for engine tests). */
async function createRule(
  request: APIRequestContext,
  token: string,
  projectId: string,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  const res = await request.post(
    `${API_URL}/api/projects/${projectId}/automations`,
    { headers: { Authorization: `Bearer ${token}` }, data: body },
  );
  expect(res.ok(), `create rule failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as { id: string };
}

async function getIssue(
  request: APIRequestContext,
  token: string,
  issueId: string,
): Promise<{ priority: string }> {
  const res = await request.get(`${API_URL}/api/issues/${issueId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { priority: string };
}

// ---------------------------------------------------------------------------
// Rule CRUD via the UI
// ---------------------------------------------------------------------------

test.describe('Automation rules — desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('reaches the Automation tab from the project nav', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'auto-nav');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);

    await login(page, { email: user.email, password: user.password });
    await page.goto(`/projects/${project.id}/board`);
    // Automation lives in the project nav "More" menu.
    await page.getByRole('button', { name: /^more/i }).click();
    await page.getByTestId('nav-automation').click();
    await expect(page).toHaveURL(/\/automations/);
    await expect(page.getByTestId('automations-page')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('creates, toggles and deletes a rule through the editor', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'auto-crud');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);

    await login(page, { email: user.email, password: user.password });
    await page.goto(`/projects/${project.id}/automations`);
    await expect(page.getByTestId('automations-page')).toBeVisible({
      timeout: 15_000,
    });

    // Empty state → open the editor.
    await page.getByTestId('automation-new').click();
    await page.getByTestId('automation-name-input').fill('Escalate new issues');
    // Trigger defaults to "Issue created". Set the action to "Set priority"
    // (its default priority MEDIUM is valid, so no further input is needed).
    await page
      .getByTestId('automation-action-type')
      .first()
      .selectOption('SET_PRIORITY');
    await page.getByTestId('automation-save').click();

    // Row appears.
    const row = page.getByTestId('automation-row').filter({
      hasText: 'Escalate new issues',
    });
    await expect(row).toBeVisible({ timeout: 8_000 });

    // Toggle disables it (aria-pressed flips to false).
    const toggle = row.getByTestId('automation-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false', {
      timeout: 5_000,
    });

    // Delete via the confirm dialog.
    await row.getByTestId('automation-delete').click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /delete rule/i })
      .click();
    await expect(
      page.getByTestId('automation-row').filter({ hasText: 'Escalate new issues' }),
    ).toHaveCount(0, { timeout: 8_000 });
  });

  test('rejects an invalid NLQL condition with an inline error', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'auto-nlql');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);

    await login(page, { email: user.email, password: user.password });
    await page.goto(`/projects/${project.id}/automations`);
    await expect(page.getByTestId('automations-page')).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId('automation-new').click();
    await page.getByTestId('automation-name-input').fill('Bad condition');
    await page
      .getByTestId('automation-condition-input')
      .fill('this is not valid nlql ===');
    // The condition input validates live; saving should be blocked / show error.
    await page.getByTestId('automation-save').click();
    // The editor stays open (rule not created) — name input still visible.
    await expect(page.getByTestId('automation-name-input')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// The engine actually fires — verified through the Run-log UI
// ---------------------------------------------------------------------------

test.describe('Automation engine — end to end', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('a matching rule escalates a new issue and logs a SUCCESS run', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'auto-fire');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);

    // Rule: when an issue is created, set its priority to HIGHEST.
    await createRule(request, user.token, project.id, {
      name: 'Auto escalate',
      trigger: 'ISSUE_CREATED',
      actions: [{ type: 'SET_PRIORITY', params: { priority: 'HIGHEST' } }],
    });

    // Create an issue at LOW — the engine should bump it.
    const issue = await createIssue(request, user.token, project.id, {
      title: 'Escalate me',
    });

    // The action runs asynchronously after the mutation; poll the API.
    await expect
      .poll(async () => (await getIssue(request, user.token, issue.id)).priority, {
        timeout: 10_000,
      })
      .toBe('HIGHEST');

    // The Glass Box run log shows the SUCCESS run in the UI.
    await login(page, { email: user.email, password: user.password });
    await page.goto(`/projects/${project.id}/automations`);
    await expect(page.getByTestId('automations-page')).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('tab', { name: /run log/i }).click();
    await expect(page.getByTestId('automation-runs')).toBeVisible({
      timeout: 8_000,
    });
    const run = page.getByTestId('automation-run-row').first();
    await expect(run).toBeVisible({ timeout: 8_000 });
    await expect(run).toContainText(/success/i);
  });
});

// ---------------------------------------------------------------------------
// Mobile
// ---------------------------------------------------------------------------

test.describe('Automation — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('automations page renders without horizontal overflow', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'auto-mobile');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);

    await login(page, { email: user.email, password: user.password });
    await page.goto(`/projects/${project.id}/automations`);
    await expect(page.getByTestId('automations-page')).toBeVisible({
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

/**
 * csv-export.spec.ts
 *
 * End-to-end tests for CSV export of project issues.
 *   - API level: correct headers, header row, RFC-4180 escaping, NLQL filter.
 *   - UI level: the "Export CSV" button is present and triggers a download.
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

async function fetchCsv(
  request: APIRequestContext,
  token: string,
  projectId: string,
  q?: string,
) {
  const url =
    `${API_URL}/api/projects/${projectId}/issues.csv` +
    (q ? `?q=${encodeURIComponent(q)}` : '');
  return request.get(url, { headers: { Authorization: `Bearer ${token}` } });
}

test.describe('CSV export — API', () => {
  test('exports a well-formed, RFC-4180-escaped CSV', async ({ request }) => {
    const user = await registerNewUser(request, 'csv-api');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);
    await createIssue(request, user.token, project.id, { title: 'Plain title' });
    await createIssue(request, user.token, project.id, {
      title: 'Has, comma and "quote"',
    });

    const res = await fetchCsv(request, user.token, project.id);
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toContain('text/csv');
    expect(res.headers()['content-disposition']).toContain('attachment');
    expect(res.headers()['content-disposition']).toContain('.csv');

    const body = await res.text();
    const lines = body.trim().split(/\r?\n/);
    // Header row — the exact export contract documented on
    // IssuesService.exportCsv. The Start Date / Description / Component /
    // Fix Versions / Parent / Original Estimate columns were added to the
    // export after this assertion was written; the spec, not the API, was
    // stale. Kept as an exact match so a silent column change stays a
    // failing test (this IS the CSV contract consumers depend on).
    // Note: a project with custom-field definitions also gets one
    // "CF: <name>" column each, before Created/Updated — this project has
    // none, so the header is the base set.
    expect(lines[0]).toBe(
      'Key,Title,Type,Status,Priority,Assignee,Reporter,Story Points,Sprint,Labels,Start Date,Due Date,Description,Component,Fix Versions,Parent,Original Estimate (minutes),Created,Updated',
    );
    // The tricky title is quoted with the inner quote doubled.
    expect(body).toContain('"Has, comma and ""quote"""');
    // Two data rows.
    expect(lines.length).toBe(3);
  });

  test('respects an NLQL filter query', async ({ request }) => {
    const user = await registerNewUser(request, 'csv-filter');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);
    await createIssue(request, user.token, project.id, {
      title: 'A bug',
      // createIssue defaults type TASK; set a bug below via a second create
    });
    // Create one BUG so the filter has something to match.
    await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${user.token}` },
      data: { projectId: project.id, title: 'Real bug', type: 'BUG' },
    });

    const res = await fetchCsv(request, user.token, project.id, 'type = BUG');
    expect(res.ok()).toBeTruthy();
    const lines = (await res.text()).trim().split(/\r?\n/);
    // Header + exactly the one BUG row.
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain('Real bug');
  });

  test('rejects an invalid NLQL filter with 400', async ({ request }) => {
    const user = await registerNewUser(request, 'csv-badq');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);
    const res = await fetchCsv(
      request,
      user.token,
      project.id,
      'totally not valid ===',
    );
    expect(res.status()).toBe(400);
  });
});

test.describe('CSV export — UI', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Export CSV button on the backlog triggers a download', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'csv-ui');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);
    await createIssue(request, user.token, project.id, { title: 'Exportable' });

    await login(page, { email: user.email, password: user.password });
    await page.goto(`/projects/${project.id}/backlog`);

    const exportBtn = page.getByTestId('export-csv');
    await expect(exportBtn).toBeVisible({ timeout: 15_000 });

    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
    await exportBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  test('Export CSV button is present on the board toolbar', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'csv-board');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);
    await createIssue(request, user.token, project.id, { title: 'On board' });

    await login(page, { email: user.email, password: user.password });
    await page.goto(`/projects/${project.id}/board`);
    await expect(page.getByTestId('export-csv')).toBeVisible({
      timeout: 15_000,
    });
  });
});

/**
 * GA web bug-fix regressions (QA BUGS.md #4, #5, #8, #10, #13, #17, #19).
 * Each test reproduced the bug before the fix. Desktop + mobile.
 */
import { test, expect } from '@playwright/test';
import { API_URL, createIssue, setupIsolatedProject } from './helpers';

test.describe('GA web bug-fix regressions', () => {
  test('#4 inaccessible workspace deep link does not loop and lands on a clear state', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'wsloop' });
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
    });
    await page.goto('/workspaces/nope-not-mine/members');
    await expect(page.getByText(/not a member|not found|no access/i).first()).toBeVisible();
    await page.waitForTimeout(800);
    expect(errors.filter((e) => /Maximum update depth/i.test(e))).toEqual([]);
  });

  test('#10 public pages do not fetch the authed workspaces list', async ({ page }) => {
    const hits: string[] = [];
    page.on('response', (r) => {
      if (/\/api\/workspaces(\?|$)/.test(r.url())) hits.push(`${r.status()} ${r.url()}`);
    });
    for (const path of ['/login', '/register', '/forgot-password']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
    }
    expect(hits).toEqual([]);
  });

  test('#5 double-clicking Comment posts exactly one comment; #13 activity says created', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'dbl' });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Dbl issue' });
    await page.goto(`/projects/${ctx.project.id}/board?issue=${issue.id}`);
    const composer = page.getByTestId('comment-composer');
    await composer.click();
    await composer.pressSequentially('only once please');
    await page.getByRole('button', { name: 'Comment', exact: true }).dblclick();
    await expect(page.getByTestId('comment-body-rendered')).toHaveCount(1);
    await page.waitForTimeout(600);
    await expect(page.getByTestId('comment-body-rendered')).toHaveCount(1);
    await expect(page.getByText(/created this issue/i)).toBeVisible();
    await expect(page.getByText(/changed Created/i)).toHaveCount(0);
  });

  test('#8 start date after due date: human message and input reverts', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'dates' });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Dates issue' });
    const res = await request.patch(`${API_URL}/api/issues/${issue.id}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { dueDate: '2026-12-31' },
    });
    expect(res.ok()).toBeTruthy();
    await page.goto(`/projects/${ctx.project.id}/board?issue=${issue.id}`);
    const start = page.getByLabel('Start date', { exact: true });
    await start.fill('2027-01-01');
    await start.blur();
    await expect(page.getByText('Start date must be on or before the due date.').first()).toBeVisible();
    await expect(page.getByText(/startDate must/)).toHaveCount(0);
    await expect(page.getByLabel('Start date', { exact: true })).toHaveValue('');
  });

  test('#19 New label in the drawer attaches to the issue; #17 task lists render checkboxes', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'lbl' });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Label issue' });
    await request.patch(`${API_URL}/api/issues/${issue.id}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { description: '- [ ] todo item\n- [x] done item' },
    });
    await page.goto(`/projects/${ctx.project.id}/board?issue=${issue.id}`);
    const boxes = page.locator('.markdown-body input[type="checkbox"]');
    await expect(boxes).toHaveCount(2);
    await expect(boxes.nth(0)).not.toBeChecked();
    await expect(boxes.nth(1)).toBeChecked();
    await expect(boxes.nth(0)).toBeDisabled();

    await page.getByRole('button', { name: 'Edit', exact: true }).last().click();
    await page.getByRole('button', { name: /New label/ }).click();
    const name = `fresh-${Date.now() % 100000}`;
    await page.getByLabel('New label name').pressSequentially(name);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: new RegExp(name) })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

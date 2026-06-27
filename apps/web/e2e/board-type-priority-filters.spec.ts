/**
 * e2e: Type and Priority filter controls in the board toolbar.
 *
 * Tests that:
 * - Type and Priority filter buttons appear in the board toolbar.
 * - Selecting a type hides issues of other types (AND semantics with other filters).
 * - Selecting a priority hides issues of other priorities.
 * - Combining type + priority filters narrows correctly.
 * - Active filters are visually indicated (button turns brand-coloured).
 * - Clear controls reset the filter.
 * - Works on desktop (1280x800) and mobile (375x812).
 *
 * Uses isolated projects so the shared demo is never polluted.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupIsolatedProject, API_URL } from './helpers';

interface IsolatedCtx {
  token: string;
  projectId: string;
}

/**
 * Seed an isolated project with issues of different types/priorities via
 * the API so the board has something to filter.
 */
async function seedIssues(
  request: APIRequestContext,
  ctx: IsolatedCtx,
): Promise<{ taskTitle: string; bugTitle: string; storyTitle: string; highTitle: string; lowTitle: string }> {
  const stamp = Date.now();
  const taskTitle = `QA Task ${stamp}`;
  const bugTitle = `QA Bug ${stamp}`;
  const storyTitle = `QA Story ${stamp}`;
  const highTitle = `QA High ${stamp}`;
  const lowTitle = `QA Low ${stamp}`;

  async function post(data: Record<string, unknown>) {
    const res = await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { projectId: ctx.projectId, title: 'placeholder', ...data },
    });
    expect(res.ok(), `seed issue failed: ${res.status()}`).toBeTruthy();
  }

  await post({ title: taskTitle, type: 'TASK', priority: 'MEDIUM' });
  await post({ title: bugTitle, type: 'BUG', priority: 'HIGH' });
  await post({ title: storyTitle, type: 'STORY', priority: 'LOW' });
  // Additional issues for combined filter testing.
  await post({ title: highTitle, type: 'TASK', priority: 'HIGH' });
  await post({ title: lowTitle, type: 'BUG', priority: 'LOW' });

  return { taskTitle, bugTitle, storyTitle, highTitle, lowTitle };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openTypeFilter(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /^Type/ }).click();
  const filter = page.getByRole('dialog', { name: 'Filter by type' });
  await expect(filter).toBeVisible();
  return filter;
}

async function openPriorityFilter(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /^Priority/ }).click();
  const filter = page.getByRole('dialog', { name: 'Filter by priority' });
  await expect(filter).toBeVisible();
  return filter;
}

// ---------------------------------------------------------------------------
// Desktop tests (default 1280x800 from playwright config)
// ---------------------------------------------------------------------------

test.describe('Board type + priority filters – desktop', () => {
  test('Type and Priority filter buttons are visible in the toolbar', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'filter-visibility' });
    await expect(page.getByRole('button', { name: /^Type/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Priority/ })).toBeVisible();
  });

  test('Type filter hides issues of non-matching types', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'type-filter',
    });
    const { taskTitle, bugTitle, storyTitle } = await seedIssues(
      request,
      { token: ctx.token, projectId: ctx.project.id },
    );

    // All three issues visible before filtering.
    await expect(page.getByText(taskTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(bugTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(storyTitle).first()).toBeVisible({
      timeout: 10_000,
    });

    // Apply Type = Bug.
    const filter = await openTypeFilter(page);
    await filter.getByRole('menuitemcheckbox', { name: /bug/i }).click();
    await page.keyboard.press('Escape');

    // Only Bug issue is visible; Task and Story are hidden.
    await expect(page.getByText(bugTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(taskTitle)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(storyTitle)).toHaveCount(0, {
      timeout: 10_000,
    });

    // Button should show active state (count badge in label).
    await expect(page.getByRole('button', { name: /Type \(1\)/i })).toBeVisible();
  });

  test('Priority filter hides issues of non-matching priorities', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'priority-filter',
    });
    const { taskTitle, bugTitle } = await seedIssues(request, {
      token: ctx.token,
      projectId: ctx.project.id,
    });

    // Apply Priority = Medium.
    const filter = await openPriorityFilter(page);
    await filter.getByRole('menuitemcheckbox', { name: /medium/i }).click();
    await page.keyboard.press('Escape');

    // Only the TASK (MEDIUM) issue is visible; BUG (HIGH) is hidden.
    await expect(page.getByText(taskTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(bugTitle)).toHaveCount(0, { timeout: 10_000 });

    // Button shows active count.
    await expect(
      page.getByRole('button', { name: /Priority \(1\)/i }),
    ).toBeVisible();
  });

  test('Type + Priority filters combine with AND semantics', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'combined-filter',
    });
    const { taskTitle, bugTitle, storyTitle, highTitle, lowTitle } =
      await seedIssues(request, {
        token: ctx.token,
        projectId: ctx.project.id,
      });

    // Filter: Type=TASK AND Priority=HIGH → only highTitle (TASK+HIGH) matches.
    const typeFilter = await openTypeFilter(page);
    await typeFilter.getByRole('menuitemcheckbox', { name: /^task$/i }).click();
    await page.keyboard.press('Escape');

    const priorityFilter = await openPriorityFilter(page);
    await priorityFilter
      .getByRole('menuitemcheckbox', { name: /^high$/i })
      .click();
    await page.keyboard.press('Escape');

    await expect(page.getByText(highTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(taskTitle)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(bugTitle)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(storyTitle)).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.getByText(lowTitle)).toHaveCount(0, { timeout: 10_000 });
  });

  test('Clearing type filter restores hidden issues', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'clear-filter',
    });
    const { taskTitle, bugTitle } = await seedIssues(request, {
      token: ctx.token,
      projectId: ctx.project.id,
    });

    // Apply Type = Bug filter.
    const filter = await openTypeFilter(page);
    await filter.getByRole('menuitemcheckbox', { name: /bug/i }).click();
    await page.keyboard.press('Escape');

    // BUG visible, TASK hidden.
    await expect(page.getByText(bugTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(taskTitle)).toHaveCount(0, { timeout: 10_000 });

    // Clear the type filter via the "Clear type filter" button in the dropdown.
    const filter2 = await openTypeFilter(page);
    await filter2.getByRole('button', { name: /clear type filter/i }).click();
    await page.keyboard.press('Escape');

    // Both issues visible again.
    await expect(page.getByText(taskTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(bugTitle).first()).toBeVisible({
      timeout: 10_000,
    });

    // Button label is back to plain "Type" (no count).
    await expect(page.getByRole('button', { name: /^Type$/ })).toBeVisible();
  });

  test('Type filter multi-select allows multiple types to pass through', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'multi-type',
    });
    const { taskTitle, bugTitle, storyTitle } = await seedIssues(request, {
      token: ctx.token,
      projectId: ctx.project.id,
    });

    // Select TASK + STORY → both visible, BUG hidden.
    const filter = await openTypeFilter(page);
    await filter.getByRole('menuitemcheckbox', { name: /^task$/i }).click();
    await filter.getByRole('menuitemcheckbox', { name: /^story$/i }).click();
    await page.keyboard.press('Escape');

    await expect(page.getByText(taskTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(storyTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(bugTitle)).toHaveCount(0, { timeout: 10_000 });

    // Count badge shows 2.
    await expect(page.getByRole('button', { name: /Type \(2\)/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Mobile tests (375x812)
// ---------------------------------------------------------------------------

test.describe('Board type + priority filters – mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('Type and Priority filter buttons are accessible on mobile', async ({
    page,
    request,
  }) => {
    await setupIsolatedProject(page, request, { label: 'filter-mobile' });
    await expect(page.getByRole('button', { name: /^Type/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Priority/ })).toBeVisible();
  });

  test('Type filter works on mobile viewport', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'type-mobile',
    });
    const { taskTitle, bugTitle } = await seedIssues(request, {
      token: ctx.token,
      projectId: ctx.project.id,
    });

    // Both issues visible initially.
    await expect(page.getByText(taskTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(bugTitle).first()).toBeVisible({
      timeout: 10_000,
    });

    // Apply Type = Bug filter.
    const filter = await openTypeFilter(page);
    await filter.getByRole('menuitemcheckbox', { name: /bug/i }).click();
    await page.keyboard.press('Escape');

    // Only Bug visible.
    await expect(page.getByText(bugTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(taskTitle)).toHaveCount(0, { timeout: 10_000 });
  });

  test('Priority filter works on mobile viewport', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'priority-mobile',
    });
    const { taskTitle, bugTitle } = await seedIssues(request, {
      token: ctx.token,
      projectId: ctx.project.id,
    });

    // Apply Priority = High.
    const filter = await openPriorityFilter(page);
    await filter.getByRole('menuitemcheckbox', { name: /^high$/i }).click();
    await page.keyboard.press('Escape');

    // Only the BUG (HIGH priority) is visible; TASK (MEDIUM) is hidden.
    await expect(page.getByText(bugTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(taskTitle)).toHaveCount(0, { timeout: 10_000 });
  });
});

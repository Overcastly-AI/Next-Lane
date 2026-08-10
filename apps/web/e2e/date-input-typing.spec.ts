import { test, expect, type Locator, type Page } from '@playwright/test';
import { setupIsolatedProject, API_URL } from './helpers';

/**
 * Regression suite for the "date inputs are impossible to type into" bug.
 *
 * A native `<input type="date">` publishes a `change` event on every keystroke
 * that leaves all three segments filled — so typing the year of 12/25/2031
 * emits FOUR complete-looking dates: 0002-12-25, 0020-12-25, 0203-12-25 and
 * finally 2031-12-25. The drawer's date fields committed straight from
 * `onChange`, which turned each of those into a real PATCH. Two things follow:
 *
 *   1. every intermediate year was persisted, logged to the activity feed, and
 *      run through server validation (an intermediate year of 0002 violates
 *      `startDate <= dueDate`, so the user got error toasts mid-word); and
 *   2. any one of those writes echoing back a value that differs from what is
 *      in the box — a refetch that raced the write, a rejected write leaving
 *      the old value — makes React assign to `input.value`, and assigning to a
 *      focused date input resets ALL of its segments. The year could never be
 *      finished: it came back as 0001-12-25, or the field emptied entirely.
 *      Picking from the calendar worked because it sets every segment at once,
 *      so only one change event ever fires.
 *
 * These tests type SEGMENT BY SEGMENT with real key events. `.fill()` sets the
 * whole value in one shot and cannot catch a per-keystroke bug — the same
 * lesson as input-focus.spec.ts. Note `pressSequentially` does NOT work on
 * date inputs (it inserts text, which the segmented editor ignores), hence the
 * explicit `keyboard.type` loop below.
 */

/** Type a date into a native date input one digit at a time (MMDDYYYY, en-US). */
async function typeDate(page: Page, input: Locator, digits: string) {
  await input.focus();
  for (const ch of digits) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(60);
  }
}

/**
 * Deep-link straight to an issue's drawer. Clicking the card is unreliable
 * here: the drawer's own `?issue=` deep link survives a reload, so the scrim is
 * often already covering the board by the time the click is attempted.
 */
async function openIssue(page: Page, projectId: string, issueId: string) {
  await page.goto(`/projects/${projectId}/board?issue=${issueId}`);
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
}

/** Create an issue through the API and return its id. */
async function seedIssue(
  request: Parameters<typeof setupIsolatedProject>[1],
  token: string,
  projectId: string,
  data: Record<string, unknown>,
): Promise<string> {
  const res = await request.post(`${API_URL}/api/issues`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { projectId, ...data },
  });
  expect(res.ok(), `create issue failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).id as string;
}

test.describe('Date input typing (per-keystroke)', () => {
  test('typing a full due date lands the typed date and writes once', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'datetype' });
    const issueId = await seedIssue(request, ctx.token, ctx.project.id, {
      title: `Type due ${Date.now()}`,
    });
    await openIssue(page, ctx.project.id, issueId);

    // Record every issue PATCH this typing session produces.
    const patches: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PATCH' && /\/api\/issues\//.test(r.url())) {
        patches.push(r.postData() ?? '');
      }
    });

    const due = page.getByLabel('Due date', { exact: true });
    await expect(due).toBeVisible();
    await typeDate(page, due, '12252031');

    // The typed value must survive — the year in particular.
    await expect(due).toHaveValue('2031-12-25');

    // One write, for the date the user actually typed. The intermediate years
    // the browser reported along the way (0002 / 0020 / 0203) are never sent.
    await due.blur();
    await expect
      .poll(() => patches.length, { timeout: 5_000 })
      .toBeGreaterThan(0);
    expect(patches.length, `expected 1 PATCH, got: ${patches.join(' | ')}`).toBe(
      1,
    );
    expect(patches[0]).toContain('2031-12-25');
    for (const body of patches) {
      expect(body, 'a partially typed year was written').not.toMatch(/"0\d{3}-/);
    }

    // And it persisted.
    await openIssue(page, ctx.project.id, issueId);
    await expect(page.getByLabel('Due date', { exact: true })).toHaveValue(
      '2031-12-25',
    );
  });

  test('typing a due date on an issue that already has a start date does not error', async ({
    page,
    request,
  }) => {
    // The intermediate years (0002, 0020, 0203) all fall BEFORE the start date,
    // so a per-keystroke commit fired "startDate must be on or before dueDate"
    // toasts while the user was still typing.
    const ctx = await setupIsolatedProject(page, request, { label: 'dateord' });
    const issueId = await seedIssue(request, ctx.token, ctx.project.id, {
      title: `Type due after start ${Date.now()}`,
      startDate: '2030-01-01',
    });
    await openIssue(page, ctx.project.id, issueId);

    const due = page.getByLabel('Due date', { exact: true });
    await typeDate(page, due, '06152030');
    await expect(due).toHaveValue('2030-06-15');
    await due.blur();

    // No error toast at any point.
    await expect(page.getByText(/must be on or before/i)).toHaveCount(0);
    await expect(page.getByText(/could not save/i)).toHaveCount(0);

    await openIssue(page, ctx.project.id, issueId);
    await expect(page.getByLabel('Due date', { exact: true })).toHaveValue(
      '2030-06-15',
    );
  });

  test('typing a start date keeps focus and the typed year', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'datestart',
    });
    const issueId = await seedIssue(request, ctx.token, ctx.project.id, {
      title: `Type start ${Date.now()}`,
    });
    await openIssue(page, ctx.project.id, issueId);

    const start = page.getByLabel('Start date', { exact: true });
    await typeDate(page, start, '03092029');
    await expect(start).toHaveValue('2029-03-09');
    await expect(start).toBeFocused();

    await start.blur();
    await openIssue(page, ctx.project.id, issueId);
    await expect(page.getByLabel('Start date', { exact: true })).toHaveValue(
      '2029-03-09',
    );
  });

  test('the intermediate years never reach the activity log', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'dateact' });
    const issueId = await seedIssue(request, ctx.token, ctx.project.id, {
      title: `Activity noise ${Date.now()}`,
    });
    await openIssue(page, ctx.project.id, issueId);

    const due = page.getByLabel('Due date', { exact: true });
    await typeDate(page, due, '12252031');
    await due.blur();

    await expect
      .poll(
        async () => {
          const r = await request.get(
            `${API_URL}/api/issues/${issueId}/activity`,
            { headers: { Authorization: `Bearer ${ctx.token}` } },
          );
          const rows = await r.json();
          const list = Array.isArray(rows) ? rows : (rows?.items ?? []);
          return list.filter(
            (a: { field?: string }) => a.field === 'dueDate',
          ).length;
        },
        { timeout: 10_000 },
      )
      .toBe(1);
  });

  test('picking a date from the picker still commits (no regression)', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'datepick' });
    const issueId = await seedIssue(request, ctx.token, ctx.project.id, {
      title: `Pick due ${Date.now()}`,
    });
    await openIssue(page, ctx.project.id, issueId);

    // `.fill()` is the programmatic equivalent of choosing from the picker:
    // every segment set at once, then a single change event. A settled date
    // commits right there, without waiting for blur.
    const due = page.getByLabel('Due date', { exact: true });
    const written = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().includes('/api/issues/'),
    );
    await due.fill('2032-04-18');
    expect((await written).ok()).toBeTruthy();

    await openIssue(page, ctx.project.id, issueId);
    await expect(page.getByLabel('Due date', { exact: true })).toHaveValue(
      '2032-04-18',
    );
  });

  test('clearing a date still works', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'dateclr' });
    const issueId = await seedIssue(request, ctx.token, ctx.project.id, {
      title: `Clear typed ${Date.now()}`,
      dueDate: '2033-05-04',
    });
    await openIssue(page, ctx.project.id, issueId);

    const due = page.getByLabel('Due date', { exact: true });
    await expect(due).toHaveValue('2033-05-04');
    await page.getByRole('button', { name: /clear due date/i }).click();
    await expect(due).toHaveValue('');

    await openIssue(page, ctx.project.id, issueId);
    await expect(page.getByLabel('Due date', { exact: true })).toHaveValue('');
  });

  test('a date typed and then closed with Escape is still saved', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'dateesc' });
    const issueId = await seedIssue(request, ctx.token, ctx.project.id, {
      title: `Escape close ${Date.now()}`,
    });
    await openIssue(page, ctx.project.id, issueId);

    await typeDate(page, page.getByLabel('Due date', { exact: true }), '07042034');
    // Escape unmounts the drawer without ever blurring the input.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await openIssue(page, ctx.project.id, issueId);
    await expect(page.getByLabel('Due date', { exact: true })).toHaveValue(
      '2034-07-04',
    );
  });
});

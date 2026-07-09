import { test, expect } from '@playwright/test';
import { setupIsolatedProject, createIssue, API_URL } from './helpers';

/**
 * issue-linked-pages.spec.ts
 *
 * The tracker↔docs bridge: a knowledge-base page whose body references an
 * issue key (e.g. "NL-123") auto-links to that issue on save; the issue
 * drawer's "Linked pages" section surfaces the reverse edge, and clicking a
 * linked page navigates to it. Runs desktop + mobile.
 */
test.describe('Issue ↔ page cross-linking (Linked pages)', () => {
  test('a page referencing an issue key shows in the issue drawer and navigates', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'linkpages',
      projectName: 'Link Pages QA',
    });
    const headers = { Authorization: `Bearer ${ctx.token}` };

    // An issue to reference, and a page whose body mentions its key.
    const issue = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Ship the thing',
    });
    const pageRes = await request.post(`${API_URL}/api/projects/${ctx.project.id}/pages`, {
      headers,
      data: { title: 'Design Doc', content: `This work is tracked as ${issue.key}.` },
    });
    expect(pageRes.ok()).toBeTruthy();
    const createdPage = await pageRes.json();

    // The backend should have created the PageIssueLink on save.
    const linkedRes = await request.get(`${API_URL}/api/issues/${issue.id}/pages`, { headers });
    expect(linkedRes.ok()).toBeTruthy();
    expect((await linkedRes.json()).items).toEqual([
      { id: createdPage.id, title: 'Design Doc' },
    ]);

    // Open the issue drawer from the board and assert the Linked pages section.
    await page.goto(`/projects/${ctx.project.id}/board`);
    await page.getByText('Ship the thing').first().click();
    const drawer = page.getByRole('dialog').last();
    await expect(drawer).toBeVisible({ timeout: 10_000 });

    const section = drawer.getByTestId('linked-pages-section');
    await expect(section).toBeVisible({ timeout: 10_000 });
    const row = section.getByTestId('linked-page-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Design Doc');

    // Clicking the linked page navigates to it (drawer closes).
    await row.getByRole('button').click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/${ctx.project.id}/pages/${createdPage.id}`),
    );
    await expect(page.getByTestId('page-title')).toHaveText('Design Doc');
  });

  test('an issue with no referencing pages hides the Linked pages section', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'nolinkpages',
      projectName: 'No Link Pages QA',
    });
    await createIssue(request, ctx.token, ctx.project.id, { title: 'Lonely issue' });

    await page.goto(`/projects/${ctx.project.id}/board`);
    await page.getByText('Lonely issue').first().click();
    const drawer = page.getByRole('dialog').last();
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    await expect(drawer.getByTestId('linked-pages-section')).toHaveCount(0);
  });
});

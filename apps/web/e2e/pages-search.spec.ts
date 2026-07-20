import { test, expect } from '@playwright/test';
import { setupIsolatedProject, API_URL } from './helpers';

/**
 * pages-search.spec.ts
 *
 * Full-text search over pages: a page's title/content is findable via the
 * same Cmd-K command palette that already searches issues + projects, under a
 * distinct "Docs" group, and selecting it opens the page. Runs desktop +
 * mobile.
 */
test.describe('Pages full-text search (Cmd-K)', () => {
  test('a page is findable in the command palette and opens on select', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'pgsearch',
      projectName: 'Page Search QA',
    });
    const headers = { Authorization: `Bearer ${ctx.token}` };

    // A page with a distinctive word in the body for FTS to match.
    const uniqueWord = `zebranaut${Date.now().toString(36)}`;
    const pageRes = await request.post(`${API_URL}/api/projects/${ctx.project.id}/pages`, {
      headers,
      data: { title: 'Incident Runbook', content: `Escalation steps for the ${uniqueWord} service.` },
    });
    const created = await pageRes.json();

    await page.goto(`/projects/${ctx.project.id}/board`);
    await page.getByRole('button', { name: /open command palette/i }).first().click();

    const dialog = page.getByRole('dialog', { name: /command palette/i });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Search by the unique body word — proves content (not just title) is indexed.
    await dialog.getByRole('combobox').fill(uniqueWord);

    // The "Docs" group appears with our page.
    await expect(dialog.getByText('Docs', { exact: true })).toBeVisible({ timeout: 10_000 });
    const pageOption = dialog.getByRole('option', { name: /Incident Runbook/ });
    await expect(pageOption).toBeVisible();

    // Selecting it opens the page.
    await pageOption.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${ctx.project.id}/pages/${created.id}`));
    await expect(page.getByTestId('page-title')).toHaveText('Incident Runbook');
  });
});

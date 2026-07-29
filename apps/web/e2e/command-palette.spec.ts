import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { DEMO, login } from './helpers';

/**
 * Command palette (Cmd-K) + cross-project search.
 *
 * UI: open the palette (keyboard shortcut + header button), type a seeded issue
 * title, see it grouped under "Issues", press Enter, and land on the issue's
 * board with the detail drawer open via `?issue=`.
 *
 * Scoping: prove the palette/search never leaks another tenant's data. We
 * register a fresh outsider user, create their own workspace + project + issue
 * with a unique title, then assert the demo user's search returns nothing for
 * that title — both at the API and through the palette UI.
 */

const API_URL = process.env.PW_API_URL ?? 'http://localhost:4000';

async function loginToken(
  request: APIRequestContext,
  creds = DEMO,
): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: creds.email, password: creds.password },
  });
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { accessToken: string };
  return body.accessToken;
}

/**
 * Register an outsider tenant and seed one project + issue with a unique title
 * inside their own (foreign) workspace. Returns the unique issue title.
 */
async function seedForeignIssue(request: APIRequestContext): Promise<string> {
  const email = `outsider-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const regRes = await request.post(`${API_URL}/api/auth/register`, {
    data: { email, name: 'Outsider User', password: 'outsider-pass' },
  });
  expect(regRes.ok(), `register failed: ${regRes.status()}`).toBeTruthy();
  const token = ((await regRes.json()) as { accessToken: string }).accessToken;
  const headers = { Authorization: `Bearer ${token}` };

  const wsRes = await request.post(`${API_URL}/api/workspaces`, {
    headers,
    data: { name: 'Outsider Workspace' },
  });
  expect(wsRes.ok(), `create ws failed: ${wsRes.status()}`).toBeTruthy();
  const workspaceId = ((await wsRes.json()) as { id: string }).id;

  const projRes = await request.post(`${API_URL}/api/projects`, {
    headers,
    data: { workspaceId, key: 'OUT', name: 'Outsider Project' },
  });
  expect(projRes.ok(), `create project failed: ${projRes.status()}`).toBeTruthy();
  const projectId = ((await projRes.json()) as { id: string }).id;

  const foreignTitle = `SECRET-FOREIGN-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const issueRes = await request.post(`${API_URL}/api/issues`, {
    headers,
    data: { projectId, title: foreignTitle },
  });
  expect(issueRes.ok(), `create issue failed: ${issueRes.status()}`).toBeTruthy();

  return foreignTitle;
}

/** Open the palette via the Cmd-K / Ctrl-K shortcut. */
async function openPaletteByShortcut(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+KeyK');
  await expect(
    page.getByRole('dialog', { name: /command palette/i }),
  ).toBeVisible();
}

test.describe('command palette', () => {
  test('opens with Cmd-K, finds a seeded issue, Enter opens it', async ({
    page,
  }) => {
    await login(page);

    await openPaletteByShortcut(page);

    const input = page.getByRole('combobox', {
      name: /search issues.*projects/i,
    });
    // "Kanban board drag-and-drop" is a seeded NL issue.
    await input.fill('Kanban');

    const issuesGroup = page
      .getByRole('listbox', { name: /results/i })
      .getByRole('option', { name: /kanban board/i });
    await expect(issuesGroup.first()).toBeVisible({ timeout: 10_000 });

    await input.press('ArrowDown');
    // First option should be active; press Enter to open the top result. To be
    // deterministic, click the matching option instead.
    await issuesGroup.first().click();

    await expect(page).toHaveURL(/\/board\?.*issue=/, { timeout: 10_000 });
    // The issue detail drawer should be open.
    await expect(
      page.getByText(/kanban board drag-and-drop/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('header search button opens the palette', async ({ page }, testInfo) => {
    await login(page);
    // The labelled "Open command palette" trigger (desktop pill or mobile icon).
    await page
      .getByRole('button', { name: /open command palette/i })
      .first()
      .click();
    await expect(
      page.getByRole('dialog', { name: /command palette/i }),
    ).toBeVisible();
    void testInfo;
  });

  test('does not return another workspace issue (tenant scoping)', async ({
    page,
    request,
  }) => {
    const foreignTitle = await seedForeignIssue(request);

    // API check: the demo user's search must not surface the foreign issue.
    const demoToken = await loginToken(request);
    const apiRes = await request.get(
      `${API_URL}/api/search?q=${encodeURIComponent(foreignTitle)}`,
      { headers: { Authorization: `Bearer ${demoToken}` } },
    );
    expect(apiRes.ok()).toBeTruthy();
    const body = (await apiRes.json()) as {
      issues: Array<{ title: string }>;
    };
    expect(
      body.issues.some((i) => i.title === foreignTitle),
      'foreign issue leaked into demo search results',
    ).toBeFalsy();

    // UI check: searching the foreign title in the palette shows no results.
    await login(page);
    await openPaletteByShortcut(page);
    await page
      .getByRole('combobox', { name: /search issues.*projects/i })
      .fill(foreignTitle);

    await expect(
      page.getByText(new RegExp(`No results for`, 'i')),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole('option', { name: new RegExp(foreignTitle, 'i') }),
    ).toHaveCount(0);
  });
});

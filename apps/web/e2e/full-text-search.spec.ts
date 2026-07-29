import { test, expect, type APIRequestContext } from '@playwright/test';
import { DEMO, login } from './helpers';

/**
 * E2E tests for Postgres full-text search (FTS).
 *
 * Verifies that:
 *  1. A term present only in an issue's *description* (not the title) is
 *     returned by GET /search?q=... — proving the GIN-indexed searchVector
 *     column (which covers both title AND description) is active.
 *  2. The command palette surfaces description-match issues in the UI.
 *  3. GET /issues?projectId=...&q=... (board/backlog search) also uses FTS
 *     and finds description-only matches.
 *  4. Tenant scoping is preserved: a description-only match in a foreign
 *     workspace is never returned to the demo user.
 *  5. Special characters in the query do not cause a 500 error.
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
 * Create a demo-user issue with a unique term only in the description and
 * return { issueId, descriptionTerm, projectId }.
 */
async function createDescriptionIssue(
  request: APIRequestContext,
  token: string,
): Promise<{ issueId: string; descriptionTerm: string; projectId: string }> {
  const headers = { Authorization: `Bearer ${token}` };

  // Fetch the demo user's first project.
  const searchRes = await request.get(`${API_URL}/api/search?q=Kanban`, {
    headers,
  });
  expect(searchRes.ok()).toBeTruthy();
  const searchBody = (await searchRes.json()) as {
    issues: Array<{ projectId: string }>;
  };
  const projectId = searchBody.issues[0].projectId;
  expect(projectId).toBeTruthy();

  // Use a highly unique term that will never appear in any seed data.
  const descriptionTerm = `ftstest-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

  const issueRes = await request.post(`${API_URL}/api/issues`, {
    headers,
    data: {
      projectId,
      title: 'Generic infrastructure maintenance',
      description: `Tracking details about ${descriptionTerm} monitoring setup.`,
      type: 'TASK',
    },
  });
  expect(issueRes.ok(), `create issue: ${issueRes.status()}`).toBeTruthy();
  const issueBody = (await issueRes.json()) as { id: string };

  return { issueId: issueBody.id, descriptionTerm, projectId };
}

test.describe('full-text search — description matches', () => {
  test('GET /search finds an issue when term is only in description', async ({
    request,
  }) => {
    const token = await loginToken(request);
    const { descriptionTerm, issueId } = await createDescriptionIssue(
      request,
      token,
    );

    const res = await request.get(
      `${API_URL}/api/search?q=${encodeURIComponent(descriptionTerm)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      issues: Array<{ id: string; title: string }>;
    };

    const found = body.issues.find((i) => i.id === issueId);
    expect(
      found,
      `Expected issue ${issueId} (description-only match) in results`,
    ).toBeTruthy();
    // Confirm the matching term is NOT in the title (proving FTS covers description).
    expect(found!.title).not.toContain(descriptionTerm);
  });

  test('GET /issues?projectId&q finds an issue when term is only in description', async ({
    request,
  }) => {
    const token = await loginToken(request);
    const { descriptionTerm, issueId, projectId } =
      await createDescriptionIssue(request, token);

    const res = await request.get(
      `${API_URL}/api/issues?projectId=${projectId}&q=${encodeURIComponent(descriptionTerm)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      items: Array<{ id: string; title: string }>;
    };

    const found = body.items.find((i) => i.id === issueId);
    expect(
      found,
      `Expected issue ${issueId} (description-only match) in /issues results`,
    ).toBeTruthy();
    expect(found!.title).not.toContain(descriptionTerm);
  });

  test('description match is surfaced in the command palette UI', async ({
    page,
    request,
  }) => {
    const token = await loginToken(request);
    const { descriptionTerm } = await createDescriptionIssue(request, token);

    await login(page);

    // Open command palette via keyboard shortcut.
    await page.keyboard.press('ControlOrMeta+KeyK');
    await expect(
      page.getByRole('dialog', { name: /command palette/i }),
    ).toBeVisible();

    // Type the description-only term.
    const input = page.getByRole('combobox', {
      name: /search issues.*projects/i,
    });
    await input.fill(descriptionTerm.substring(0, 40)); // palette char limit may apply

    // Expect at least one issue result (the description match).
    const results = page.getByRole('listbox', { name: /results/i });
    await expect(results).toBeVisible({ timeout: 10_000 });
    // We should see the title of the matching issue (not the unique term itself,
    // which is in the description, not the title).
    await expect(
      page.getByRole('option', {
        name: /Generic infrastructure maintenance/i,
      }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('tenant scoping: description match in foreign workspace is NOT returned', async ({
    request,
  }) => {
    // Register a foreign user, seed an issue with a unique description term.
    const foreignEmail = `fts-outsider-${Date.now()}@example.com`;
    const regRes = await request.post(`${API_URL}/api/auth/register`, {
      data: { email: foreignEmail, name: 'FTS Outsider', password: 'outsider123' },
    });
    expect(regRes.ok()).toBeTruthy();
    const foreignToken = ((await regRes.json()) as { accessToken: string })
      .accessToken;
    const foreignHeaders = { Authorization: `Bearer ${foreignToken}` };

    const wsRes = await request.post(`${API_URL}/api/workspaces`, {
      headers: foreignHeaders,
      data: { name: 'FTS Outsider WS' },
    });
    expect(wsRes.ok()).toBeTruthy();
    const wsId = ((await wsRes.json()) as { id: string }).id;

    const projRes = await request.post(`${API_URL}/api/projects`, {
      headers: foreignHeaders,
      data: { workspaceId: wsId, key: 'FTSX', name: 'FTS Outsider Project' },
    });
    expect(projRes.ok()).toBeTruthy();
    const foreignProjectId = ((await projRes.json()) as { id: string }).id;

    const secretTerm = `secretdescterm-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const issueRes = await request.post(`${API_URL}/api/issues`, {
      headers: foreignHeaders,
      data: {
        projectId: foreignProjectId,
        title: 'Foreign issue title',
        description: `This description contains ${secretTerm} as a unique term.`,
        type: 'TASK',
      },
    });
    expect(issueRes.ok()).toBeTruthy();

    // Now the demo user searches for the secret term — should NOT appear.
    const demoToken = await loginToken(request);
    const res = await request.get(
      `${API_URL}/api/search?q=${encodeURIComponent(secretTerm)}`,
      { headers: { Authorization: `Bearer ${demoToken}` } },
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { issues: Array<{ title: string }> };

    expect(
      body.issues.some((i) => i.title === 'Foreign issue title'),
      'foreign issue description leaked via FTS into demo search',
    ).toBeFalsy();
  });

  test('special characters in q do not cause a 500 error', async ({
    request,
  }) => {
    const token = await loginToken(request);
    const specialQueries = [
      'bug & (fix OR patch)',
      '"exact phrase"',
      '-negated term',
      'colon:search',
      'a!@#$%^',
    ];

    for (const q of specialQueries) {
      const res = await request.get(
        `${API_URL}/api/search?q=${encodeURIComponent(q)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(
        res.ok(),
        `Expected 200 for special query "${q}" but got ${res.status()}`,
      ).toBeTruthy();
    }
  });
});

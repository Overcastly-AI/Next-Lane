import { test, expect, type APIRequestContext } from '@playwright/test';
import { login, DEMO, gotoSection } from './helpers';

/**
 * "My Work" personal dashboard.
 *
 * Functional: the demo user logs in, opens My Work from the header, sees an
 * issue assigned to them (the seed assigns issues to demo), and clicking it
 * opens that issue's board with the drawer (?issue=).
 *
 * Scoping: we provision a SEPARATE tenant (own user, workspace, project, issue
 * assigned to & reported by that user) entirely via the API, then assert that
 * the foreign issue never appears on the demo user's My Work page — proving the
 * /me/work endpoint is membership-scoped and does not leak across tenants.
 */

const API_URL = process.env.PW_API_URL ?? 'http://localhost:4000';

const FOREIGN_TITLE = `Foreign tenant secret ${Date.now()}`;

/** Provision an isolated tenant with one issue. Returns the foreign issue title. */
async function provisionForeignTenant(
  request: APIRequestContext,
): Promise<string> {
  const email = `tenant.${Date.now()}@example.com`;
  const reg = await request.post(`${API_URL}/api/auth/register`, {
    data: { email, name: 'Foreign Tenant', password: 'foreignpass' },
  });
  expect(reg.ok(), `register failed: ${reg.status()}`).toBeTruthy();
  const { accessToken, user } = (await reg.json()) as {
    accessToken: string;
    user: { id: string };
  };
  const headers = { Authorization: `Bearer ${accessToken}` };

  const wsRes = await request.post(`${API_URL}/api/workspaces`, {
    headers,
    data: { name: `Foreign WS ${Date.now()}` },
  });
  expect(wsRes.ok(), `create ws failed: ${wsRes.status()}`).toBeTruthy();
  const ws = (await wsRes.json()) as { id: string };

  const projRes = await request.post(`${API_URL}/api/projects`, {
    headers,
    data: {
      workspaceId: ws.id,
      key: `FT${Math.floor(Math.random() * 9000 + 1000)}`,
      name: 'Foreign Project',
    },
  });
  expect(projRes.ok(), `create project failed: ${projRes.status()}`).toBeTruthy();
  const project = (await projRes.json()) as { id: string };

  // Assigned to AND reported by the foreign user — would surface in either group
  // of the demo user's My Work if scoping were broken.
  const issueRes = await request.post(`${API_URL}/api/issues`, {
    headers,
    data: { projectId: project.id, title: FOREIGN_TITLE, assigneeId: user.id },
  });
  expect(issueRes.ok(), `create issue failed: ${issueRes.status()}`).toBeTruthy();

  return FOREIGN_TITLE;
}

test.describe('My Work', () => {
  test('shows the demo user their assigned issue and opens it; hides other tenants', async ({
    page,
    request,
  }) => {
    const foreignTitle = await provisionForeignTenant(request);

    await login(page, DEMO);

    // Reach My Work from the header (desktop link) or user menu (mobile).
    await gotoSection(page, /my work/i);
    await expect(page).toHaveURL(/\/my-work/);
    await expect(
      page.getByRole('heading', { name: /^my work$/i }),
    ).toBeVisible();

    // The "Assigned to me" section is present.
    await expect(page.getByText(/assigned to me/i)).toBeVisible();

    // A seeded issue assigned to demo. The seed assigns these to the demo user.
    const assignedIssue = page
      .getByRole('button', { name: /Set up Docker Compose stack/i })
      .first();
    await expect(assignedIssue).toBeVisible({ timeout: 15_000 });

    // Scoping: the foreign tenant's issue must NOT appear anywhere on the page.
    await expect(page.getByText(foreignTitle)).toHaveCount(0);

    // Clicking the row opens that issue on its board with the drawer (?issue=).
    await assignedIssue.click();
    await expect(page).toHaveURL(/\/projects\/[^/]+\/board\?issue=/, {
      timeout: 15_000,
    });
  });
});

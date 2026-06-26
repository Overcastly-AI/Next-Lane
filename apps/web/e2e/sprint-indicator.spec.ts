import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { DEMO, login } from './helpers';

/**
 * ITEM B — Board + backlog sprint indicator & dates.
 *
 * Surfaces sprint context the data already had:
 *  - BoardPage shows a badge for the active sprint (name + "active" + a relative
 *    end-date countdown).
 *  - Backlog sprint sections render each sprint's start–end dates and an
 *    end-date warning when the active sprint is overdue / near.
 *
 * Builds a fresh project with one active sprint (dated near the end) and one
 * planned sprint via the API, then asserts the rendered UI. API on :4000.
 */

const API_URL = process.env.PW_API_URL ?? 'http://localhost:4000';

async function loginToken(
  request: APIRequestContext,
  creds: { email: string; password: string },
): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: creds.email, password: creds.password },
  });
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { accessToken: string }).accessToken;
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

interface Fixture {
  projectId: string;
  activeSprintName: string;
  plannedSprintName: string;
}

async function seed(request: APIRequestContext): Promise<Fixture> {
  const token = await loginToken(request, DEMO);
  const headers = { Authorization: `Bearer ${token}` };

  const wsRes = await request.post(`${API_URL}/api/workspaces`, {
    headers,
    data: { name: `Sprint Indicator ${Date.now()}` },
  });
  expect(wsRes.ok()).toBeTruthy();
  const workspaceId = ((await wsRes.json()) as { id: string }).id;

  const projRes = await request.post(`${API_URL}/api/projects`, {
    headers,
    data: {
      workspaceId,
      key: `SI${Math.floor(Math.random() * 9000 + 1000)}`,
      name: 'Sprint Indicator Project',
    },
  });
  expect(projRes.ok()).toBeTruthy();
  const projectId = ((await projRes.json()) as { id: string }).id;

  const stamp = Date.now();
  const activeSprintName = `Sprint Active ${stamp}`;
  const plannedSprintName = `Sprint Planned ${stamp}`;

  // Active sprint ending in 1 day -> "soon"/amber warning on backlog + badge.
  const aRes = await request.post(
    `${API_URL}/api/projects/${projectId}/sprints`,
    {
      headers,
      data: {
        name: activeSprintName,
        startDate: isoDaysFromNow(-3),
        endDate: isoDaysFromNow(1),
      },
    },
  );
  expect(aRes.ok()).toBeTruthy();
  const activeSprintId = ((await aRes.json()) as { id: string }).id;

  // Activate it.
  const start = await request.patch(
    `${API_URL}/api/sprints/${activeSprintId}`,
    { headers, data: { state: 'ACTIVE' } },
  );
  expect(start.ok(), `start sprint failed: ${start.status()}`).toBeTruthy();

  // A planned sprint with dates further out (control: no warning).
  const pRes = await request.post(
    `${API_URL}/api/projects/${projectId}/sprints`,
    {
      headers,
      data: {
        name: plannedSprintName,
        startDate: isoDaysFromNow(7),
        endDate: isoDaysFromNow(21),
      },
    },
  );
  expect(pRes.ok()).toBeTruthy();

  return { projectId, activeSprintName, plannedSprintName };
}

async function gotoBoard(page: Page, projectId: string): Promise<void> {
  await page.goto(`/projects/${projectId}/board`);
  await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });
}

test.describe('sprint indicator & dates', () => {
  test('board shows the active sprint badge with a countdown', async ({
    page,
    request,
  }) => {
    const f = await seed(request);
    await login(page, DEMO);
    await gotoBoard(page, f.projectId);

    const badge = page.getByTestId('active-sprint-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(f.activeSprintName);
    await expect(badge).toContainText(/active/i);
    await expect(badge).toContainText(/ends|overdue|today/i);
  });

  test('backlog shows sprint dates and an end-date warning for the active sprint', async ({
    page,
    request,
  }) => {
    const f = await seed(request);
    await login(page, DEMO);
    await page.goto(`/projects/${f.projectId}/backlog`);
    await expect(
      page.getByRole('heading', { level: 1, name: /backlog/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Both sprints render a date range.
    const dateRanges = page.getByTestId('sprint-dates');
    await expect(dateRanges.first()).toBeVisible();
    expect(await dateRanges.count()).toBeGreaterThanOrEqual(2);

    // The active sprint (ends in 1 day) shows an end-date warning chip.
    const warning = page.getByTestId('sprint-end-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(/ends in 1d|ends today|overdue/i);
  });
});

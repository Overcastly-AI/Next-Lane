import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_URL, setupIsolatedProject } from './helpers';

/**
 * Roadmap timeline coverage against an ISOLATED project (never the shared demo).
 * Seeds — via the API — a dated sprint, an epic, and two child issues parented
 * to the epic and attached to the sprint (one moved to a DONE status). Then
 * opens the Roadmap tab and asserts:
 *  - the Roadmap tab is reachable from ProjectNav,
 *  - the dated sprint renders as a bar,
 *  - the epic renders as a row,
 *  - clicking the epic navigates to the board with the issue drawer (?issue=).
 *
 * Runs on desktop + mobile; each spec gets its own tenant so writes are safe.
 */
function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function getDoneStatusId(
  request: APIRequestContext,
  token: string,
  projectId: string,
): Promise<string> {
  const res = await request.get(
    `${API_URL}/api/projects/${projectId}/statuses`,
    { headers: auth(token) },
  );
  expect(res.ok(), `list statuses failed: ${res.status()}`).toBeTruthy();
  const statuses = (await res.json()) as {
    id: string;
    category: string;
  }[];
  const done = statuses.find((s) => s.category === 'DONE');
  expect(done, 'project has no DONE status').toBeTruthy();
  return (done as { id: string }).id;
}

async function createSprint(
  request: APIRequestContext,
  token: string,
  projectId: string,
): Promise<string> {
  const res = await request.post(
    `${API_URL}/api/projects/${projectId}/sprints`,
    {
      headers: auth(token),
      data: {
        name: 'Roadmap Sprint A',
        startDate: '2026-02-02T00:00:00.000Z',
        endDate: '2026-02-16T00:00:00.000Z',
      },
    },
  );
  expect(res.ok(), `create sprint failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

async function createIssue(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<{ id: string; key: string }> {
  const res = await request.post(`${API_URL}/api/issues`, {
    headers: auth(token),
    data,
  });
  expect(res.ok(), `create issue failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as { id: string; key: string };
}

test.describe('Roadmap', () => {
  test('renders the sprint bar and epic row, and an epic opens on the board', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'roadmap',
      projectName: 'Roadmap QA',
    });

    const doneStatusId = await getDoneStatusId(request, token, project.id);
    const sprintId = await createSprint(request, token, project.id);

    // Epic + two children in the sprint; one child is DONE → 50% progress.
    const epic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Stakeholder Epic',
    });
    await createIssue(request, token, {
      projectId: project.id,
      title: 'Child done',
      parentId: epic.id,
      sprintId,
      statusId: doneStatusId,
    });
    await createIssue(request, token, {
      projectId: project.id,
      title: 'Child open',
      parentId: epic.id,
      sprintId,
    });

    // Open the Roadmap tab from ProjectNav — it lives in the "More" menu.
    await page.goto(`/projects/${project.id}/board`);
    await page.getByRole('button', { name: /^more/i }).click();
    await page.getByRole('menuitem', { name: 'Roadmap' }).click();
    await expect(page).toHaveURL(/\/roadmap$/, { timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: 'Roadmap', level: 1 }),
    ).toBeVisible();

    // Sprint bar renders with the sprint name.
    const sprintBar = page.getByTestId('roadmap-sprint-bar').first();
    await expect(sprintBar).toBeVisible({ timeout: 15_000 });
    await expect(sprintBar).toContainText('Roadmap Sprint A');

    // Epic row renders with the epic title and a progress percentage.
    const epicBar = page.getByTestId('roadmap-epic-bar').first();
    await expect(epicBar).toBeVisible();
    await expect(epicBar).toContainText('Stakeholder Epic');

    // Clicking the epic opens it on the board (?issue=).
    await epicBar.click();
    await expect(page).toHaveURL(
      new RegExp(`/board\\?issue=${epic.id}`),
      { timeout: 15_000 },
    );
  });

  test('epic bar uses the epic\'s own startDate/dueDate range in preference to child sprint dates', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'roadmap-owndates',
      projectName: 'Roadmap Own Dates QA',
    });

    const sprintId = await createSprint(request, token, project.id);

    // The epic's OWN dates are far outside the sprint's window — if the
    // roadmap correctly prioritizes them, the derived range must match the
    // epic's dates, not the sprint's (2026-02-02 → 2026-02-16).
    const epic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Self-planned epic',
      startDate: '2026-09-01T00:00:00.000Z',
      dueDate: '2026-09-30T00:00:00.000Z',
    });
    await createIssue(request, token, {
      projectId: project.id,
      title: 'Child in sprint',
      parentId: epic.id,
      sprintId,
    });

    // Verify the API-level derivation directly (the authoritative source the
    // timeline component renders from — see RoadmapTimeline.tsx).
    const roadmapRes = await request.get(
      `${API_URL}/api/projects/${project.id}/roadmap`,
      { headers: auth(token) },
    );
    expect(roadmapRes.ok(), `get roadmap failed: ${roadmapRes.status()}`).toBeTruthy();
    const roadmap = (await roadmapRes.json()) as {
      epics: { id: string; start: string | null; end: string | null; fromOwnDates: boolean }[];
    };
    const epicEntry = roadmap.epics.find((e) => e.id === epic.id);
    expect(epicEntry?.fromOwnDates).toBe(true);
    expect(epicEntry?.start).toBe('2026-09-01T00:00:00.000Z');
    expect(epicEntry?.end).toBe('2026-09-30T00:00:00.000Z');

    // And confirm the bar actually renders on the timeline for this epic.
    await page.goto(`/projects/${project.id}/board`);
    await page.getByRole('button', { name: /^more/i }).click();
    await page.getByRole('menuitem', { name: 'Roadmap' }).click();
    await expect(page).toHaveURL(/\/roadmap$/, { timeout: 15_000 });

    const epicBar = page.getByTestId('roadmap-epic-bar').first();
    await expect(epicBar).toBeVisible({ timeout: 15_000 });
    await expect(epicBar).toContainText('Self-planned epic');
  });
});

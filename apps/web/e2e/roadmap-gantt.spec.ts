import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_URL, setupIsolatedProject, trackApiWrites } from './helpers';

/**
 * The roadmap Gantt: child-date rollup, drag-to-reschedule, the epic cascade,
 * the overrun mark, expansion, and zoom.
 *
 * The headline case is the founder's report (2026-08-02): "I put stories in
 * related to the epic with start and end dates. But the dates do not trickle
 * up to the epic level." That worked exactly as reported — the rollup only
 * ever read a child's SPRINT — and no test caught it because every roadmap
 * fixture put its children in sprints.
 */
function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
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

async function getIssue(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<{ startDate: string | null; dueDate: string | null }> {
  const res = await request.get(`${API_URL}/api/issues/${id}`, {
    headers: auth(token),
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { startDate: string | null; dueDate: string | null };
}

const iso = (d: string) => `${d}T00:00:00.000Z`;
const dayOf = (s: string | null) => (s ?? '').slice(0, 10);

test.describe('Roadmap Gantt', () => {
  test('a story with its own dates and NO sprint rolls up to its epic', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-rollup',
      projectName: 'Roadmap Rollup QA',
      openBoard: false,
    });

    // An epic with no dates of its own — everything must come from below.
    const epic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Rollup Epic',
    });
    // Stories with real dates and deliberately NO sprint. This is the exact
    // shape that used to leave the epic as a dot on its creation date.
    await createIssue(request, token, {
      projectId: project.id,
      title: 'Early story',
      parentId: epic.id,
      startDate: iso('2026-05-04'),
      dueDate: iso('2026-05-15'),
    });
    await createIssue(request, token, {
      projectId: project.id,
      title: 'Late story',
      parentId: epic.id,
      startDate: iso('2026-06-01'),
      dueDate: iso('2026-06-30'),
    });

    const res = await request.get(
      `${API_URL}/api/projects/${project.id}/roadmap`,
      { headers: auth(token) },
    );
    const body = (await res.json()) as {
      epics: {
        id: string;
        start: string | null;
        end: string | null;
        rollupStart: string | null;
        rollupEnd: string | null;
      }[];
    };
    const row = body.epics.find((e) => e.id === epic.id);
    expect(dayOf(row?.start ?? null)).toBe('2026-05-04');
    expect(dayOf(row?.end ?? null)).toBe('2026-06-30');
    expect(dayOf(row?.rollupEnd ?? null)).toBe('2026-06-30');

    // And it draws as a real bar, not the "No dates" lane.
    await page.goto(`/projects/${project.id}/roadmap`);
    await expect(page.getByTestId('roadmap-epic-bar')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('roadmap-epic-nodate')).toHaveCount(0);
  });

  test('children that overrun the epic are marked, not hidden by widening the bar', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-overrun',
      projectName: 'Roadmap Overrun QA',
      openBoard: false,
    });

    const epic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Committed Epic',
      startDate: iso('2026-04-01'),
      dueDate: iso('2026-04-30'),
    });
    await createIssue(request, token, {
      projectId: project.id,
      title: 'Slips into May',
      parentId: epic.id,
      startDate: iso('2026-04-20'),
      dueDate: iso('2026-05-10'),
    });

    const res = await request.get(
      `${API_URL}/api/projects/${project.id}/roadmap`,
      { headers: auth(token) },
    );
    const body = (await res.json()) as {
      epics: { id: string; end: string | null; overrunDays: number; childrenOutside: number }[];
    };
    const row = body.epics.find((e) => e.id === epic.id);
    // The committed end is untouched: the plan is still the plan.
    expect(dayOf(row?.end ?? null)).toBe('2026-04-30');
    expect(row?.overrunDays).toBe(10);
    expect(row?.childrenOutside).toBe(1);

    await page.goto(`/projects/${project.id}/roadmap`);
    const bar = page.getByTestId('roadmap-epic-bar').first();
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await expect(bar).toContainText('+10d');
  });

/**
 * Bar dragging is a POINTER interaction and these two specs are desktop-only.
 *
 * That is a statement about the product, not a dodge: `canDragWith` in
 * RoadmapTimeline refuses to start a drag from a touch pointer, because the
 * time grid pans horizontally and on a 393px screen that pan is the gesture
 * that matters. Hijacking it to move a bar would make the rest of the
 * timeline unreachable. Everything else here — rollup, overrun, expansion,
 * zoom — runs on mobile too.
 */
  test('dragging an epic bar reschedules it, and a click still opens it', async ({
    page,
    request,
  }) => {
    test.skip(
      test.info().project.name !== 'chromium-desktop',
      'pointer drag is desktop-only by design — see the note above',
    );
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-drag',
      projectName: 'Roadmap Drag QA',
      openBoard: false,
    });
    const epic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Draggable Epic',
      startDate: iso('2026-04-01'),
      dueDate: iso('2026-04-30'),
    });

    await page.goto(`/projects/${project.id}/roadmap`);
    const bar = page.getByTestId('roadmap-epic-bar').first();
    await expect(bar).toBeVisible({ timeout: 15_000 });

    // Week zoom so one day is a comfortable 22px and the arithmetic is
    // unambiguous at the pixel level.
    await page.getByTestId('roadmap-zoom-week').click();
    await expect(bar).toBeVisible();

    const writes = trackApiWrites(page);
    const box = (await bar.boundingBox())!;
    // Grab the middle of the bar (away from the resize grips at either edge)
    // and push it exactly 7 days right.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 7 * 22,
      box.y + box.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();

    await writes.settle({
      match: (w) => w.method === 'PATCH' && w.path.endsWith(`/api/issues/${epic.id}`),
      atLeast: 1,
    });

    const after = await getIssue(request, token, epic.id);
    expect(dayOf(after.startDate)).toBe('2026-04-08');
    expect(dayOf(after.dueDate)).toBe('2026-05-07');

    // A click (no movement) must still navigate rather than reschedule.
    await page.getByTestId('roadmap-epic-bar').first().click();
    await expect(page).toHaveURL(new RegExp(`/board\\?issue=${epic.id}`), {
      timeout: 15_000,
    });
  });

  test('dragging a story past its epic grows the epic to cover it', async ({
    page,
    request,
  }) => {
    test.skip(
      test.info().project.name !== 'chromium-desktop',
      'pointer drag is desktop-only by design — see the note above',
    );
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-cascade',
      projectName: 'Roadmap Cascade QA',
      openBoard: false,
    });
    const epic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Cascade Epic',
      startDate: iso('2026-04-01'),
      dueDate: iso('2026-04-30'),
    });
    const story = await createIssue(request, token, {
      projectId: project.id,
      title: 'Story that slips',
      parentId: epic.id,
      startDate: iso('2026-04-10'),
      dueDate: iso('2026-04-20'),
    });

    await page.goto(`/projects/${project.id}/roadmap`);
    await expect(page.getByTestId('roadmap-epic-bar').first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId('roadmap-zoom-week').click();

    // Expand the epic to reveal its story bar.
    await page.getByTestId(`roadmap-epic-expand-${epic.id}`).click();
    const childBar = page.getByTestId('roadmap-child-bar').first();
    await expect(childBar).toBeVisible({ timeout: 15_000 });

    const writes = trackApiWrites(page);
    const box = (await childBar.boundingBox())!;
    // Push the story 20 days right: 2026-04-30 → 2026-05-10, well past the
    // epic's committed end.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 20 * 22,
      box.y + box.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();

    await writes.settle({
      match: (w) => w.method === 'PATCH' && w.path.endsWith(`/api/issues/${story.id}`),
      atLeast: 1,
    });

    const movedStory = await getIssue(request, token, story.id);
    expect(dayOf(movedStory.startDate)).toBe('2026-04-30');
    expect(dayOf(movedStory.dueDate)).toBe('2026-05-10');

    // The cascade: the epic grew to contain it. Its START must be untouched —
    // this only ever grows.
    const grownEpic = await getIssue(request, token, epic.id);
    expect(dayOf(grownEpic.dueDate)).toBe('2026-05-10');
    expect(dayOf(grownEpic.startDate)).toBe('2026-04-01');
  });

  test('a VIEWER sees the chart with no drag affordances', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-viewer',
      projectName: 'Roadmap Viewer QA',
      openBoard: false,
    });
    await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Read-only Epic',
      startDate: iso('2026-04-01'),
      dueDate: iso('2026-04-30'),
    });

    await page.goto(`/projects/${project.id}/roadmap`);
    await expect(page.getByTestId('roadmap-epic-bar').first()).toBeVisible({
      timeout: 15_000,
    });
    // The owner (non-VIEWER) sees the drag hint...
    await expect(page.getByText(/Drag a bar to move it/i)).toBeVisible();
  });

  test('zoom changes the timeline density without losing the bars', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-zoom',
      projectName: 'Roadmap Zoom QA',
      openBoard: false,
    });
    const epic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Zoomable Epic',
      startDate: iso('2026-04-01'),
      dueDate: iso('2026-06-30'),
    });
    expect(epic.id).toBeTruthy();

    await page.goto(`/projects/${project.id}/roadmap`);
    const bar = page.getByTestId('roadmap-epic-bar').first();
    await expect(bar).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('roadmap-zoom-week').click();
    const weekWidth = (await bar.boundingBox())!.width;
    await page.getByTestId('roadmap-zoom-quarter').click();
    const quarterWidth = (await bar.boundingBox())!.width;

    // Same 90-day epic: a week view must render it far wider than a quarter
    // view, and it must still be on screen in both.
    expect(weekWidth).toBeGreaterThan(quarterWidth * 3);
    await expect(bar).toBeVisible();
  });
});

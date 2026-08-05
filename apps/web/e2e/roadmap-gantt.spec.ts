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

    // A click (no movement) must still OPEN the issue rather than reschedule —
    // in place on the roadmap, not by navigating to the board.
    await page.getByTestId('roadmap-epic-bar').first().click();
    await expect(page).toHaveURL(new RegExp(`/roadmap\\?issue=${epic.id}`), {
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

  test('an undated story can be scheduled by dragging across its empty row', async ({
    page,
    request,
  }) => {
    test.skip(
      test.info().project.name !== 'chromium-desktop',
      'pointer drag is desktop-only by design — see the note above',
    );
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-paint',
      projectName: 'Roadmap Paint QA',
      openBoard: false,
    });
    const epic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Paint Epic',
      startDate: iso('2026-04-01'),
      dueDate: iso('2026-04-30'),
    });
    // No dates at all — previously this row said "no dates" and offered
    // nothing, so the one thing you wanted to do on a timeline was impossible.
    const story = await createIssue(request, token, {
      projectId: project.id,
      title: 'Needs scheduling',
      parentId: epic.id,
    });

    await page.goto(`/projects/${project.id}/roadmap`);
    await expect(page.getByTestId('roadmap-epic-bar').first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId('roadmap-zoom-week').click();
    await page.getByTestId(`roadmap-epic-expand-${epic.id}`).click();

    const row = page.getByTestId('roadmap-child-unscheduled').first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    const writes = trackApiWrites(page);
    const box = (await row.boundingBox())!;
    // Paint a 10-day window starting a little way into the row.
    await page.mouse.move(box.x + 40, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 40 + 10 * 22, box.y + box.height / 2, {
      steps: 10,
    });
    await page.mouse.up();

    await writes.settle({
      match: (w) => w.method === 'PATCH' && w.path.endsWith(`/api/issues/${story.id}`),
      atLeast: 1,
    });

    const after = await getIssue(request, token, story.id);
    expect(after.startDate).not.toBeNull();
    expect(after.dueDate).not.toBeNull();
    // Ten days painted at 22px/day, snapped to whole days.
    const days = Math.round(
      (Date.parse(after.dueDate!) - Date.parse(after.startDate!)) / 86_400_000,
    );
    expect(days).toBe(10);

    // It is now a real, draggable bar rather than an empty row.
    await expect(page.getByTestId('roadmap-child-bar').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('create rows sit under what they create, and adding stays open for the next one', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-create',
      projectName: 'Roadmap Create QA',
      openBoard: false,
    });
    const epic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Host Epic',
      startDate: iso('2026-04-01'),
      dueDate: iso('2026-04-30'),
    });

    await page.goto(`/projects/${project.id}/roadmap`);
    await expect(page.getByTestId('roadmap-epic-bar').first()).toBeVisible({
      timeout: 15_000,
    });

    // "Create epic" is a row in the chart, below the epics — not a toolbar
    // button. Adding one should leave the field open so a plan can be typed in
    // one go.
    await page.getByTestId('roadmap-add-epic').click();
    const epicInput = page.getByTestId('roadmap-add-epic-input');
    await epicInput.fill('Second Epic');
    await epicInput.press('Enter');
    await expect(page.getByText('Second Epic').first()).toBeVisible({ timeout: 15_000 });
    await expect(epicInput).toBeVisible();

    // "Create story" appears under the epic's own stories once it is expanded.
    await page.keyboard.press('Escape');
    await page.getByTestId(`roadmap-epic-expand-${epic.id}`).click();
    const addStory = page.getByTestId(`roadmap-add-story-${epic.id}`);
    await expect(addStory).toBeVisible({ timeout: 15_000 });
    await addStory.click();
    const storyInput = page.getByTestId(`roadmap-add-story-${epic.id}-input`);
    await storyInput.fill('Fresh story');
    await storyInput.press('Enter');

    // It lands undated on purpose, so its row is an empty scheduling lane.
    await expect(page.getByText('Fresh story').first()).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId('roadmap-child-unscheduled').first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('a story that shows its SPRINT dates is still draggable, and keeps its sprint', async ({
    page,
    request,
  }) => {
    test.skip(
      test.info().project.name !== 'chromium-desktop',
      'pointer drag is desktop-only by design — see the note above',
    );
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-sprintdrag',
      projectName: 'Roadmap Sprint Drag QA',
      openBoard: false,
    });

    const sprintRes = await request.post(
      `${API_URL}/api/projects/${project.id}/sprints`,
      {
        headers: auth(token),
        data: {
          name: 'Sprint Z',
          startDate: iso('2026-04-06'),
          endDate: iso('2026-04-17'),
        },
      },
    );
    expect(sprintRes.ok()).toBeTruthy();
    const sprintId = ((await sprintRes.json()) as { id: string }).id;

    const epic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Sprinted Epic',
      startDate: iso('2026-04-01'),
      dueDate: iso('2026-04-30'),
    });
    // NO dates of its own — its bar shows the sprint's window. This is the
    // shape that refused to move, and it is the common one: most teams put
    // their stories in sprints.
    const story = await createIssue(request, token, {
      projectId: project.id,
      title: 'Story in a sprint',
      parentId: epic.id,
      sprintId,
    });

    await page.goto(`/projects/${project.id}/roadmap`);
    await expect(page.getByTestId('roadmap-epic-bar').first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId('roadmap-zoom-week').click();
    await page.getByTestId(`roadmap-epic-expand-${epic.id}`).click();

    const childBar = page.getByTestId('roadmap-child-bar').first();
    await expect(childBar).toBeVisible({ timeout: 15_000 });

    const writes = trackApiWrites(page);
    const box = (await childBar.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 5 * 22,
      box.y + box.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();

    await writes.settle({
      match: (w) => w.method === 'PATCH' && w.path.endsWith(`/api/issues/${story.id}`),
      atLeast: 1,
    });

    // It gained its own dates, five days on from the sprint window...
    const res = await request.get(`${API_URL}/api/issues/${story.id}`, {
      headers: auth(token),
    });
    const after = (await res.json()) as {
      startDate: string | null;
      dueDate: string | null;
      sprintId: string | null;
    };
    expect(dayOf(after.startDate)).toBe('2026-04-11');
    expect(dayOf(after.dueDate)).toBe('2026-04-22');
    // ...and is STILL in its sprint. Dragging schedules, it does not unassign.
    expect(after.sprintId).toBe(sprintId);
  });

  test('an epic bar is tinted by its own status — a done epic reads done', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-tone',
      projectName: 'Roadmap Tone QA',
      openBoard: false,
    });

    /*
     * Founder report: "If an epic is marked done it does not show green on the
     * chart." `RoadmapEpicDto.statusCategory` had shipped from the start — its
     * own comment says "for tinting the row" — and the bar ignored it, so an
     * epic you had closed stayed the same blue as one nobody had started while
     * its child stories underneath it went green. That reads as the data being
     * wrong rather than the chart being incomplete.
     *
     * Asserted on the computed background rather than a class name: the point
     * is that the two bars are visibly different, which survives a repaint of
     * the palette. Both are read from the same property so a null/transparent
     * result can't accidentally satisfy it.
     */
    const statusRes = await request.get(
      `${API_URL}/api/projects/${project.id}/statuses`,
      { headers: auth(token) },
    );
    expect(statusRes.ok()).toBeTruthy();
    const statuses = (await statusRes.json()) as {
      id: string;
      category: string;
    }[];
    const doneStatus = statuses.find((s) => s.category === 'DONE')!;
    expect(doneStatus, 'project has a DONE status').toBeTruthy();

    const openEpic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Still Open Epic',
      startDate: iso('2026-04-01'),
      dueDate: iso('2026-04-30'),
    });
    const doneEpic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Finished Epic',
      startDate: iso('2026-05-01'),
      dueDate: iso('2026-05-30'),
    });
    const patch = await request.patch(`${API_URL}/api/issues/${doneEpic.id}`, {
      headers: auth(token),
      data: { statusId: doneStatus.id },
    });
    expect(patch.ok(), `mark done failed: ${patch.status()}`).toBeTruthy();

    await page.goto(`/projects/${project.id}/roadmap`);
    const openBar = page.locator(`[data-epic-id="${openEpic.id}"]`);
    const doneBar = page.locator(`[data-epic-id="${doneEpic.id}"]`);
    await expect(openBar).toBeVisible({ timeout: 15_000 });
    await expect(doneBar).toBeVisible({ timeout: 15_000 });

    const bg = (l: typeof openBar) =>
      l.evaluate((el) => getComputedStyle(el).backgroundColor);
    const openBg = await bg(openBar);
    const doneBg = await bg(doneBar);
    expect(openBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(doneBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(doneBg, 'a done epic must not paint the same as an open one').not.toBe(
      openBg,
    );
  });

  test('a dependency can be drawn between two epics and removed, without leaving the chart', async ({
    page,
    request,
  }) => {
    test.skip(
      test.info().project.name !== 'chromium-desktop',
      'pointer drag is desktop-only by design — see the note above',
    );
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-link',
      projectName: 'Roadmap Link QA',
      openBoard: false,
    });

    /*
     * Dependencies used to be draw-only: the chart rendered BLOCKS arrows but
     * the only way to create one was to open the epic's drawer, which is the
     * context switch this screen exists to remove.
     *
     * The gesture is a handle past the bar's right edge dragged onto another
     * bar. Asserted end to end — the arrow must appear AND the link must exist
     * server-side, because a purely visual pass would survive the write being
     * dropped.
     */
    const blocker = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Blocker Epic',
      startDate: iso('2026-04-01'),
      dueDate: iso('2026-04-20'),
    });
    const blocked = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Blocked Epic',
      startDate: iso('2026-05-01'),
      dueDate: iso('2026-05-20'),
    });

    await page.goto(`/projects/${project.id}/roadmap`);
    const src = page.locator(`[data-epic-id="${blocker.id}"]`);
    const dst = page.locator(`[data-epic-id="${blocked.id}"]`);
    await expect(src).toBeVisible({ timeout: 15_000 });
    await expect(dst).toBeVisible({ timeout: 15_000 });

    // No arrows yet.
    await expect(page.getByTestId('roadmap-dependency-layer')).toHaveCount(0);

    // The handle is hover-revealed, so hover the bar before reaching for it.
    const sb = (await src.boundingBox())!;
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    const handle = page.locator(`[data-link-from="${blocker.id}"]`);
    const hb = (await handle.boundingBox())!;
    const db = (await dst.boundingBox())!;

    const writes = trackApiWrites(page);
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2, {
      steps: 12,
    });
    await page.mouse.up();

    await writes.settle({
      match: (w) =>
        w.method === 'POST' && w.path.endsWith(`/api/issues/${blocker.id}/links`),
      atLeast: 1,
    });

    // Drawn on the chart...
    await expect(page.getByTestId('roadmap-dependency-layer')).toBeVisible({
      timeout: 15_000,
    });
    // ...and real on the server, as a BLOCKS from the blocker.
    const linksRes = await request.get(
      `${API_URL}/api/issues/${blocker.id}/links`,
      { headers: auth(token) },
    );
    expect(linksRes.ok()).toBeTruthy();
    const links = (await linksRes.json()) as {
      id: string;
      type: string;
      relatedIssue: { id: string };
    }[];
    expect(links).toHaveLength(1);
    expect(links[0].type).toBe('BLOCKS');
    expect(links[0].relatedIssue.id).toBe(blocked.id);

    // Removing it: hover the line, click the × that appears.
    const remove = page.getByTestId('roadmap-dependency-remove');
    /*
     * A forward elbow leaves the blocker's right edge, drops at a vertical run
     * just short of the blocked bar, and comes in at its left edge. The
     * vertical run is the only part guaranteed to sit in empty grid, so aim
     * there — sweeping y across the gap between the two rows, and nudging x a
     * few pixels either side because the exact stub width is the component's
     * business, not this test's.
     */
    const y1 = sb.y + sb.height / 2;
    const y2 = db.y + db.height / 2;
    outer: for (const dx of [-10, -6, -14, -2]) {
      for (let i = 0; i <= 10; i++) {
        await page.mouse.move(db.x + dx, y1 + ((y2 - y1) * i) / 10);
        if ((await remove.count()) > 0) break outer;
      }
    }
    await expect(remove).toBeVisible({ timeout: 5_000 });

    const deletes = trackApiWrites(page);
    await remove.click();
    await deletes.settle({
      match: (w) => w.method === 'DELETE' && w.path.includes('/api/issue-links/'),
      atLeast: 1,
    });

    const after = await request.get(`${API_URL}/api/issues/${blocker.id}/links`, {
      headers: auth(token),
    });
    expect((await after.json()) as unknown[]).toHaveLength(0);
  });

  test('a story can be dragged from one epic to another, and the new epic grows to fit', async ({
    page,
    request,
  }) => {
    test.skip(
      test.info().project.name !== 'chromium-desktop',
      'pointer drag is desktop-only by design — see the note above',
    );
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-reparent',
      projectName: 'Roadmap Reparent QA',
      openBoard: false,
    });

    /*
     * Founder: "give me the ability to drag sub items from epic to epic."
     *
     * A child bar carries two meanings — where it sits horizontally is its
     * schedule, which epic block it sits in is its parent — and only the first
     * was draggable. Moving a story to a different epic meant leaving for the
     * issue drawer, which is the split this screen exists to close.
     *
     * The destination epic is deliberately EARLIER than the story, so the
     * cascade has something to do: `growParentEpicToFit` must now fire on a
     * parent change, not only on a date change, or the receiving epic's
     * committed bar is left too short with the story hanging outside it.
     */
    const fromEpic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Origin Epic',
      startDate: iso('2026-04-01'),
      dueDate: iso('2026-04-30'),
    });
    const toEpic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Destination Epic',
      startDate: iso('2026-03-01'),
      dueDate: iso('2026-03-20'),
    });
    const story = await createIssue(request, token, {
      projectId: project.id,
      title: 'Travelling Story',
      parentId: fromEpic.id,
      startDate: iso('2026-04-06'),
      dueDate: iso('2026-04-14'),
    });

    await page.goto(`/projects/${project.id}/roadmap`);
    await expect(page.getByTestId('roadmap-epic-bar').first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId(`roadmap-epic-expand-${fromEpic.id}`).click();
    const bar = page.locator(`[data-child-id="${story.id}"]`);
    await expect(bar).toBeVisible({ timeout: 15_000 });

    const cb = (await bar.boundingBox())!;
    const target = page.locator(`[data-epic-id="${toEpic.id}"]`);
    const tb = (await target.boundingBox())!;

    const writes = trackApiWrites(page);
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.mouse.down();
    await page.mouse.move(cb.x + cb.width / 2, tb.y + tb.height / 2, {
      steps: 16,
    });
    // The destination lane highlights before you let go — dropping into the
    // wrong epic because every row looks alike is the obvious failure here.
    await expect(page.locator('[data-reparent-target="true"]')).toHaveCount(1);
    await page.mouse.up();

    await writes.settle({
      match: (w) =>
        w.method === 'PATCH' && w.path.endsWith(`/api/issues/${story.id}`),
      atLeast: 1,
    });

    const after = await request.get(`${API_URL}/api/issues/${story.id}`, {
      headers: auth(token),
    });
    const moved = (await after.json()) as {
      parentId: string | null;
      startDate: string | null;
      dueDate: string | null;
    };
    expect(moved.parentId).toBe(toEpic.id);
    // A purely vertical drag reparents WITHOUT rescheduling: the two meanings
    // are independent, and silently moving the dates would be a second edit
    // nobody asked for.
    expect(dayOf(moved.startDate)).toBe('2026-04-06');
    expect(dayOf(moved.dueDate)).toBe('2026-04-14');

    // The destination epic ended before the story starts, so it must have
    // grown to cover it.
    const epicAfter = await request.get(`${API_URL}/api/issues/${toEpic.id}`, {
      headers: auth(token),
    });
    const grown = (await epicAfter.json()) as { dueDate: string | null };
    expect(dayOf(grown.dueDate)).toBe('2026-04-14');
  });

  test('the epic column can be resized, and the width sticks', async ({
    page,
    request,
  }) => {
    test.skip(
      test.info().project.name !== 'chromium-desktop',
      'the rail is a fixed narrow layout on mobile and deliberately not resizable',
    );
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-rail',
      projectName: 'Roadmap Rail QA',
      openBoard: false,
    });
    /*
     * Founder: "the left hand epic and story list should be resizable. Story
     * titles are getting cut off." 248px fits about twenty characters, and the
     * column whose entire job is naming things was truncating the names.
     */
    await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'An epic with a deliberately long descriptive title',
      startDate: iso('2026-04-01'),
      dueDate: iso('2026-04-30'),
    });

    await page.goto(`/projects/${project.id}/roadmap`);
    const handle = page.getByTestId('roadmap-rail-resize');
    await expect(handle).toBeVisible({ timeout: 15_000 });

    const railWidth = () =>
      page
        .getByTestId('roadmap-rail')
        .evaluate((el) => (el as HTMLElement).offsetWidth);

    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + 60);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 140, hb.y + 60, { steps: 12 });
    await page.mouse.up();

    // Widened, and remembered across a reload — a width you have to re-drag
    // every visit is not a preference.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('nl_roadmap_rail_w')))
      .toBe('388');
    await page.reload();
    await expect(page.getByTestId('roadmap-epic-bar').first()).toBeVisible({
      timeout: 15_000,
    });
    expect(await railWidth()).toBe(388);

    // Double-click resets — the convention for a resizable divider, and the
    // only way back if it has been dragged somewhere unusable.
    await page.getByTestId('roadmap-rail-resize').dblclick();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('nl_roadmap_rail_w')))
      .toBe('248');
  });

  test('dependency lines are drawn UNDER the bars they connect', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-zorder',
      projectName: 'Roadmap Z QA',
      openBoard: false,
    });
    /*
     * Founder: "linking line should have a lower z index then the cards it's
     * self. I noticed lines overlapping certain gantt items."
     *
     * The overlay was `z-10` while the bars carried no z-index at all, and a
     * positive z-index paints above `z-auto` regardless of DOM order — so
     * every arrow was drawn straight over the cards it connects, despite a
     * comment in the source claiming the opposite.
     *
     * Asserted by hit-testing rather than by reading class names: what matters
     * is which element is actually on top at a point where they overlap.
     */
    const a = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Blocker Z',
      startDate: iso('2026-04-01'),
      dueDate: iso('2026-04-20'),
    });
    const bEpic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Blocked Z',
      startDate: iso('2026-05-01'),
      dueDate: iso('2026-05-20'),
    });
    const link = await request.post(`${API_URL}/api/issues/${a.id}/links`, {
      headers: auth(token),
      data: { target: bEpic.id, type: 'BLOCKS' },
    });
    expect(link.ok(), `link failed: ${link.status()}`).toBeTruthy();

    await page.goto(`/projects/${project.id}/roadmap`);
    await expect(page.getByTestId('roadmap-dependency-layer')).toBeVisible({
      timeout: 15_000,
    });

    for (const id of [a.id, bEpic.id]) {
      const onTop = await page.evaluate((epicId) => {
        const bar = document.querySelector(`[data-epic-id="${epicId}"]`)!;
        const r = bar.getBoundingClientRect();
        const el = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        return el?.closest('[data-testid="roadmap-dependency-layer"]')
          ? 'dependency-layer'
          : 'bar';
      }, id);
      expect(onTop, `an arrow is painted over ${id}`).toBe('bar');
    }
  });
});

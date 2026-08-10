import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_URL, setupIsolatedProject } from './helpers';

/**
 * Opening a ticket from the Gantt chart.
 *
 * Founder: "if I click on a story number on a story in the Gantt chart I would
 * like the sidebar to open for that ticket so I can quickly update."
 *
 * A story was the one named thing on this chart with no way in: its rail row
 * was a plain `div`, so reading a plan and then changing something in it meant
 * leaving for the board — the context switch this screen exists to remove.
 *
 * WHICH PANE DOES WHAT, because the first attempt got this wrong. Opening
 * lives in the LEFT RAIL only. The grid is the schedule, so a click there
 * belongs to moving and resizing bars, and giving bars a click-to-open as well
 * made a plain click ambiguous with the start of a drag. Founder: "If I click
 * on the Gantt chart item then I should be able to move it. If I click in the
 * left hand plane then I should open the ticket." The epic bar had opened on
 * click since long before that rule existed; it now follows it too, because a
 * rule that applies to stories and not epics is not a rule.
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

const iso = (d: string) => `${d}T00:00:00.000Z`;

/** Seed an epic with one dated story under it and open the roadmap. */
async function seedPlan(
  page: Parameters<typeof setupIsolatedProject>[0],
  request: APIRequestContext,
  label: string,
) {
  const { token, project } = await setupIsolatedProject(page, request, {
    label,
    projectName: 'Roadmap Open QA',
    openBoard: false,
  });
  const epic = await createIssue(request, token, {
    projectId: project.id,
    type: 'EPIC',
    title: 'Billing rework',
    startDate: iso('2026-05-01'),
    dueDate: iso('2026-05-31'),
  });
  const story = await createIssue(request, token, {
    projectId: project.id,
    type: 'STORY',
    title: 'Proration edge cases',
    parentId: epic.id,
    startDate: iso('2026-05-05'),
    dueDate: iso('2026-05-12'),
  });

  await page.goto(`/projects/${project.id}/roadmap`);
  await expect(page.getByTestId('roadmap-epic-bar').first()).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId(`roadmap-epic-expand-${epic.id}`).click();
  return { token, project, epic, story };
}

test.describe('Open a ticket from the Gantt', () => {
  test('clicking a story key in the rail opens that story', async ({
    page,
    request,
  }) => {
    const { story } = await seedPlan(page, request, 'rm-open-rail');

    const railButton = page.getByTestId(`roadmap-open-child-${story.id}`);
    await expect(railButton).toBeVisible({ timeout: 15_000 });
    if (test.info().project.name === 'chromium-desktop') {
      // The key is the thing the founder pointed at, so it has to be INSIDE
      // the click target rather than merely next to it.
      await expect(railButton).toContainText(story.key);
    } else {
      // Below 640px the rail is 132px and drops the key badge on purpose — it
      // used to overlap the percentage and squeeze the title to zero width.
      // The row still opens; the title is what labels it there.
      await expect(railButton).not.toContainText(story.key);
      await expect(railButton).toContainText('Proration edge cases');
    }
    await railButton.click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    // The drawer's own key badge, not just "the key appears somewhere" — the
    // parent epic's key is legitimately rendered further down in Parent.
    await expect(drawer.locator('.nl-issue-key').first()).toHaveText(story.key);
    // The title lives in an input, so it is a value and not page text.
    await expect(drawer.getByLabel('Issue title')).toHaveValue(
      'Proration edge cases',
    );
    // Deep-linkable, like every other way of opening this drawer.
    await expect(page).toHaveURL(new RegExp(`issue=${story.id}`));
  });

  test('a bar is for moving, so clicking one does NOT open the drawer', async ({
    page,
    request,
  }) => {
    /*
     * The two panes mean different things and one gesture cannot mean both.
     * The grid is the schedule — a click there belongs to moving and resizing
     * — and the rail is the list of what the work IS, so that is where opening
     * lives. An earlier version of this feature put click-to-open on the bars
     * as well, which made a plain click ambiguous with the start of a drag;
     * founder: "If I click on the Gantt chart item then I should be able to
     * move it. If I click in the left hand plane then I should open the
     * ticket."
     */
    const { epic, story } = await seedPlan(page, request, 'rm-open-bar');

    const storyBar = page.locator(`[data-child-id="${story.id}"]`);
    await expect(storyBar).toBeVisible({ timeout: 15_000 });
    await storyBar.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Same rule for an epic bar, which used to open on click before the rule
    // existed.
    await page.getByTestId('roadmap-epic-bar').first().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).not.toHaveURL(new RegExp(`issue=${epic.id}`));

    // …and the rail still opens the very same story.
    await page.getByTestId(`roadmap-open-child-${story.id}`).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    await expect(drawer.locator('.nl-issue-key').first()).toHaveText(story.key);
  });

  test('the story drawer edits the story — a due date typed there sticks', async ({
    page,
    request,
  }) => {
    // The whole point of the request: open it from the chart and change
    // something without leaving.
    const { token, story } = await seedPlan(page, request, 'rm-open-edit');

    await page.getByTestId(`roadmap-open-child-${story.id}`).click();
    const due = page.getByLabel('Due date', { exact: true });
    await expect(due).toBeVisible({ timeout: 10_000 });
    await due.fill('2026-05-20');
    await due.blur();

    await expect
      .poll(
        async () => {
          const res = await request.get(`${API_URL}/api/issues/${story.id}`, {
            headers: auth(token),
          });
          const issue = (await res.json()) as { dueDate: string | null };
          return (issue.dueDate ?? '').slice(0, 10);
        },
        { timeout: 10_000 },
      )
      .toBe('2026-05-20');
  });

  test('the rail row is reachable and operable from the keyboard', async ({
    page,
    request,
  }) => {
    const { story } = await seedPlan(page, request, 'rm-open-kbd');

    const railButton = page.getByTestId(`roadmap-open-child-${story.id}`);
    await railButton.focus();
    await expect(railButton).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
  });

  test('an epic still opens from its rail row', async ({ page, request }) => {
    const { epic } = await seedPlan(page, request, 'rm-open-epic');

    await page.getByTestId(`roadmap-open-epic-${epic.id}`).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    await expect(drawer.locator('.nl-issue-key').first()).toHaveText(epic.key);
  });

  test('rescheduling a story by dragging does NOT open the drawer', async ({
    page,
    request,
  }) => {
    test.skip(
      test.info().project.name !== 'chromium-desktop',
      'pointer drag is desktop-only by design',
    );
    // A drag ends in a click event on the same element, so this is the case
    // that used to need a post-drag suppression ref. With opening moved off
    // the bars entirely there is nothing left to suppress — this test is what
    // says so, and what would catch click-to-open being reintroduced there.
    const { token, story } = await seedPlan(page, request, 'rm-open-drag');

    const bar = page.locator(`[data-child-id="${story.id}"]`);
    await expect(bar).toBeVisible({ timeout: 15_000 });
    const box = (await bar.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, {
      steps: 12,
    });
    await page.mouse.up();

    // The drag really did commit — otherwise "the drawer stayed shut" would
    // pass for the boring reason that nothing happened at all.
    await expect
      .poll(
        async () => {
          const res = await request.get(`${API_URL}/api/issues/${story.id}`, {
            headers: auth(token),
          });
          const issue = (await res.json()) as { startDate: string | null };
          return (issue.startDate ?? '').slice(0, 10);
        },
        { timeout: 10_000 },
      )
      .not.toBe('2026-05-05');
    // …and the drawer stayed shut.
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

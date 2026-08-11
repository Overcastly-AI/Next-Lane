import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_URL, setupIsolatedProject } from './helpers';

/**
 * The Gantt filters match STORIES, not just epics.
 *
 * Founder: "the label filter for stories is not working on the Gantt chart.
 * It's only for epics. Can stories be included?"
 *
 * Two halves, and only fixing one leaves the feature still broken:
 *
 *   1. The story ROWS ignored the filters entirely. Expanding an epic with a
 *      label filter set listed every story it had, including the ones without
 *      that label.
 *   2. An epic only qualified on its OWN labels. Labels mostly live on the
 *      stories, so filtering by a story-carried label hid every epic and
 *      emptied the chart — which is the state that reads as "not working".
 *
 * The second half is why `RoadmapEpicDto` carries `childLabelIds` /
 * `childAssigneeIds`: children are fetched lazily, one request per expanded
 * epic, so the client cannot otherwise answer "does this collapsed epic
 * contain a story with label X?".
 *
 * The text query is deliberately NOT part of this — its input says "Filter
 * epics by title or key", and narrowing to a few epics and then seeing all of
 * their work is the useful reading.
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

async function createLabel(
  request: APIRequestContext,
  token: string,
  projectId: string,
  name: string,
): Promise<{ id: string }> {
  const res = await request.post(`${API_URL}/api/projects/${projectId}/labels`, {
    headers: auth(token),
    data: { name, color: '#3b82f6' },
  });
  expect(res.ok(), `create label failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as { id: string };
}

async function attachLabel(
  request: APIRequestContext,
  token: string,
  issueId: string,
  labelId: string,
) {
  const res = await request.post(`${API_URL}/api/issues/${issueId}/labels`, {
    headers: auth(token),
    data: { labelId },
  });
  expect(res.ok(), `attach label failed: ${res.status()}`).toBeTruthy();
}

const iso = (d: string) => `${d}T00:00:00.000Z`;

/**
 * One epic carrying NO labels, with two stories: one labelled, one not — the
 * exact shape the founder described, where the label the user wants to filter
 * by exists only below the epic.
 */
async function seed(page: any, request: APIRequestContext, label: string) {
  const { token, project } = await setupIsolatedProject(page, request, {
    label,
    projectName: 'Roadmap Story Filters QA',
    openBoard: false,
  });

  const backend = await createLabel(request, token, project.id, `backend-${label}`);

  const epic = await createIssue(request, token, {
    projectId: project.id,
    type: 'EPIC',
    title: 'Billing rework',
    startDate: iso('2026-05-01'),
    dueDate: iso('2026-05-31'),
  });
  const labelled = await createIssue(request, token, {
    projectId: project.id,
    type: 'STORY',
    title: 'Proration edge cases',
    parentId: epic.id,
    startDate: iso('2026-05-05'),
    dueDate: iso('2026-05-12'),
  });
  const unlabelled = await createIssue(request, token, {
    projectId: project.id,
    type: 'STORY',
    title: 'Invoice PDF layout',
    parentId: epic.id,
    startDate: iso('2026-05-13'),
    dueDate: iso('2026-05-20'),
  });
  await attachLabel(request, token, labelled.id, backend.id);

  return { token, project, epic, labelled, unlabelled, backend };
}

test.describe('Gantt filters reach the stories', () => {
  test('filtering by a label only a STORY carries keeps the epic on the chart', async ({
    page,
    request,
  }) => {
    const { project, epic, backend } = await seed(page, request, 'rmsf-epic');

    await page.goto(`/projects/${project.id}/roadmap`);
    await expect(page.getByTestId('roadmap-epic-bar').first()).toBeVisible({
      timeout: 15_000,
    });

    // The epic has no labels of its own. Before the fix this emptied the chart.
    await page.getByTestId('roadmap-filter-label').selectOption(backend.id);

    await expect(page.getByTestId(`roadmap-open-epic-${epic.id}`)).toBeVisible();
    await expect(page.getByTestId('roadmap-filter-hidden-count')).toHaveText(
      'No epics hidden',
    );
  });

  test('an expanded epic shows only the stories that match the label', async ({
    page,
    request,
  }) => {
    const { project, epic, labelled, unlabelled, backend } = await seed(
      page,
      request,
      'rmsf-kids',
    );

    await page.goto(`/projects/${project.id}/roadmap`);
    await expect(page.getByTestId('roadmap-epic-bar').first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId(`roadmap-epic-expand-${epic.id}`).click();

    // Unfiltered: both stories are there, so the filtered assertion below is
    // about the filter and not about the stories failing to load.
    await expect(
      page.getByTestId(`roadmap-open-child-${labelled.id}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`roadmap-open-child-${unlabelled.id}`),
    ).toBeVisible();

    await page.getByTestId('roadmap-filter-label').selectOption(backend.id);

    await expect(
      page.getByTestId(`roadmap-open-child-${labelled.id}`),
    ).toBeVisible();
    // THE BUG: this row used to survive the filter, because the child rows
    // were pushed onto the chart without ever consulting the predicate.
    await expect(
      page.getByTestId(`roadmap-open-child-${unlabelled.id}`),
    ).toHaveCount(0);
  });

  test('an epic whose stories are all filtered out says so, not "no child issues"', async ({
    page,
    request,
  }) => {
    const { token, project, epic } = await seed(page, request, 'rmsf-empty');

    // A second label, attached to nothing — filtering by it leaves this epic
    // on the chart only if it were promoted, which it should not be.
    const orphan = await createLabel(request, token, project.id, 'orphan-rmsf');
    // Put it on the EPIC so the epic survives the filter while none of its
    // stories do — the case where the wrong empty-state message would lie.
    await attachLabel(request, token, epic.id, orphan.id);

    await page.goto(`/projects/${project.id}/roadmap`);
    await expect(page.getByTestId('roadmap-epic-bar').first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId(`roadmap-epic-expand-${epic.id}`).click();
    await page.getByTestId('roadmap-filter-label').selectOption(orphan.id);

    await expect(page.getByTestId(`roadmap-open-epic-${epic.id}`)).toBeVisible();
    // "No child issues." on an epic with two stories reads as data loss.
    await expect(page.getByText('No stories match the filters.')).toBeVisible();
    await expect(page.getByText('No child issues.')).toHaveCount(0);
  });

  test('clearing the filter brings every story back', async ({
    page,
    request,
  }) => {
    const { project, epic, labelled, unlabelled, backend } = await seed(
      page,
      request,
      'rmsf-clear',
    );

    await page.goto(`/projects/${project.id}/roadmap`);
    await expect(page.getByTestId('roadmap-epic-bar').first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId(`roadmap-epic-expand-${epic.id}`).click();
    await page.getByTestId('roadmap-filter-label').selectOption(backend.id);
    // The epic must still be ON the chart while filtered — otherwise the
    // "story is hidden" assertion below is vacuously true because the whole
    // row went away, which is exactly how the pre-fix code behaved. Verified:
    // without this line the test passes against the bug.
    await expect(page.getByTestId(`roadmap-open-epic-${epic.id}`)).toBeVisible();
    await expect(
      page.getByTestId(`roadmap-open-child-${unlabelled.id}`),
    ).toHaveCount(0);

    await page.getByTestId('roadmap-filter-clear').click();

    await expect(
      page.getByTestId(`roadmap-open-child-${labelled.id}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`roadmap-open-child-${unlabelled.id}`),
    ).toBeVisible();
  });
});

import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_URL, setupIsolatedProject } from './helpers';

/**
 * Expand all / collapse all on the Gantt.
 *
 * Founder: "We need an expand all and collapse button."
 *
 * Two buttons rather than one toggle, and that is the part worth testing
 * rather than assuming. A single toggle has to choose a meaning for the common
 * middle state — a few epics open, most shut — and whichever it chooses, the
 * other action costs two clicks and a wasted round of child fetches to undo.
 * So each button is always one click for the thing you want, and disables
 * itself when it would do nothing.
 *
 * "All" means every epic the chart is DRAWING: the set is taken after the
 * filters, so expanding a filtered view opens what you can see rather than the
 * plan hiding behind it. Both of those are asserted below, because both are
 * decisions someone could reasonably reverse later without noticing.
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

/** Three epics: two with a story each, one with none. */
async function seedPlan(
  page: Parameters<typeof setupIsolatedProject>[0],
  request: APIRequestContext,
  label: string,
) {
  const { token, project } = await setupIsolatedProject(page, request, {
    label,
    projectName: 'Roadmap Expand QA',
    openBoard: false,
  });

  const alpha = await createIssue(request, token, {
    projectId: project.id,
    type: 'EPIC',
    title: 'Alpha epic',
    startDate: iso('2026-05-01'),
    dueDate: iso('2026-05-31'),
  });
  const beta = await createIssue(request, token, {
    projectId: project.id,
    type: 'EPIC',
    title: 'Beta epic',
    startDate: iso('2026-06-01'),
    dueDate: iso('2026-06-30'),
  });
  // Childless on purpose: "expand all" must not open a row that has nothing
  // in it, the same reason its own chevron is disabled.
  const empty = await createIssue(request, token, {
    projectId: project.id,
    type: 'EPIC',
    title: 'Empty epic',
    startDate: iso('2026-07-01'),
    dueDate: iso('2026-07-31'),
  });

  const alphaStory = await createIssue(request, token, {
    projectId: project.id,
    type: 'STORY',
    title: 'Alpha story',
    parentId: alpha.id,
    startDate: iso('2026-05-05'),
    dueDate: iso('2026-05-12'),
  });
  const betaStory = await createIssue(request, token, {
    projectId: project.id,
    type: 'STORY',
    title: 'Beta story',
    parentId: beta.id,
    startDate: iso('2026-06-05'),
    dueDate: iso('2026-06-12'),
  });

  await page.goto(`/projects/${project.id}/roadmap`);
  await expect(page.getByTestId('roadmap-epic-bar').first()).toBeVisible({
    timeout: 15_000,
  });
  return { token, project, alpha, beta, empty, alphaStory, betaStory };
}

test.describe('Expand all / collapse all', () => {
  test('one click opens every epic that has stories, another shuts them', async ({
    page,
    request,
  }) => {
    const { alpha, beta, alphaStory, betaStory } = await seedPlan(
      page,
      request,
      'rm-expandall',
    );

    const expandAll = page.getByTestId('roadmap-expand-all');
    const collapseAll = page.getByTestId('roadmap-collapse-all');

    // Nothing open yet: collapsing is the no-op, so it says so.
    await expect(collapseAll).toBeDisabled();
    await expect(expandAll).toBeEnabled();
    await expect(
      page.getByTestId(`roadmap-open-child-${alphaStory.id}`),
    ).toHaveCount(0);

    await expandAll.click();
    await expect(
      page.getByTestId(`roadmap-open-child-${alphaStory.id}`),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByTestId(`roadmap-open-child-${betaStory.id}`),
    ).toBeVisible();
    // Both chevrons now report themselves open, so the per-row control and the
    // bulk one cannot drift apart.
    await expect(
      page.getByTestId(`roadmap-epic-expand-${alpha.id}`),
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page.getByTestId(`roadmap-epic-expand-${beta.id}`),
    ).toHaveAttribute('aria-expanded', 'true');

    // Everything expandable is open, so expanding again is the no-op.
    await expect(expandAll).toBeDisabled();
    await expect(collapseAll).toBeEnabled();

    await collapseAll.click();
    await expect(
      page.getByTestId(`roadmap-open-child-${alphaStory.id}`),
    ).toHaveCount(0);
    await expect(
      page.getByTestId(`roadmap-open-child-${betaStory.id}`),
    ).toHaveCount(0);
    await expect(
      page.getByTestId(`roadmap-epic-expand-${alpha.id}`),
    ).toHaveAttribute('aria-expanded', 'false');
    await expect(collapseAll).toBeDisabled();
  });

  test('an epic with no stories is left alone', async ({ page, request }) => {
    const { empty } = await seedPlan(page, request, 'rm-expandempty');

    await page.getByTestId('roadmap-expand-all').click();
    // Its chevron is disabled precisely because there is nothing under it;
    // "expand all" must not claim otherwise.
    await expect(
      page.getByTestId(`roadmap-epic-expand-${empty.id}`),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  test('collapse all is one click from a partially expanded chart', async ({
    page,
    request,
  }) => {
    // The state a single toggle handles badly: some open, some shut.
    const { alpha, alphaStory } = await seedPlan(page, request, 'rm-expandmix');

    await page.getByTestId(`roadmap-epic-expand-${alpha.id}`).click();
    await expect(
      page.getByTestId(`roadmap-open-child-${alphaStory.id}`),
    ).toBeVisible({ timeout: 10_000 });

    // Neither button is a no-op here, so both are live and either is one click.
    await expect(page.getByTestId('roadmap-expand-all')).toBeEnabled();
    const collapseAll = page.getByTestId('roadmap-collapse-all');
    await expect(collapseAll).toBeEnabled();

    await collapseAll.click();
    await expect(
      page.getByTestId(`roadmap-open-child-${alphaStory.id}`),
    ).toHaveCount(0);
  });

  test('expand all opens what the filters left on the chart, not the whole plan', async ({
    page,
    request,
  }) => {
    const { alphaStory, betaStory } = await seedPlan(
      page,
      request,
      'rm-expandfilter',
    );

    // Narrow to one epic by title, then expand.
    await page.getByPlaceholder(/filter by title or key/i).fill('Alpha');
    await expect(page.getByTestId('roadmap-epic-bar')).toHaveCount(1);

    await page.getByTestId('roadmap-expand-all').click();
    await expect(
      page.getByTestId(`roadmap-open-child-${alphaStory.id}`),
    ).toBeVisible({ timeout: 10_000 });
    // Beta was filtered out, so it was never expanded — clearing the filter
    // brings back a COLLAPSED Beta rather than one the button opened blind.
    await page.getByPlaceholder(/filter by title or key/i).fill('');
    await expect(page.getByTestId('roadmap-epic-bar')).toHaveCount(3);
    await expect(
      page.getByTestId(`roadmap-open-child-${betaStory.id}`),
    ).toHaveCount(0);
  });

  test('the buttons work on the phone rail too', async ({ page, request }) => {
    test.skip(
      test.info().project.name !== 'mobile-chrome',
      'the mobile half of the toolbar contract',
    );
    const { alphaStory } = await seedPlan(page, request, 'rm-expandmobile');

    const expandAll = page.getByTestId('roadmap-expand-all');
    await expandAll.scrollIntoViewIfNeeded();
    await expandAll.click();
    await expect(
      page.getByTestId(`roadmap-open-child-${alphaStory.id}`),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('roadmap-collapse-all').click();
    await expect(
      page.getByTestId(`roadmap-open-child-${alphaStory.id}`),
    ).toHaveCount(0);
  });
});

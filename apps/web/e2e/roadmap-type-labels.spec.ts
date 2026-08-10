import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_URL, setupIsolatedProject } from './helpers';

/**
 * Type dots, label dots, and the key that explains them.
 *
 * Founder: "could we add a tag color to the Gantt chart for all issue types.
 * I think of it as a color dot on the item or below the item. And a key in the
 * header… Don't forget about the colored dot for the labels."
 *
 * Two colour systems land on one chart that was already using colour for three
 * other things (status fill, the today marker, violated dependencies), and the
 * palettes genuinely collide — Story green against Done green, Task blue
 * against In-progress blue, Bug red against the today line. So the dots are
 * CIRCLES where every existing swatch is a rounded square, and they live in
 * the rail rather than on the bars. These tests hold that separation in place:
 * the type colours must be the SAME ones the board cards use (one vocabulary,
 * not two), and the legend must describe what is actually drawn.
 */
function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** The canonical type colours, as `issueMeta.tsx` defines them, in rgb(). */
const TYPE_RGB: Record<string, string> = {
  STORY: 'rgb(34, 197, 94)',
  TASK: 'rgb(59, 130, 246)',
  BUG: 'rgb(239, 68, 68)',
  EPIC: 'rgb(168, 85, 247)',
  SUBTASK: 'rgb(107, 114, 128)',
};

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
  color: string,
): Promise<{ id: string }> {
  const res = await request.post(`${API_URL}/api/projects/${projectId}/labels`, {
    headers: auth(token),
    data: { name, color },
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

test.describe('Gantt type dots and label dots', () => {
  test('every row carries its type colour, and it is the board’s colour', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-types',
      projectName: 'Roadmap Types QA',
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
    const bug = await createIssue(request, token, {
      projectId: project.id,
      type: 'BUG',
      title: 'Rounding is wrong',
      parentId: epic.id,
      startDate: iso('2026-05-13'),
      dueDate: iso('2026-05-20'),
    });

    await page.goto(`/projects/${project.id}/roadmap`);
    await expect(page.getByTestId('roadmap-epic-bar').first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId(`roadmap-epic-expand-${epic.id}`).click();

    const dotIn = (rowTestId: string) =>
      page.getByTestId(rowTestId).getByTestId('roadmap-type-dot');

    await expect(dotIn(`roadmap-open-epic-${epic.id}`)).toHaveCSS(
      'background-color',
      TYPE_RGB.EPIC,
    );
    await expect(dotIn(`roadmap-open-child-${story.id}`)).toHaveCSS(
      'background-color',
      TYPE_RGB.STORY,
    );
    await expect(dotIn(`roadmap-open-child-${bug.id}`)).toHaveCSS(
      'background-color',
      TYPE_RGB.BUG,
    );

    // Circles, not squares. The status swatches are rounded squares, and the
    // two palettes overlap, so the shape is what keeps the questions apart.
    await expect(dotIn(`roadmap-open-child-${bug.id}`)).toHaveCSS(
      'border-radius',
      '9999px',
    );
  });

  test('the legend explains the types on the chart, and only those', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-legend-types',
      projectName: 'Roadmap Legend Types QA',
      openBoard: false,
    });
    const epic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Only epics here',
      startDate: iso('2026-06-01'),
      dueDate: iso('2026-06-30'),
    });
    const bug = await createIssue(request, token, {
      projectId: project.id,
      type: 'BUG',
      title: 'A bug nobody has expanded yet',
      parentId: epic.id,
      startDate: iso('2026-06-05'),
      dueDate: iso('2026-06-09'),
    });

    await page.goto(`/projects/${project.id}/roadmap`);
    const legend = page.getByTestId('roadmap-legend-types');
    await expect(legend).toBeVisible({ timeout: 15_000 });

    // Collapsed: only epic rows are drawn, so Epic is all there is to explain.
    await expect(legend).toContainText('Epic');
    await expect(legend).not.toContainText('Bug');
    // And never a type this project has no rows for at all.
    await expect(legend).not.toContainText('Subtask');

    // Expanding draws the bug row, so the key grows to cover it.
    await page.getByTestId(`roadmap-epic-expand-${epic.id}`).click();
    await expect(page.getByTestId(`roadmap-open-child-${bug.id}`)).toBeVisible();
    await expect(legend).toContainText('Bug');
    await expect(legend).not.toContainText('Subtask');
  });

  test('labels render as dots in their own colours, capped with a count', async ({
    page,
    request,
  }) => {
    test.skip(
      test.info().project.name !== 'chromium-desktop',
      'the 132px phone rail drops label dots by design — asserted separately',
    );
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-labeldots',
      projectName: 'Roadmap Label Dots QA',
      openBoard: false,
    });
    const epic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Labelled epic',
      startDate: iso('2026-07-01'),
      dueDate: iso('2026-07-31'),
    });
    const story = await createIssue(request, token, {
      projectId: project.id,
      type: 'STORY',
      title: 'Labelled story',
      parentId: epic.id,
      startDate: iso('2026-07-05'),
      dueDate: iso('2026-07-12'),
    });

    const red = await createLabel(request, token, project.id, 'urgent', '#ef4444');
    const blue = await createLabel(request, token, project.id, 'infra', '#3b82f6');
    const green = await createLabel(request, token, project.id, 'ux', '#22c55e');
    const amber = await createLabel(request, token, project.id, 'debt', '#f59e0b');

    // One label on the story…
    await attachLabel(request, token, story.id, red.id);
    // …and four on the epic, one past the cap.
    for (const l of [red, blue, green, amber]) {
      await attachLabel(request, token, epic.id, l.id);
    }

    await page.goto(`/projects/${project.id}/roadmap`);
    await expect(page.getByTestId('roadmap-epic-bar').first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId(`roadmap-epic-expand-${epic.id}`).click();

    const storyDots = page
      .getByTestId(`roadmap-open-child-${story.id}`)
      .getByTestId('roadmap-label-dots');
    await expect(storyDots).toBeVisible();
    await expect(storyDots.locator(`[data-label-id="${red.id}"]`)).toHaveCSS(
      'background-color',
      'rgb(239, 68, 68)',
    );

    // Four labels, three dots and a "+1" — the title is the column's job and
    // a row with every label spelled out would leave nothing for it.
    const epicDots = page
      .getByTestId(`roadmap-open-epic-${epic.id}`)
      .getByTestId('roadmap-label-dots');
    await expect(epicDots.locator('[data-label-id]')).toHaveCount(3);
    await expect(epicDots).toContainText('+1');
    // The hover names all four, including the one that became the count.
    await expect(epicDots).toHaveAttribute(
      'title',
      /Labels:.*urgent.*infra.*ux.*debt/,
    );
  });

  test('a row with no labels draws no dots at all', async ({ page, request }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-nolabels',
      projectName: 'Roadmap No Labels QA',
      openBoard: false,
    });
    const epic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Bare epic',
      startDate: iso('2026-08-01'),
      dueDate: iso('2026-08-31'),
    });

    await page.goto(`/projects/${project.id}/roadmap`);
    const row = page.getByTestId(`roadmap-open-epic-${epic.id}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByTestId('roadmap-label-dots')).toHaveCount(0);
    // The type dot is not conditional, though.
    await expect(row.getByTestId('roadmap-type-dot')).toBeVisible();
  });

  test('the phone rail keeps the type dot and drops the label dots', async ({
    page,
    request,
  }) => {
    test.skip(
      test.info().project.name !== 'mobile-chrome',
      'this is the mobile-specific half of the rail contract',
    );
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-mobiledots',
      projectName: 'Roadmap Mobile Dots QA',
      openBoard: false,
    });
    const epic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Mobile epic',
      startDate: iso('2026-09-01'),
      dueDate: iso('2026-09-30'),
    });
    const label = await createLabel(
      request,
      token,
      project.id,
      'urgent',
      '#ef4444',
    );
    await attachLabel(request, token, epic.id, label.id);

    await page.goto(`/projects/${project.id}/roadmap`);
    const row = page.getByTestId(`roadmap-open-epic-${epic.id}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    // 132px of rail: the type dot is one glyph and earns its place; label dots
    // and the key badge do not, and the title is what identifies the work.
    await expect(row.getByTestId('roadmap-type-dot')).toBeVisible();
    await expect(row.getByTestId('roadmap-label-dots')).toHaveCount(0);
  });
});

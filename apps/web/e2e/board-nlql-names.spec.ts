/**
 * e2e: NLQL name resolution on the board (GA bug #1).
 *
 * `status = "In Progress"`, `label = "x"`, `component = "x"`, priority and
 * type queries must FILTER the board, not error with "unknown status ...".
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupIsolatedProject, createLabel, API_URL } from './helpers';

const stamp = () => `${Date.now().toString(36)}`;

async function seed(request: APIRequestContext, token: string, projectId: string) {
  const h = { Authorization: `Bearer ${token}` };
  const s = stamp();
  const statuses = (await (await request.get(`${API_URL}/api/projects/${projectId}/statuses`, { headers: h })).json()) as {
    id: string;
    name: string;
  }[];
  const inProgress = statuses.find((x) => x.name === 'In Progress')!;
  const labelName = `lbl${s}`;
  const labelId = await createLabel(request, token, projectId, labelName);
  const compRes = await request.post(`${API_URL}/api/projects/${projectId}/components`, {
    headers: h,
    data: { name: `comp${s}` },
  });
  expect(compRes.ok()).toBeTruthy();
  const comp = (await compRes.json()) as { id: string; name: string };

  async function make(data: Record<string, unknown>) {
    const r = await request.post(`${API_URL}/api/issues`, { headers: h, data: { projectId, ...data } });
    expect(r.ok()).toBeTruthy();
    return (await r.json()) as { id: string };
  }
  const titles = { prog: `Prog ${s}`, label: `Labelled ${s}`, comp: `Comped ${s}`, bug: `Bugged ${s}`, plain: `Plain ${s}` };
  await make({ title: titles.prog, statusId: inProgress.id });
  const l = await make({ title: titles.label });
  const lr = await request.post(`${API_URL}/api/issues/${l.id}/labels`, { headers: h, data: { labelId } });
  expect(lr.ok()).toBeTruthy();
  await make({ title: titles.comp, componentId: comp.id });
  await make({ title: titles.bug, type: 'BUG', priority: 'HIGHEST' });
  await make({ title: titles.plain, type: 'TASK', priority: 'LOW' });
  return { titles, labelName, compName: comp.name };
}

async function runQuery(page: import('@playwright/test').Page, q: string) {
  const input = page.getByTestId('nlql-query-input');
  await input.fill('');
  await input.click();
  await input.pressSequentially(q, { delay: 15 });
}

test.describe('board NLQL name resolution', () => {
  test('status / label / component / priority / type queries filter the board', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'nlql-names' });
    const { titles, labelName, compName } = await seed(request, ctx.token, ctx.project.id);
    await page.reload();
    await expect(page.getByText(titles.plain).first()).toBeVisible({ timeout: 15_000 });

    await runQuery(page, 'status = "In Progress"');
    await expect(page.getByTestId('nlql-error')).toHaveCount(0);
    await expect(page.getByText(titles.prog).first()).toBeVisible();
    await expect(page.getByText(titles.plain)).toHaveCount(0, { timeout: 10_000 });

    await runQuery(page, `label = "${labelName}"`);
    await expect(page.getByTestId('nlql-error')).toHaveCount(0);
    await expect(page.getByText(titles.label).first()).toBeVisible();
    await expect(page.getByText(titles.plain)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(titles.prog)).toHaveCount(0);

    await runQuery(page, `component = "${compName}"`);
    await expect(page.getByTestId('nlql-error')).toHaveCount(0);
    await expect(page.getByText(titles.comp).first()).toBeVisible();
    await expect(page.getByText(titles.plain)).toHaveCount(0, { timeout: 10_000 });

    await runQuery(page, 'priority = HIGHEST');
    await expect(page.getByText(titles.bug).first()).toBeVisible();
    await expect(page.getByText(titles.plain)).toHaveCount(0, { timeout: 10_000 });

    await runQuery(page, 'type = BUG AND status = "To Do"');
    await expect(page.getByTestId('nlql-error')).toHaveCount(0);
    await expect(page.getByText(titles.bug).first()).toBeVisible();
    await expect(page.getByText(titles.plain)).toHaveCount(0, { timeout: 10_000 });
  });

  test('a genuinely unknown status still errors', async ({ page, request }) => {
    await setupIsolatedProject(page, request, { label: 'nlql-names-bad' });
    await runQuery(page, 'status = "Nope Status"');
    await expect(page.getByTestId('nlql-error')).toBeVisible();
  });
});

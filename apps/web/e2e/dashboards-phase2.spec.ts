/**
 * e2e: Configurable dashboards — Phase 2.
 *
 * Route: /projects/:projectId/dashboards
 *
 * Covers the Phase 2 scope on top of the Phase 1 suite (`dashboards.spec.ts`):
 *  - cross-sprint VELOCITY_TREND gadget renders committed/completed bars
 *  - a project's very first dashboard is pre-populated with 3 starter
 *    gadgets; every dashboard after that starts empty (unchanged)
 *  - drag-to-reorder gadgets via a real `page.mouse` down/move/up sequence
 *    on the drag handle (dnd-kit listens on Pointer Events, not HTML5 DnD,
 *    so Playwright's own `dragTo` helper doesn't trigger it), persists
 *    across reload
 *  - cross-workspace gadget scoping: a user who belongs to two workspaces
 *    gets fully correct, non-leaking dashboard content/editability for a
 *    deep-linked project in the NON-active workspace
 *  - mobile (393px): the trend gadget renders and drag-to-reorder works in
 *    the single-column layout
 *
 * Uses isolated projects/workspaces so the shared demo is never polluted.
 */
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  setupIsolatedProject,
  registerNewUser,
  createWorkspace,
  createProject,
  API_URL,
  trackApiWrites,
} from './helpers';

interface StatusRow {
  id: string;
  name: string;
  category: string;
}

async function getStatuses(
  request: APIRequestContext,
  token: string,
  projectId: string,
): Promise<StatusRow[]> {
  const res = await request.get(`${API_URL}/api/projects/${projectId}/statuses`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `list statuses failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as StatusRow[];
}

async function createIssueWith(
  request: APIRequestContext,
  token: string,
  projectId: string,
  data: Record<string, unknown>,
): Promise<{ id: string; key: string }> {
  const res = await request.post(`${API_URL}/api/issues`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { projectId, ...data },
  });
  expect(res.ok(), `create issue failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as { id: string; key: string };
}

async function createSprint(
  request: APIRequestContext,
  token: string,
  projectId: string,
  name: string,
  state: 'ACTIVE' | 'COMPLETED',
): Promise<{ id: string }> {
  const res = await request.post(`${API_URL}/api/projects/${projectId}/sprints`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  expect(res.ok(), `create sprint failed: ${res.status()}`).toBeTruthy();
  const sprint = (await res.json()) as { id: string };
  const patch = await request.patch(`${API_URL}/api/sprints/${sprint.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { state },
  });
  expect(patch.ok(), `set sprint state failed: ${patch.status()}`).toBeTruthy();
  return sprint;
}

async function createDashboardApi(
  request: APIRequestContext,
  token: string,
  projectId: string,
  name: string,
): Promise<{ id: string }> {
  const res = await request.post(`${API_URL}/api/projects/${projectId}/dashboards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  expect(res.ok(), `create dashboard failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as { id: string };
}

async function createDashboard(page: Page, name: string): Promise<void> {
  await page.getByTestId('dashboard-create').first().click();
  const nameInput = page.getByTestId('dashboard-name-input');
  await nameInput.click();
  await nameInput.pressSequentially(name, { delay: 10 });
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page.getByTestId('dashboard-tab').filter({ hasText: name })).toBeVisible({
    timeout: 10_000,
  });
}

async function addGadget(
  page: Page,
  opts: {
    title: string;
    query: string;
    visualization?: 'STAT' | 'TABLE' | 'BREAKDOWN' | 'BURNDOWN' | 'VELOCITY_TREND';
    breakdownField?: string;
    sprints?: number;
  },
): Promise<void> {
  await page.getByTestId('gadget-add').first().click();
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5000 });

  const titleInput = modal.getByTestId('gadget-title-input');
  await titleInput.click();
  await titleInput.pressSequentially(opts.title, { delay: 10 });

  const queryInput = modal.getByTestId('gadget-query-input');
  await queryInput.click();
  if (opts.query) {
    await queryInput.pressSequentially(opts.query, { delay: 15 });
  }
  await queryInput.press('Tab');

  if (opts.visualization && opts.visualization !== 'STAT') {
    await modal.getByTestId('gadget-visualization-select').selectOption(opts.visualization);
  }
  if (opts.visualization === 'BREAKDOWN' && opts.breakdownField) {
    await modal.getByTestId('gadget-breakdown-field-select').selectOption(opts.breakdownField);
  }
  if (opts.visualization === 'VELOCITY_TREND' && opts.sprints !== undefined) {
    const sprintsInput = modal.getByTestId('gadget-sprints-input');
    await sprintsInput.fill(String(opts.sprints));
  }

  await modal.getByTestId('gadget-save').click();
  await expect(modal).toBeHidden({ timeout: 10_000 });
}

/** Titles of every default gadget seeded on a project's first dashboard. */
const DEFAULT_GADGET_TITLES = ['Open issues', 'Status overview', 'My open issues'];

/**
 * Real pointer drag of a gadget's drag handle onto a target card's center.
 * Playwright's own drag-and-drop helper uses native HTML5 DnD events, which
 * dnd-kit does NOT use (it listens on Pointer Events) — a real
 * `page.mouse` down/move-in-steps/up sequence is what actually exercises
 * dnd-kit's `PointerSensor` (the 5px `activationConstraint` needs genuine
 * incremental pointermove events, not a single teleport).
 *
 * Waits for the resulting `PATCH /gadgets/:id` to actually complete before
 * returning — the drop finishes with an OPTIMISTIC client-side reorder
 * (`useReorderGadget`'s `onMutate`), so a caller that asserts the new order
 * and then immediately reloads can otherwise race ahead of the real network
 * write and see the pre-drag order come back from the server.
 */
async function dragGadgetTo(page: Page, handle: Locator, targetCard: Locator): Promise<void> {
  const handleBox = await handle.boundingBox();
  const targetBox = await targetCard.boundingBox();
  if (!handleBox || !targetBox) throw new Error('dragGadgetTo: missing bounding box');
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  const patchResponse = page.waitForResponse(
    (res) => res.request().method() === 'PATCH' && /\/api\/gadgets\//.test(res.url()),
    { timeout: 10_000 },
  );

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      startX + ((endX - startX) * i) / steps,
      startY + ((endY - startY) * i) / steps,
    );
  }
  // A brief settle so React/dnd-kit process the final pointermove (collision
  // detection) before the pointerup finalizes the drop.
  await page.waitForTimeout(100);
  await page.mouse.up();

  await patchResponse;
}

// ---------------------------------------------------------------------------
// Desktop (1280px)
// ---------------------------------------------------------------------------

test.describe('Dashboards Phase 2', () => {
  // Pinned to the desktop viewport (not left to each Playwright project's
  // default): the drag-to-reorder test below hard-codes 2-column-grid
  // adjacency ("drag card 0 onto card 1" assumes they're side-by-side).
  // The single-column (mobile) drag case has its own dedicated test in the
  // "— mobile (393px)" describe block further down.
  test.use({ viewport: { width: 1280, height: 800 } });

  test('a VELOCITY_TREND gadget renders committed vs completed bars for real sprint data', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'dash-velocity-trend',
      projectName: 'Velocity Trend Test',
      openBoard: false,
    });

    const statuses = await getStatuses(request, ctx.token, ctx.project.id);
    const done = statuses.find((s) => s.category === 'DONE') ?? statuses[statuses.length - 1];

    const sprint1 = await createSprint(request, ctx.token, ctx.project.id, 'Sprint 1', 'COMPLETED');
    const sprint2 = await createSprint(request, ctx.token, ctx.project.id, 'Sprint 2', 'ACTIVE');

    await createIssueWith(request, ctx.token, ctx.project.id, {
      title: 'Completed work',
      sprintId: sprint1.id,
      storyPoints: 5,
      statusId: done.id,
    });
    await createIssueWith(request, ctx.token, ctx.project.id, {
      title: 'In-flight work',
      sprintId: sprint2.id,
      storyPoints: 3,
    });

    await page.goto(`/projects/${ctx.project.id}/dashboards`);
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });

    await createDashboard(page, 'Trend view');
    await addGadget(page, {
      title: 'Velocity trend',
      query: '',
      visualization: 'VELOCITY_TREND',
      sprints: 4,
    });

    const card = page.getByTestId('dashboard-gadget').filter({ hasText: 'Velocity trend' });
    await expect(card).toBeVisible({ timeout: 10_000 });
    // VelocityChart's <svg> carries a descriptive aria-label; presence proves
    // the gadget reused the real chart, not a bespoke renderer.
    await expect(
      card.getByRole('img', { name: /velocity chart/i }),
    ).toBeVisible({ timeout: 10_000 });
    // exact: true disambiguates the chart's axis-label <text> from the two
    // <title> tooltip elements ("Sprint 1 — committed 5" / "— completed 5").
    await expect(card.getByText('Sprint 1', { exact: true })).toBeVisible();
    await expect(card.getByText('Sprint 2', { exact: true })).toBeVisible();
  });

  test('a project’s first dashboard is pre-populated with 3 starter gadgets; the second starts empty', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'dash-defaults',
      projectName: 'Default Gadgets Test',
      openBoard: false,
    });

    await page.goto(`/projects/${ctx.project.id}/dashboards`);
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });

    await createDashboard(page, 'First dashboard');
    for (const title of DEFAULT_GADGET_TITLES) {
      // Exact `region` match on the gadget card's aria-label (== its title)
      // — "Open issues" is otherwise a substring of "My open issues" too.
      await expect(
        page.getByRole('region', { name: title, exact: true }),
      ).toBeVisible({ timeout: 10_000 });
    }
    await expect(page.getByTestId('dashboard-gadget')).toHaveCount(DEFAULT_GADGET_TITLES.length);

    await createDashboard(page, 'Second dashboard');
    await expect(page.getByText(/no gadgets yet/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('dashboard-gadget')).toHaveCount(0);
  });

  test('drag-to-reorder swaps two gadgets and persists across reload', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'dash-reorder',
      projectName: 'Reorder Test',
      openBoard: false,
    });
    const writes = trackApiWrites(page);

    await page.goto(`/projects/${ctx.project.id}/dashboards`);
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });
    await createDashboard(page, 'Reorder dashboard');

    // The first dashboard already has 3 default gadgets in a known order:
    // Open issues (0), Status overview (1), My open issues (2).
    const cards = page.getByTestId('dashboard-gadget');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText('Open issues');
    await expect(cards.nth(1)).toContainText('Status overview');

    // Drag the first gadget onto the second card's position.
    await dragGadgetTo(page, cards.nth(0).getByTestId('gadget-drag-handle'), cards.nth(1));

    // "Open issues" and "Status overview" should have swapped places.
    await expect(cards.nth(0)).toContainText('Status overview', { timeout: 10_000 });
    await expect(cards.nth(1)).toContainText('Open issues', { timeout: 10_000 });

    // The gadget reorder is optimistic (`useReorderGadget`'s `onMutate`), so
    // the swap above proves nothing about the server. Wait for the PATCHes to
    // be acknowledged before reloading, or the reload can abort them and the
    // "persists server-side" assertion below becomes a coin flip.
    await writes.settle({
      match: (w) => w.method === 'PATCH' && /^\/api\/gadgets\/[^/]+$/.test(w.path),
      atLeast: 1,
    });

    // Persists server-side, not just an optimistic client reorder.
    await page.reload();
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });
    const cardsAfterReload = page.getByTestId('dashboard-gadget');
    await expect(cardsAfterReload).toHaveCount(3);
    await expect(cardsAfterReload.nth(0)).toContainText('Status overview');
    await expect(cardsAfterReload.nth(1)).toContainText('Open issues');
  });

  test('cross-workspace gadget scoping: a deep-linked project in the NON-active workspace still resolves correctly', async ({
    page,
    request,
  }) => {
    const owner = await registerNewUser(request, 'dash-multiws');
    // Registration does NOT auto-create a workspace server-side (that only
    // happens client-side, lazily, the first time the Pulse page loads) —
    // create both explicitly so this user is unambiguously a member of two.
    const workspace1 = await createWorkspace(request, owner.token, `WS1-${owner.userId}`);
    const workspace2 = await createWorkspace(request, owner.token, `WS2-${owner.userId}`);

    const project1 = await createProject(request, owner.token, workspace1, {
      name: 'Workspace One Project',
    });
    const project2 = await createProject(request, owner.token, workspace2, {
      name: 'Workspace Two Project',
    });

    const dash1 = await createDashboardApi(request, owner.token, project1.id, 'WS1 dashboard');
    const dash2 = await createDashboardApi(request, owner.token, project2.id, 'WS2 dashboard');
    await request.post(`${API_URL}/api/dashboards/${dash1.id}/gadgets`, {
      headers: { Authorization: `Bearer ${owner.token}` },
      data: { title: 'WS1 gadget', query: '', visualization: 'STAT' },
    });
    await request.post(`${API_URL}/api/dashboards/${dash2.id}/gadgets`, {
      headers: { Authorization: `Bearer ${owner.token}` },
      data: { title: 'WS2 gadget', query: '', visualization: 'STAT' },
    });

    await page.goto('/login');
    await page.getByLabel(/email/i).fill(owner.email);
    await page.getByLabel(/password/i).fill(owner.password);
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    // Explicitly set the ACTIVE workspace to workspace1 via the home page's
    // workspace selector (workspace2's project below must still resolve
    // correctly even though it's not the active one).
    await page.goto('/');
    await expect(page.getByTestId('pulse-dashboard')).toBeVisible({ timeout: 15_000 });
    await page.locator('#pulse-ws-select').selectOption(workspace1);
    await expect(page.locator('#pulse-ws-select')).toHaveValue(workspace1);

    // Deep-link straight into workspace2's project dashboard — the
    // project-derived workspace must win over the stale "active" selection.
    await page.goto(`/projects/${project2.id}/dashboards`);
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId('dashboard-tab').filter({ hasText: 'WS2 dashboard' }),
    ).toBeVisible({ timeout: 10_000 });
    // No leakage: workspace1's dashboard name never appears on workspace2's project.
    await expect(page.getByTestId('dashboard-tab').filter({ hasText: 'WS1 dashboard' })).toHaveCount(0);
    await expect(
      page.getByTestId('dashboard-gadget').filter({ hasText: 'WS2 gadget' }),
    ).toBeVisible({ timeout: 10_000 });
    // The user is workspace2's ADMIN too (same owner) — write affordances
    // must be present, proving editability was resolved from the PROJECT's
    // own workspace, not the unrelated "active" one.
    await expect(page.getByTestId('gadget-add')).toBeVisible();

    // And workspace1's own project still resolves correctly on its own deep link.
    await page.goto(`/projects/${project1.id}/dashboards`);
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId('dashboard-tab').filter({ hasText: 'WS1 dashboard' }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByTestId('dashboard-gadget').filter({ hasText: 'WS1 gadget' }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Mobile (393px)
// ---------------------------------------------------------------------------

test.describe('Dashboards Phase 2 — mobile (393px)', () => {
  test.use({ viewport: { width: 393, height: 851 } });

  test('VELOCITY_TREND gadget renders on a real phone with no horizontal overflow', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'dash-velocity-mobile',
      projectName: 'Velocity Trend Mobile Test',
      openBoard: false,
    });

    const sprint1 = await createSprint(request, ctx.token, ctx.project.id, 'Sprint A', 'ACTIVE');
    await createIssueWith(request, ctx.token, ctx.project.id, {
      title: 'Mobile sprint issue',
      sprintId: sprint1.id,
      storyPoints: 2,
    });

    await page.goto(`/projects/${ctx.project.id}/dashboards`);
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });
    await createDashboard(page, 'Mobile trend');
    await addGadget(page, {
      title: 'Trend',
      query: '',
      visualization: 'VELOCITY_TREND',
    });

    const card = page.getByTestId('dashboard-gadget').filter({ hasText: 'Trend' });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText('Sprint A', { exact: true })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('drag-to-reorder (single-column layout) swaps two gadgets and persists', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'dash-reorder-mobile',
      projectName: 'Reorder Mobile Test',
      openBoard: false,
    });
    const writes = trackApiWrites(page);

    await page.goto(`/projects/${ctx.project.id}/dashboards`);
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });
    await createDashboard(page, 'Reorder dashboard');

    const cards = page.getByTestId('dashboard-gadget');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText('Open issues');
    await expect(cards.nth(1)).toContainText('Status overview');

    // Single-column layout at 393px — drag the first card onto the second.
    await dragGadgetTo(page, cards.nth(0).getByTestId('gadget-drag-handle'), cards.nth(1));

    await expect(cards.nth(0)).toContainText('Status overview', { timeout: 10_000 });
    await expect(cards.nth(1)).toContainText('Open issues', { timeout: 10_000 });

    // The gadget reorder is optimistic (`useReorderGadget`'s `onMutate`), so
    // the swap above proves nothing about the server. Wait for the PATCHes to
    // be acknowledged before reloading, or the reload can abort them and the
    // "persists server-side" assertion below becomes a coin flip.
    await writes.settle({
      match: (w) => w.method === 'PATCH' && /^\/api\/gadgets\/[^/]+$/.test(w.path),
      atLeast: 1,
    });

    await page.reload();
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });
    const cardsAfterReload = page.getByTestId('dashboard-gadget');
    await expect(cardsAfterReload.nth(0)).toContainText('Status overview');
    await expect(cardsAfterReload.nth(1)).toContainText('Open issues');
  });
});

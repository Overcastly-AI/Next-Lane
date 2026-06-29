/**
 * workflow-graph.spec.ts
 *
 * End-to-end tests for the visual workflow graph editor.
 *
 * Desktop:
 *  - Open a workflow (created from 'simple' template), switch to Graph view,
 *    assert nodes render for each status.
 *  - Create a new transition via connect handles; assert it appears as an edge
 *    (and verify via the workflow API).
 *  - Delete an edge via the (×) affordance.
 *
 * Mobile (390px):
 *  - Graph view renders without horizontal page overflow (it may scroll
 *    WITHIN the contained box, but the page itself must not overflow).
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupIsolatedProject, API_URL } from './helpers';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function getStatuses(
  request: APIRequestContext,
  token: string,
  projectId: string,
) {
  const res = await request.get(
    `${API_URL}/api/projects/${projectId}/statuses`,
    { headers: auth(token) },
  );
  expect(res.ok(), `getStatuses failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as Array<{
    id: string;
    name: string;
    category: string;
  }>;
}

/** Create a named workflow from the 'simple' template; returns its id. */
async function createSimpleWorkflow(
  request: APIRequestContext,
  token: string,
  projectId: string,
): Promise<string> {
  const res = await request.post(
    `${API_URL}/api/projects/${projectId}/workflows/from-template`,
    { headers: auth(token), data: { template: 'simple' } },
  );
  expect(res.ok(), `create workflow failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

/** Fetch a workflow's transitions from the API. */
async function getWorkflowTransitions(
  request: APIRequestContext,
  token: string,
  workflowId: string,
): Promise<Array<{ id: string; fromStatusId: string | null; toStatusId: string }>> {
  const res = await request.get(`${API_URL}/api/workflows/${workflowId}`, {
    headers: auth(token),
  });
  expect(res.ok(), `getWorkflow failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { transitions?: Array<{ id: string; fromStatusId: string | null; toStatusId: string }> };
  return body.transitions ?? [];
}

// ---------------------------------------------------------------------------
// Helper: open Settings → Workflows, expand the workflow, switch to Graph view
// ---------------------------------------------------------------------------

async function openGraphView(page: import('@playwright/test').Page, projectId: string) {
  await page.goto(`/projects/${projectId}/settings`);

  // Scroll to the workflows manager.
  const manager = page.getByTestId('workflows-manager');
  await manager.scrollIntoViewIfNeeded();
  await expect(manager).toBeVisible({ timeout: 15_000 });

  // Click the workflow row to expand it.
  const row = page.getByTestId('workflow-row').first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();

  // Wait for the detail panel (enforce toggle is a reliable signal).
  await expect(page.getByTestId('workflow-enforce-toggle-2')).toBeVisible({
    timeout: 8_000,
  });

  // Switch to Graph view.
  const toggle = page.getByTestId('workflow-graph-toggle');
  await expect(toggle).toBeVisible({ timeout: 5_000 });
  await toggle.getByRole('radio', { name: /graph/i }).click();

  // The graph SVG should now appear.
  await expect(page.getByTestId('workflow-graph')).toBeVisible({ timeout: 8_000 });
}

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

test.describe('Workflow graph editor — desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('switch to Graph view and assert status nodes render', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'wg-nodes',
      openBoard: false,
    });

    await createSimpleWorkflow(request, ctx.token, ctx.project.id);

    // Open graph view.
    await openGraphView(page, ctx.project.id);

    // The Start node should be present.
    await expect(page.getByTestId('workflow-graph-node-start')).toBeVisible({
      timeout: 5_000,
    });

    // Each project status should have a corresponding node.
    const statuses = await getStatuses(request, ctx.token, ctx.project.id);
    expect(statuses.length).toBeGreaterThan(0);
    for (const s of statuses) {
      await expect(page.getByTestId(`workflow-graph-node-${s.id}`)).toBeVisible({
        timeout: 5_000,
      });
    }
  });

  test('create a new transition via connect handles', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'wg-create',
      openBoard: false,
    });

    await createSimpleWorkflow(request, ctx.token, ctx.project.id);

    const statuses = await getStatuses(request, ctx.token, ctx.project.id);
    // We need two distinct statuses to create a transition.
    expect(statuses.length).toBeGreaterThanOrEqual(2);

    await openGraphView(page, ctx.project.id);

    // Get the workflow id from the API so we can verify later.
    const wfListRes = await request.get(
      `${API_URL}/api/projects/${ctx.project.id}/workflows`,
      { headers: auth(ctx.token) },
    );
    const wfList = (await wfListRes.json()) as Array<{ id: string }>;
    const workflowId = wfList[0].id;

    // Count existing transitions.
    const before = await getWorkflowTransitions(request, ctx.token, workflowId);
    const beforeCount = before.length;

    // Find a pair of statuses that don't yet have a transition.
    // We'll use the Start node → last status (DONE).
    const doneStatus = statuses.find((s) => s.category === 'DONE');
    expect(doneStatus, 'Expected a DONE status').toBeTruthy();
    if (!doneStatus) return;

    // Click the "+" handle on the Start node.
    // Use JS evaluate to bypass any SVG foreignObject click quirks.
    const startHandle = page.getByTestId('workflow-graph-connect-start');
    await expect(startHandle).toBeAttached({ timeout: 5_000 });
    await startHandle.evaluate((el) => (el as HTMLElement).click());

    // The connecting-mode hint should appear (shows "Click a target node..." text).
    await expect(page.getByRole('status')).toContainText(/click a target node/i, {
      timeout: 5_000,
    });

    // Click the target status node's connect handle.
    // Use JS evaluate to bypass any SVG foreignObject click quirks.
    const targetHandle = page.getByTestId(
      `workflow-graph-connect-${doneStatus.id}`,
    );
    await expect(targetHandle).toBeAttached({ timeout: 5_000 });
    await targetHandle.evaluate((el) => (el as HTMLElement).click());

    // A success toast should appear (success toasts use role="status").
    await expect(page.getByRole('status')).toContainText(
      /transition added/i,
      { timeout: 10_000 },
    );

    // Verify the transition appears as an edge in the graph.
    // The edge id is workflow-graph-edge-__start__-<toId> or similar.
    const edgeLocator = page.getByTestId(
      `workflow-graph-edge-__start__-${doneStatus.id}`,
    );
    await expect(edgeLocator).toBeVisible({ timeout: 8_000 });

    // Also verify via API.
    const after = await getWorkflowTransitions(request, ctx.token, workflowId);
    expect(after.length).toBeGreaterThan(beforeCount);
    const newTrans = after.find(
      (t) => t.fromStatusId === null && t.toStatusId === doneStatus.id,
    );
    expect(newTrans, 'Expected new transition in API').toBeTruthy();
  });

  test('delete an edge via the (×) affordance', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'wg-delete',
      openBoard: false,
    });

    const workflowId = await createSimpleWorkflow(
      request,
      ctx.token,
      ctx.project.id,
    );

    await openGraphView(page, ctx.project.id);

    // There should be at least one edge from the 'simple' template.
    const edges = page.getByTestId(/^workflow-graph-edge-/);
    await expect(edges.first()).toBeVisible({ timeout: 8_000 });

    const before = await getWorkflowTransitions(request, ctx.token, workflowId);
    expect(before.length).toBeGreaterThan(0);

    // Hover over the first edge path to trigger hover state.
    // We use mouse.move to the center of the SVG edge element.
    await edges.first().hover({ force: true });

    // The delete button (×) is always in the DOM for admins.
    // Click it with force to bypass opacity-0 visibility check.
    const deleteBtn = page.getByTestId('workflow-graph-edge-delete').first();
    await expect(deleteBtn).toBeAttached({ timeout: 5_000 });

    // Use JS click to bypass SVG foreignObject click limitations.
    await deleteBtn.evaluate((el) => (el as HTMLElement).click());

    // Confirm the dialog (ConfirmDialog uses role="alertdialog").
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByRole('button', { name: /delete/i }).click();

    // Success toast (success toasts use role="status").
    await expect(page.getByRole('status')).toContainText(
      /transition deleted/i,
      { timeout: 10_000 },
    );

    // Verify via API.
    const after = await getWorkflowTransitions(request, ctx.token, workflowId);
    expect(after.length).toBeLessThan(before.length);
  });
});

// ---------------------------------------------------------------------------
// Mobile — no horizontal page overflow
// ---------------------------------------------------------------------------

test.describe('Workflow graph editor — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('graph view renders without horizontal page overflow', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'wg-mob',
      openBoard: false,
    });

    await createSimpleWorkflow(request, ctx.token, ctx.project.id);

    await openGraphView(page, ctx.project.id);

    // Verify no horizontal overflow on the document root.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

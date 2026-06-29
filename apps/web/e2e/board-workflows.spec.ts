/**
 * board-workflows.spec.ts
 *
 * End-to-end tests for the per-board named workflows feature:
 *
 *  Desktop:
 *   - Admin creates a workflow from the 'simple' template in Settings.
 *   - The workflow appears in the list with a transition count.
 *   - Admin assigns the workflow to a board and the board header shows the badge.
 *   - (Optional) An illegal move on an enforced workflow surfaces the 422 toast.
 *
 *  Mobile (390px):
 *   - The workflows manager renders without horizontal page overflow.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupIsolatedProject, API_URL } from './helpers';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Fetch project statuses via API. */
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

// ---------------------------------------------------------------------------
// Desktop — main flow
// ---------------------------------------------------------------------------

test.describe('Per-board named workflows — Settings (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('create workflow from template → appears in list with transition count', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'bwf-create',
      openBoard: false,
    });
    await page.goto(`/projects/${ctx.project.id}/settings`);

    // Scroll to the workflows manager section.
    const manager = page.getByTestId('workflows-manager');
    await manager.scrollIntoViewIfNeeded();
    await expect(manager).toBeVisible({ timeout: 15_000 });

    // Click "From template".
    await page.getByTestId('workflow-from-template').click();

    // The from-template modal opens; 'simple' is already selected by default.
    // Submit — scope to the dialog to avoid ambiguity with other "Create" buttons.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    // Wait for the modal to close and a workflow row to appear.
    await expect(page.getByTestId('workflow-row').first()).toBeVisible({
      timeout: 10_000,
    });

    // The row should show at least 1 transition count (simple template seeds transitions).
    // We just assert a row exists with text that looks like transition info.
    const rowText = await page.getByTestId('workflow-row').first().textContent();
    expect(rowText).toBeTruthy();
    // Should include "transition" (0 transitions or more)
    expect(rowText).toMatch(/transition/i);
  });

  test('assign workflow to board → board header shows workflow badge', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'bwf-assign',
      openBoard: false,
    });

    // Create a workflow from template via API (faster setup).
    const wfRes = await request.post(
      `${API_URL}/api/projects/${ctx.project.id}/workflows/from-template`,
      { headers: auth(ctx.token), data: { template: 'simple' } },
    );
    expect(wfRes.ok(), `create workflow failed: ${wfRes.status()}`).toBeTruthy();
    const workflow = (await wfRes.json()) as { id: string; name: string };

    // Navigate to the board.
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });

    // The board-workflow-select should be visible (admin, no workflow assigned yet).
    const select = page.getByTestId('board-workflow-select');
    await expect(select).toBeVisible({ timeout: 8_000 });

    // Assign the workflow.
    await select.selectOption(workflow.id);

    // The board-workflow-badge should appear.
    await expect(page.getByTestId('board-workflow-badge')).toBeVisible({
      timeout: 8_000,
    });
    // The badge names the active workflow (icon + name, optional ENFORCED chip).
    await expect(page.getByTestId('board-workflow-badge')).toContainText(
      workflow.name,
    );
  });

  test('enforced workflow blocks illegal board move with 422 toast', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'bwf-enf',
      openBoard: false,
    });

    const statuses = await getStatuses(request, ctx.token, ctx.project.id);
    const todo = statuses.find((s) => s.category === 'TODO')!;
    const done = statuses.find((s) => s.category === 'DONE')!;
    const inProg = statuses.find((s) => s.category === 'IN_PROGRESS')!;

    // Create a named workflow with enforced=true and a single transition:
    // only TODO → In Progress is allowed (no TODO → Done).
    const wfRes = await request.post(
      `${API_URL}/api/projects/${ctx.project.id}/workflows`,
      {
        headers: auth(ctx.token),
        data: { name: 'Strict', enforced: true },
      },
    );
    expect(wfRes.ok(), `create wf failed: ${wfRes.status()}`).toBeTruthy();
    const wf = (await wfRes.json()) as { id: string };

    // Add only the TODO → In Progress transition.
    const tRes = await request.post(
      `${API_URL}/api/workflows/${wf.id}/transitions`,
      {
        headers: auth(ctx.token),
        data: { fromStatusId: todo.id, toStatusId: inProg.id },
      },
    );
    expect(tRes.ok(), `add transition failed: ${tRes.status()}`).toBeTruthy();

    // Get the default board id.
    const boardsRes = await request.get(
      `${API_URL}/api/projects/${ctx.project.id}/boards`,
      { headers: auth(ctx.token) },
    );
    expect(boardsRes.ok()).toBeTruthy();
    const boards = (await boardsRes.json()) as Array<{ id: string; isDefault: boolean }>;
    const defaultBoard = boards.find((b) => b.isDefault) ?? boards[0];

    // Assign the workflow to the default board via API.
    const assignRes = await request.patch(
      `${API_URL}/api/boards/${defaultBoard.id}`,
      { headers: auth(ctx.token), data: { workflowId: wf.id } },
    );
    expect(assignRes.ok(), `assign wf failed: ${assignRes.status()}`).toBeTruthy();

    // Create an issue in TODO.
    const issueRes = await request.post(`${API_URL}/api/issues`, {
      headers: auth(ctx.token),
      data: { projectId: ctx.project.id, title: 'Blocked issue' },
    });
    expect(issueRes.ok()).toBeTruthy();

    // Navigate to the board.
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Badge should now be visible since the workflow is assigned.
    await expect(page.getByTestId('board-workflow-badge')).toBeVisible({
      timeout: 5_000,
    });

    // Attempt illegal TODO → Done move via inline card status picker.
    await page.getByTestId('card-status-trigger').first().click();
    await expect(page.getByTestId('card-status-menu').first()).toBeVisible();
    await page.getByTestId(`card-status-option-${done.id}`).click();

    // Should see an error toast (422).
    await expect(page.getByRole('alert')).toContainText(
      /not allowed|allowed next status/i,
      { timeout: 10_000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Mobile — no horizontal overflow
// ---------------------------------------------------------------------------

test.describe('Per-board named workflows — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('workflows manager renders without horizontal overflow', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'bwf-mob',
      openBoard: false,
    });

    await page.goto(`/projects/${ctx.project.id}/settings`);
    await expect(page.getByTestId('workflows-manager')).toBeVisible({
      timeout: 15_000,
    });

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

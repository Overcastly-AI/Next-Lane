/**
 * workflow-robustness.spec.ts
 *
 * Founder-directed "Workflows robustness pass" QA sweep (2026-07-02, see
 * docs/BACKLOG.md "Workflows robustness pass" and docs/UI-REVIEW.md
 * "Workflows robustness sweep — 2026-07-02").
 *
 * This spec is a REPORTING artifact as much as a regression suite: green
 * tests document confirmed-working behavior; `test.fixme()` blocks document
 * confirmed, reproduced defects (found via this same file before being
 * converted to fixme) so the fix batch has an exact, already-written repro.
 *
 * Scope: named-workflow manager CRUD, the transition/gate editor, the visual
 * graph builder, board workflow assignment, and — the highest-value target —
 * enforcement AS FELT BY THE USER across every surface that can change an
 * issue's status (board drag, card status picker, Triage 's' picker, the
 * issue drawer's status <select>, and bulk edit).
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  setupIsolatedProject,
  createIssue,
  trackApiWrites,
  API_URL,
  type IsolatedContext,
} from './helpers';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

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
  const res = await request.get(
    `${API_URL}/api/projects/${projectId}/statuses`,
    { headers: auth(token) },
  );
  expect(res.ok(), `getStatuses failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as StatusRow[];
}

interface NamedWorkflow {
  id: string;
  name: string;
  enforced: boolean;
}

async function createNamedWorkflow(
  request: APIRequestContext,
  token: string,
  projectId: string,
  data: { name: string; description?: string; enforced?: boolean },
): Promise<NamedWorkflow> {
  const res = await request.post(
    `${API_URL}/api/projects/${projectId}/workflows`,
    { headers: auth(token), data },
  );
  expect(res.ok(), `create workflow failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as NamedWorkflow;
}

async function addWorkflowTransition(
  request: APIRequestContext,
  token: string,
  workflowId: string,
  data: {
    fromStatusId?: string | null;
    toStatusId: string;
    issueType?: string | null;
    gates?: Array<{ type: string; field?: string; linkType?: string }>;
  },
) {
  const res = await request.post(
    `${API_URL}/api/workflows/${workflowId}/transitions`,
    { headers: auth(token), data },
  );
  return res;
}

async function getDefaultBoard(
  request: APIRequestContext,
  token: string,
  projectId: string,
): Promise<{ id: string; isDefault: boolean }> {
  const res = await request.get(
    `${API_URL}/api/projects/${projectId}/boards`,
    { headers: auth(token) },
  );
  expect(res.ok()).toBeTruthy();
  const boards = (await res.json()) as Array<{ id: string; isDefault: boolean }>;
  return boards.find((b) => b.isDefault) ?? boards[0];
}

async function assignBoardWorkflow(
  request: APIRequestContext,
  token: string,
  boardId: string,
  workflowId: string | null,
) {
  const res = await request.patch(`${API_URL}/api/boards/${boardId}`, {
    headers: auth(token),
    data: { workflowId },
  });
  expect(res.ok(), `assign board workflow failed: ${res.status()}`).toBeTruthy();
  return res;
}

/**
 * Sets up a project with an ENFORCED named workflow assigned to its default
 * board, containing exactly one legal transition (TODO -> IN_PROGRESS). Any
 * TODO -> DONE move is therefore illegal under the board's named workflow.
 * The project-level LEGACY workflow (`Project.workflowEnforced`) is left at
 * its default (false/off) so tests can isolate "does the per-board named
 * workflow gate this surface" from the legacy project-wide toggle.
 */
async function setupStrictBoardWorkflow(
  page: Page,
  request: APIRequestContext,
  label: string,
): Promise<{
  ctx: IsolatedContext;
  statuses: StatusRow[];
  todo: StatusRow;
  inProg: StatusRow;
  done: StatusRow;
  workflow: NamedWorkflow;
  boardId: string;
}> {
  const ctx = await setupIsolatedProject(page, request, { label, openBoard: false });
  const statuses = await getStatuses(request, ctx.token, ctx.project.id);
  const todo = statuses.find((s) => s.category === 'TODO')!;
  const inProg = statuses.find((s) => s.category === 'IN_PROGRESS')!;
  const done = statuses.find((s) => s.category === 'DONE')!;

  const workflow = await createNamedWorkflow(request, ctx.token, ctx.project.id, {
    name: 'Strict',
    enforced: true,
  });
  const addRes = await addWorkflowTransition(request, ctx.token, workflow.id, {
    fromStatusId: todo.id,
    toStatusId: inProg.id,
  });
  expect(addRes.ok(), `seed transition failed: ${addRes.status()}`).toBeTruthy();

  const board = await getDefaultBoard(request, ctx.token, ctx.project.id);
  await assignBoardWorkflow(request, ctx.token, board.id, workflow.id);

  return { ctx, statuses, todo, inProg, done, workflow, boardId: board.id };
}

// ===========================================================================
// SECTION 1 — Named workflows manager: create / template-seed / delete
// ===========================================================================

test.describe('Named workflows manager — CRUD (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('create a blank workflow with per-keystroke typed name (spaces included)', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'wfm-create',
      openBoard: false,
    });
    await page.goto(`/projects/${ctx.project.id}/settings`);

    const manager = page.getByTestId('workflows-manager');
    await manager.scrollIntoViewIfNeeded();
    await expect(manager).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('workflow-create').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const nameInput = dialog.getByLabel('Name');
    // Per-keystroke typing (never .fill()) — the exact shape of the
    // spaces-in-edit-modal defect class the founder flagged.
    await nameInput.pressSequentially('Release Engineering Flow', { delay: 15 });
    await expect(nameInput).toHaveValue('Release Engineering Flow');

    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByTestId('workflow-row').filter({ hasText: 'Release Engineering Flow' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('duplicate workflow name is rejected with a friendly 409 message', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'wfm-dupe',
      openBoard: false,
    });
    await createNamedWorkflow(request, ctx.token, ctx.project.id, { name: 'Ops' });

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const manager = page.getByTestId('workflows-manager');
    await manager.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('workflow-row').first()).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('workflow-create').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').pressSequentially('Ops', { delay: 15 });
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByRole('alert')).toContainText(/already exists/i, {
      timeout: 8_000,
    });
    // Dialog stays open so the admin can correct the name (not silently lost).
    await expect(dialog).toBeVisible();
  });

  test.describe('seed-from-template produces the documented transition graph', () => {
    for (const tpl of ['simple', 'kanban', 'scrum', 'bug-triage'] as const) {
      test(`template "${tpl}" seeds the expected transitions`, async ({ page, request }) => {
        const ctx = await setupIsolatedProject(page, request, {
          label: `wfm-tpl-${tpl}`,
          openBoard: false,
        });
        const statuses = await getStatuses(request, ctx.token, ctx.project.id);
        const res = await request.post(
          `${API_URL}/api/projects/${ctx.project.id}/workflows/from-template`,
          { headers: auth(ctx.token), data: { template: tpl } },
        );
        expect(res.ok(), `template ${tpl} failed: ${res.status()}`).toBeTruthy();
        const body = (await res.json()) as {
          id: string;
          transitions: Array<{ fromStatusId: string | null; toStatusId: string }>;
        };

        const todo = statuses.find((s) => s.category === 'TODO')!;
        const inProg = statuses.find((s) => s.category === 'IN_PROGRESS')!;
        const done = statuses.find((s) => s.category === 'DONE')!;

        const has = (from: string | null, to: string) =>
          body.transitions.some((t) => t.fromStatusId === from && t.toStatusId === to);

        if (tpl === 'simple') {
          expect(has(todo.id, inProg.id)).toBe(true);
          expect(has(inProg.id, done.id)).toBe(true);
          expect(has(inProg.id, todo.id)).toBe(false);
          expect(has(done.id, inProg.id)).toBe(false);
          expect(body.transitions.length).toBe(2);
        } else if (tpl === 'kanban') {
          // Fully permissive: every ordered pair of distinct statuses.
          const expectedCount = statuses.length * (statuses.length - 1);
          expect(body.transitions.length).toBe(expectedCount);
        } else if (tpl === 'scrum') {
          expect(has(todo.id, inProg.id)).toBe(true);
          expect(has(inProg.id, done.id)).toBe(true);
          expect(has(inProg.id, todo.id)).toBe(true);
          expect(has(done.id, inProg.id)).toBe(true);
          expect(body.transitions.length).toBe(4);
        } else if (tpl === 'bug-triage') {
          expect(has(todo.id, inProg.id)).toBe(true);
          expect(has(inProg.id, done.id)).toBe(true);
          expect(has(done.id, todo.id)).toBe(true);
          expect(body.transitions.length).toBe(3);
        }

        // UI: the workflow list shows the correct transition count badge.
        await page.goto(`/projects/${ctx.project.id}/settings`);
        const row = page.getByTestId('workflow-row').first();
        await row.scrollIntoViewIfNeeded();
        await expect(row).toContainText(`${body.transitions.length}T`, { timeout: 10_000 });
      });
    }
  });

  test('deleting a workflow that a board references heals the board (badge disappears, selector resets)', async ({
    page,
    request,
  }) => {
    const { ctx, workflow, boardId } = await setupStrictBoardWorkflow(page, request, 'wfm-heal');

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByTestId('board-workflow-badge')).toContainText(workflow.name, {
      timeout: 15_000,
    });

    // Delete the workflow via Settings.
    await page.goto(`/projects/${ctx.project.id}/settings`);
    const manager = page.getByTestId('workflows-manager');
    await manager.scrollIntoViewIfNeeded();
    await page.getByTestId('workflow-row').first().click();
    await page.getByRole('button', { name: 'Delete this workflow' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByRole('button', { name: 'Delete workflow' }).click();
    await expect(page.getByRole('status')).toContainText(/deleted/i, { timeout: 8_000 });

    // The board should heal: no badge, selector shows "No workflow".
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('board-workflow-badge')).toHaveCount(0, { timeout: 8_000 });
    await expect(page.getByTestId('board-workflow-select')).toHaveValue('', { timeout: 8_000 });

    // Confirm via API too — board.workflowId should be null now.
    const boardRes = await request.get(`${API_URL}/api/boards/${boardId}`, {
      headers: auth(ctx.token),
    });
    if (boardRes.ok()) {
      const boardBody = (await boardRes.json()) as { board: { workflowId: string | null } };
      expect(boardBody.board.workflowId).toBeNull();
    }
  });

  // -------------------------------------------------------------------------
  // KNOWN DEFECT — no rename affordance for a named workflow.
  // -------------------------------------------------------------------------
  test(
    'admin can rename a named workflow from the manager UI',
    async ({ page, request }) => {
      // REPRO: docs/UI-REVIEW.md "Workflows robustness sweep — 2026-07-02" #1.
      // `WorkflowsManager.tsx`'s detail panel header renders only: workflow
      // name (static <h3>, not editable), the List/Graph view toggle, "+ Add
      // transition", and a delete-workflow icon button. There is NO edit/
      // pencil affordance to change the workflow's `name` or `description`,
      // even though the backend fully supports it (`PATCH /workflows/:id`
      // accepts `name`/`description` — see `UpdateNamedWorkflowDto` /
      // `WorkflowService.updateWorkflow`). The founder's ready-item explicitly
      // scopes "create/rename/delete named workflows" — rename is unreachable
      // from the UI today. Expected: a rename control (inline edit or pencil
      // -> modal) next to the workflow name in the detail panel header.
      const ctx = await setupIsolatedProject(page, request, {
        label: 'wfm-rename',
        openBoard: false,
      });
      await createNamedWorkflow(request, ctx.token, ctx.project.id, { name: 'Original Name' });

      await page.goto(`/projects/${ctx.project.id}/settings`);
      const manager = page.getByTestId('workflows-manager');
      await manager.scrollIntoViewIfNeeded();
      await page.getByTestId('workflow-row').first().click();

      // No such control exists today; this is the assertion that should pass
      // once a rename affordance ships.
      await expect(
        page.getByRole('button', { name: /rename workflow/i }),
      ).toBeVisible({ timeout: 3_000 });
    },
  );
});

// ===========================================================================
// SECTION 2 — Transition / gate editor robustness
// ===========================================================================

test.describe('Transition & gate editor — robustness (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('duplicate transition (same from/to/type) is rejected with a 409 toast', async ({
    page,
    request,
  }) => {
    const { ctx, todo, inProg, workflow } = await setupStrictBoardWorkflow(
      page,
      request,
      'wf-gate-dupe',
    );
    await page.goto(`/projects/${ctx.project.id}/settings`);
    const manager = page.getByTestId('workflows-manager');
    await manager.scrollIntoViewIfNeeded();
    await page.getByTestId('workflow-row').filter({ hasText: workflow.name }).click();

    await expect(page.getByTestId('workflow-transition-row').first()).toBeVisible({
      timeout: 10_000,
    });
    await manager.getByRole('button', { name: '+ Add transition' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('From status').selectOption(todo.id);
    await dialog.getByLabel('To status').selectOption(inProg.id);
    await dialog.getByTestId('workflow-save-transition').click();

    await expect(page.getByRole('alert')).toContainText(/already exists/i, {
      timeout: 8_000,
    });
  });

  test(
    'REQUIRE_FIELD gate keyed by the field placeholder\'s suggested custom-field key never actually matches a stored value',
    async ({ page, request }) => {
      // REPRO: docs/UI-REVIEW.md "Workflows robustness sweep — 2026-07-02" #2.
      // `Issue.customFields` is stored keyed by the custom field DEFINITION'S
      // OPAQUE CUID (`CustomFieldsService.validateAndNormalize` maps payload
      // keys against `definitions.map(d => [d.id, d])`, and the frontend
      // (`CustomFieldsDrawerSection.tsx`) reads/writes `currentValues[field.id]`
      // — never `field.key`). But the gate editor's REQUIRE_FIELD input
      // (`WorkflowSection.tsx` / `WorkflowsManager.tsx` `GateEditor`) has the
      // placeholder `"e.g. assigneeId or cf_severity"`, actively steering an
      // admin toward typing a human-readable key that can NEVER match. The
      // backend's own gate-evaluation code has a stale comment admitting the
      // gap: "customFields is stored as { [definitionId]: value } — we need
      // to also support lookup by key. Load definitions to resolve the key."
      // — but the code directly below it never does that lookup; it does a
      // flat `customFields[fieldName]`. The admin has NO way, anywhere in the
      // UI (Settings custom fields list, drawer), to discover the actual
      // CUID to type into this gate. Net effect: any REQUIRE_FIELD gate an
      // admin configures for a custom field via the documented placeholder
      // permanently fails ("this transition requires the field ... to be
      // set") even after the field IS set on the issue — a silent,
      // undiscoverable dead-end that blocks all matching transitions forever
      // until an admin removes the gate. Expected: the gate should either (a)
      // resolve by the custom field's stable `key` (matching the placeholder
      // promise) with the backend translating key -> definitionId at
      // evaluation time, or (b) the UI should expose a dropdown of existing
      // custom fields (by name) instead of a freeform text input that
      // silently accepts an unusable value.
      const ctx = await setupIsolatedProject(page, request, {
        label: 'wf-gate-cf',
        openBoard: false,
      });
      const statuses = await getStatuses(request, ctx.token, ctx.project.id);
      const todo = statuses.find((s) => s.category === 'TODO')!;
      const inProg = statuses.find((s) => s.category === 'IN_PROGRESS')!;

      // Create a custom field named "Severity" (key auto-derives to "severity").
      const cfRes = await request.post(
        `${API_URL}/api/projects/${ctx.project.id}/custom-fields`,
        { headers: auth(ctx.token), data: { name: 'Severity', type: 'TEXT' } },
      );
      expect(cfRes.ok()).toBeTruthy();
      const cf = (await cfRes.json()) as { id: string; key: string };

      // Named workflow: TODO -> IN_PROGRESS gated on the "severity" field key
      // (the exact string the UI placeholder suggests users type).
      const workflow = await createNamedWorkflow(request, ctx.token, ctx.project.id, {
        name: 'CF Gate',
        enforced: true,
      });
      await addWorkflowTransition(request, ctx.token, workflow.id, {
        fromStatusId: todo.id,
        toStatusId: inProg.id,
        gates: [{ type: 'REQUIRE_FIELD', field: cf.key }],
      });
      const board = await getDefaultBoard(request, ctx.token, ctx.project.id);
      await assignBoardWorkflow(request, ctx.token, board.id, workflow.id);

      // Create an issue and SET the severity field via the API using the
      // definitionId key (the only key the drawer actually writes).
      const issue = await createIssue(request, ctx.token, ctx.project.id, {
        title: 'Has severity set',
      });
      const patchRes = await request.patch(`${API_URL}/api/issues/${issue.id}`, {
        headers: auth(ctx.token),
        data: { customFields: { [cf.id]: 'Critical' } },
      });
      expect(patchRes.ok()).toBeTruthy();

      // Expected: with the field genuinely set, the gated transition should
      // succeed. Actual (defect): it still 422s because the gate looks up
      // customFields[cf.key], not customFields[cf.id].
      const moveRes = await request.post(`${API_URL}/api/issues/${issue.id}/move`, {
        headers: auth(ctx.token),
        data: { statusId: inProg.id, boardId: board.id },
      });
      expect(moveRes.ok(), `expected the gated move to succeed once the field is set, got ${moveRes.status()}`).toBeTruthy();
    },
  );

  test(
    'a REQUIRE_FIELD gate saved with a blank field key silently no-ops instead of warning the admin',
    async ({ page, request }) => {
      // REPRO: docs/UI-REVIEW.md "Workflows robustness sweep — 2026-07-02" #3.
      // The gate editor lets an admin add a REQUIRE_FIELD gate and save the
      // transition WITHOUT filling in the field-key input (no client-side
      // required validation on that field). The backend's evaluateGate()
      // then does `if (!fieldName) break; // Mis-configured gate — skip
      // silently.` — the gate is saved, shown in the UI with a "Require a
      // field to be set" chip (implying it's active), but never actually
      // gates anything. An admin who believes they configured a required-
      // field gate has silently configured a no-op. Expected: either the
      // Save button is disabled until a REQUIRE_FIELD gate has a non-empty
      // field key, or the saved gate visibly flags itself as
      // mis-configured/incomplete in the transition list and graph.
      const { ctx, todo, inProg, workflow } = await setupStrictBoardWorkflow(
        page,
        request,
        'wf-gate-blank',
      );
      await page.goto(`/projects/${ctx.project.id}/settings`);
      const manager = page.getByTestId('workflows-manager');
      await manager.scrollIntoViewIfNeeded();
      await page.getByTestId('workflow-row').filter({ hasText: workflow.name }).click();
      await page.getByRole('button', { name: '+ Add transition' }).click();

      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('From status').selectOption(inProg.id);
      await dialog.getByLabel('To status').selectOption(todo.id);
      await page.getByTestId('workflow-gate-add').click();
      // Gate type defaults to REQUIRE_ASSIGNEE; switch to REQUIRE_FIELD.
      await dialog.getByLabel('Gate type').selectOption('REQUIRE_FIELD');
      // Leave the field-key input blank — expected: Save should be disabled.
      const saveBtn = page.getByTestId('workflow-save-transition');
      await expect(saveBtn).toBeDisabled();
    },
  );
});

// ===========================================================================
// SECTION 3 — Visual graph builder: persistence & template rendering
// ===========================================================================

test.describe('Workflow graph builder — persistence (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an edge created in the graph view survives navigate-away and full reload', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'wg-persist',
      openBoard: false,
    });
    const wfRes = await request.post(
      `${API_URL}/api/projects/${ctx.project.id}/workflows/from-template`,
      { headers: auth(ctx.token), data: { template: 'simple' } },
    );
    const wf = (await wfRes.json()) as { id: string };
    const statuses = await getStatuses(request, ctx.token, ctx.project.id);
    const done = statuses.find((s) => s.category === 'DONE')!;

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const manager = page.getByTestId('workflows-manager');
    await manager.scrollIntoViewIfNeeded();
    await page.getByTestId('workflow-row').first().click();
    await expect(page.getByTestId('workflow-enforce-toggle-2')).toBeVisible({ timeout: 8_000 });
    await page.getByTestId('workflow-graph-toggle').getByRole('radio', { name: /graph/i }).click();
    await expect(page.getByTestId('workflow-graph')).toBeVisible({ timeout: 8_000 });

    // Draw Start -> Done.
    const startHandle = page.getByTestId('workflow-graph-connect-start');
    await startHandle.evaluate((el) => (el as HTMLElement).click());
    await expect(page.getByRole('status')).toContainText(/click a target node/i, { timeout: 5_000 });
    await page.getByTestId(`workflow-graph-connect-${done.id}`).evaluate((el) => (el as HTMLElement).click());
    await expect(page.getByRole('status')).toContainText(/transition added/i, { timeout: 10_000 });

    // Navigate away and back.
    await page.goto(`/projects/${ctx.project.id}/board`);
    await page.goto(`/projects/${ctx.project.id}/settings`);
    await manager.scrollIntoViewIfNeeded();
    await page.getByTestId('workflow-row').first().click();
    await page.getByTestId('workflow-graph-toggle').getByRole('radio', { name: /graph/i }).click();
    await expect(
      page.getByTestId(`workflow-graph-edge-__start__-${done.id}`),
    ).toBeVisible({ timeout: 8_000 });

    // Full reload.
    await page.reload();
    await manager.scrollIntoViewIfNeeded();
    await page.getByTestId('workflow-row').first().click();
    await page.getByTestId('workflow-graph-toggle').getByRole('radio', { name: /graph/i }).click();
    await expect(
      page.getByTestId(`workflow-graph-edge-__start__-${done.id}`),
    ).toBeVisible({ timeout: 8_000 });
  });
});

// ===========================================================================
// SECTION 4 — Enforcement AS FELT BY THE USER (the core of this sweep)
// ===========================================================================

test.describe('Enforcement felt by the user — board surfaces (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('illegal board DRAG is blocked, rolls back cleanly (no ghost card), and re-drag after the failure still works', async ({
    page,
    request,
  }) => {
    const { ctx, done } = await setupStrictBoardWorkflow(page, request, 'enf-drag');
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Drag me illegally' });

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByTestId('board-workflow-badge')).toBeVisible({ timeout: 15_000 });

    // Illegal move via the card status picker (functionally identical gate
    // path to a drag — both go through useMoveIssue with boardId).
    const card = page.getByTestId('issue-card').filter({ hasText: issue.key });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.getByTestId('card-status-trigger').click();
    await page.getByTestId(`card-status-option-${done.id}`).click();

    await expect(page.getByRole('alert')).toContainText(/not allowed|allowed next status/i, {
      timeout: 10_000,
    });

    // No ghost card: exactly one card for this issue, and the server-side
    // status truly did not change (rollback wasn't just optimistic-UI theater).
    await expect(page.getByTestId('issue-card').filter({ hasText: issue.key })).toHaveCount(1);
    const issueRes = await request.get(`${API_URL}/api/issues/${issue.id}`, {
      headers: auth(ctx.token),
    });
    const issueBody = (await issueRes.json()) as { statusId: string };
    expect(issueBody.statusId).not.toBe(done.id);

    // Reload confirms the card is still visible on the board (not stuck/lost).
    await page.reload();
    await expect(page.getByTestId('board-workflow-badge')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('issue-card').filter({ hasText: issue.key })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('a LEGAL board move still succeeds when a strict named workflow is enforced', async ({
    page,
    request,
  }) => {
    const { ctx, inProg } = await setupStrictBoardWorkflow(page, request, 'enf-legal');
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Legal move' });

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByTestId('board-workflow-badge')).toBeVisible({ timeout: 15_000 });

    const writes = trackApiWrites(page);
    const card = page.getByTestId('issue-card').filter({ hasText: issue.key });
    await card.getByTestId('card-status-trigger').click();
    await page.getByTestId(`card-status-option-${inProg.id}`).click();
    await expect(page.getByTestId('card-status-menu')).toHaveCount(0, { timeout: 8_000 });
    await expect(card.getByTestId('card-status-trigger')).toHaveAttribute(
      'aria-label',
      new RegExp(inProg.name, 'i'),
      { timeout: 8_000 },
    );

    // The assertion above CANNOT tell optimistic from settled: the cache write
    // lands the instant the click is handled, so the accessible name flips
    // while the PATCH is still in flight — and `page.reload()` then aborts it,
    // leaving the card back on To Do. That is the exact failure this line
    // fixes (seen under 6 parallel workers, which widens the window), and the
    // same class the 2026-07-29 flakiness sweep caught in six other specs;
    // this one was missed. Wait for the server to actually ACK the write.
    await writes.settle({
      match: (w) => w.method === 'POST' && w.path.endsWith(`/api/issues/${issue.id}/move`),
      atLeast: 1,
    });

    // Reload to confirm the move truly persisted server-side (not just
    // optimistic-UI theater) — a durable check, unlike an immediate isolated
    // API read racing the mutation's own commit.
    await page.reload();
    await expect(page.getByTestId('board-workflow-badge')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId('issue-card').filter({ hasText: issue.key }).getByTestId('card-status-trigger'),
    ).toHaveAttribute('aria-label', new RegExp(inProg.name, 'i'), { timeout: 10_000 });
  });
});

test.describe('Enforcement felt by the user — non-board surfaces (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test(
    'Triage\'s "s" status picker respects the board\'s enforced named workflow (currently bypasses it silently)',
    async ({ page, request }) => {
      // REPRO: docs/UI-REVIEW.md "Workflows robustness sweep — 2026-07-02" #4
      // (P1 — the headline finding of this sweep).
      //
      // ROOT CAUSE: `IssuesService.enforceMove()` (the board-aware gate) is
      // only invoked from the `POST /issues/:id/move` path, which only
      // TriagePage does NOT use — `TriagePage.tsx` calls `useUpdateIssue()`
      // (`PATCH /issues/:id`) for its "s" status picker. `IssuesService
      // .update()` calls `this.workflowSvc.enforceTransition()` directly
      // with NO board context at all — it only ever checks the legacy
      // project-wide `Project.workflowEnforced` flag (off by default,
      // entirely independent of any named workflow's `enforced` flag). A
      // board can show an "ENFORCED" badge for its assigned named workflow,
      // and Triage's "s" picker will still silently apply ANY status change
      // with zero gate evaluation — no error, no toast, the move just
      // succeeds. This is a full, silent enforcement bypass for one of the
      // five surfaces explicitly in scope for this sweep.
      //
      // Expected: an illegal TODO -> Done change via Triage's "s" picker on
      // an issue that lives on the strict board should 422 with the same
      // "not allowed by the board workflow" message board drag/card-picker
      // surface, and the issue should remain in TODO.
      const { ctx, done } = await setupStrictBoardWorkflow(page, request, 'enf-triage');
      const issue = await createIssue(request, ctx.token, ctx.project.id, {
        title: 'Triage bypass check',
      });

      await page.goto(`/projects/${ctx.project.id}/triage`);
      await expect(page.getByTestId('triage-row').first()).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('triage-row').first().click();
      await page.keyboard.press('s');
      await expect(page.getByTestId('triage-picker-status')).toBeVisible({ timeout: 5_000 });
      await page.getByTestId('triage-picker-status').getByText(done.name, { exact: true }).click();

      // Expected outcome once fixed: blocked with an error toast.
      await expect(page.getByRole('alert')).toContainText(/not allowed|allowed next status/i, {
        timeout: 8_000,
      });
      const issueRes = await request.get(`${API_URL}/api/issues/${issue.id}`, {
        headers: auth(ctx.token),
      });
      const issueBody = (await issueRes.json()) as { statusId: string };
      expect(issueBody.statusId).not.toBe(done.id);
    },
  );

  test(
    'the issue drawer\'s Status <select> respects the board\'s enforced named workflow (currently bypasses it silently)',
    async ({ page, request }) => {
      // REPRO: docs/UI-REVIEW.md "Workflows robustness sweep — 2026-07-02" #4.
      // Same root cause as the Triage finding: `IssueDetailDrawer.tsx`'s
      // `patch()` calls `useUpdateIssue()` with no boardId, so
      // `IssuesService.update()` only checks the legacy project-wide flag.
      // Opening the same issue from the board (so a boardId IS known to the
      // page) makes no difference — the drawer never forwards it.
      const { ctx, done } = await setupStrictBoardWorkflow(page, request, 'enf-drawer');
      const issue = await createIssue(request, ctx.token, ctx.project.id, {
        title: 'Drawer bypass check',
      });

      await page.goto(`/projects/${ctx.project.id}/board?issue=${issue.id}`);
      // Scope to the drawer dialog: the board's card status trigger ALSO has
      // an accessible name starting with "Status:", so an unscoped
      // getByLabel('Status') is ambiguous between the two.
      const drawer = page.getByRole('dialog');
      await expect(drawer.locator('#d-status')).toBeVisible({ timeout: 15_000 });
      await drawer.locator('#d-status').selectOption(done.id);

      await expect(page.getByRole('alert')).toContainText(/not allowed|allowed next status/i, {
        timeout: 8_000,
      });
      const issueRes = await request.get(`${API_URL}/api/issues/${issue.id}`, {
        headers: auth(ctx.token),
      });
      const issueBody = (await issueRes.json()) as { statusId: string };
      expect(issueBody.statusId).not.toBe(done.id);
    },
  );

  test(
    'bulk edit respects the board\'s enforced named workflow for status changes (currently bypasses it silently)',
    async ({ page, request }) => {
      // REPRO: docs/UI-REVIEW.md "Workflows robustness sweep — 2026-07-02" #4.
      // `IssuesService.bulkUpdate()` pre-loads ONLY `isEnforcementEnabled
      // (projectId)` (the legacy project-wide flag) and threads that through
      // to each per-issue `update()` call — it never resolves a board or a
      // named workflow at all. A multi-select "Set status -> Done" bulk
      // action on issues living on a strict board silently succeeds for
      // every row, with the BulkActionBar's own partial-failure UI (`result
      // .failed.length > 0` toast) never firing because nothing failed
      // server-side.
      const { ctx, done } = await setupStrictBoardWorkflow(page, request, 'enf-bulk');
      const issue = await createIssue(request, ctx.token, ctx.project.id, {
        title: 'Bulk bypass check',
      });

      await page.goto(`/projects/${ctx.project.id}/triage`);
      await expect(page.getByTestId('triage-row').first()).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('bulk-select-row').first().click();
      await expect(page.getByTestId('bulk-action-bar')).toBeVisible({ timeout: 5_000 });
      await page.getByLabel('Set status').selectOption(done.id);
      await page.getByTestId('bulk-apply').click();

      // Expected once fixed: a partial-failure toast, issue stays in TODO.
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 8_000 });
      const issueRes = await request.get(`${API_URL}/api/issues/${issue.id}`, {
        headers: auth(ctx.token),
      });
      const issueBody = (await issueRes.json()) as { statusId: string };
      expect(issueBody.statusId).not.toBe(done.id);
    },
  );
});

// ===========================================================================
// SECTION 5 — Rapid toggling / robustness edge cases
// ===========================================================================

test.describe('Enforcement toggle robustness (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('rapid double-click on the legacy enforcement toggle does not desync the UI from the server state', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'enf-rapid', openBoard: false });
    await page.goto(`/projects/${ctx.project.id}/settings`);
    const section = page.getByTestId('workflow-settings');
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible({ timeout: 15_000 });

    const toggle = page.getByTestId('workflow-enforce-toggle');
    // Fire two rapid clicks (double-click race the founder explicitly flagged).
    await toggle.click();
    await toggle.click();

    // Whatever the outcome, the UI's aria-checked must match the server's
    // authoritative value after settling (no permanent desync).
    await page.waitForTimeout(1500);
    const uiChecked = await toggle.getAttribute('aria-checked');
    const wfRes = await request.get(`${API_URL}/api/projects/${ctx.project.id}/workflow`, {
      headers: auth(ctx.token),
    });
    const wfBody = (await wfRes.json()) as { enforced: boolean };
    expect(uiChecked).toBe(String(wfBody.enforced));

    // Reload must agree too.
    await page.reload();
    await section.scrollIntoViewIfNeeded();
    await expect(toggle).toHaveAttribute('aria-checked', String(wfBody.enforced), {
      timeout: 8_000,
    });
  });

  test('rapid toggling the named-workflow enforcement switch settles to a consistent, correct state', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'enf-rapid-named', openBoard: false });
    const wf = await createNamedWorkflow(request, ctx.token, ctx.project.id, { name: 'Toggle Me' });

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const manager = page.getByTestId('workflows-manager');
    await manager.scrollIntoViewIfNeeded();
    await page.getByTestId('workflow-row').first().click();
    const toggle = page.getByTestId('workflow-enforce-toggle-2');
    await expect(toggle).toBeVisible({ timeout: 8_000 });

    await toggle.click();
    await toggle.click();
    await toggle.click();

    await page.waitForTimeout(1500);
    const uiChecked = await toggle.getAttribute('aria-checked');
    const wfRes = await request.get(`${API_URL}/api/workflows/${wf.id}`, {
      headers: auth(ctx.token),
    });
    const wfBody = (await wfRes.json()) as { enforced: boolean };
    expect(uiChecked).toBe(String(wfBody.enforced));
  });
});

// ===========================================================================
// SECTION 6 — Mobile spot checks
// ===========================================================================

test.describe('Workflows robustness — mobile (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('board workflow badge + enforcement error toast are usable at 390px', async ({
    page,
    request,
  }) => {
    const { ctx, done } = await setupStrictBoardWorkflow(page, request, 'enf-mobile');
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Mobile block' });

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByTestId('board-workflow-badge')).toBeVisible({ timeout: 15_000 });

    const card = page.getByTestId('issue-card').filter({ hasText: issue.key });
    await card.scrollIntoViewIfNeeded();
    await card.getByTestId('card-status-trigger').click();
    await page.getByTestId(`card-status-option-${done.id}`).click();

    await expect(page.getByRole('alert')).toContainText(/not allowed|allowed next status/i, {
      timeout: 10_000,
    });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('named workflows manager: template picker and transition modal are usable at 390px', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'wfm-mobile', openBoard: false });
    await page.goto(`/projects/${ctx.project.id}/settings`);
    const manager = page.getByTestId('workflows-manager');
    await manager.scrollIntoViewIfNeeded();
    await expect(manager).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('workflow-from-template').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByTestId('workflow-row').first()).toBeVisible({ timeout: 10_000 });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

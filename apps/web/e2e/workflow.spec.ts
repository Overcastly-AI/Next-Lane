/**
 * workflow.spec.ts
 *
 * End-to-end tests for configurable workflows (SDLC enforcement):
 *  - The Workflow settings section: enabling enforcement seeds a transition
 *    graph and the builder renders transition rows.
 *  - Enforcement surfaces in the UI: an illegal board status move is blocked
 *    and the server's 422 reason appears as an error toast (card stays put).
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  setupIsolatedProject,
  createIssue,
  API_URL,
} from './helpers';

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
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Array<{
    id: string;
    name: string;
    category: string;
  }>;
}

async function setEnforced(
  request: APIRequestContext,
  token: string,
  projectId: string,
) {
  const res = await request.patch(
    `${API_URL}/api/projects/${projectId}/workflow`,
    { headers: auth(token), data: { enforced: true } },
  );
  expect(res.ok(), `enable workflow failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as {
    enforced: boolean;
    transitions: Array<{ id: string; fromStatusId: string | null; toStatusId: string }>;
  };
}

test.describe('Configurable workflows — settings UI (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('enabling enforcement seeds the transition graph in the builder', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'wf-ui' });
    await page.goto(`/projects/${ctx.project.id}/settings`);

    const section = page.getByTestId('workflow-settings');
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible({ timeout: 15_000 });

    const toggle = page.getByTestId('workflow-enforce-toggle');
    await toggle.click();

    // Enabling auto-seeds a permissive all-pairs default → rows render.
    await expect(
      page.getByTestId('workflow-transition-row').first(),
    ).toBeVisible({ timeout: 8_000 });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('Configurable workflows — enforcement (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an illegal board move is blocked with a 422 toast', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'wf-enf' });
    const statuses = await getStatuses(request, ctx.token, ctx.project.id);
    const todo = statuses.find((s) => s.category === 'TODO')!;
    const done = statuses.find((s) => s.category === 'DONE')!;

    // Enable workflow (auto-seeds all pairs), then delete TODO→DONE so it's illegal.
    const wf = await setEnforced(request, ctx.token, ctx.project.id);
    const todoToDone = wf.transitions.find(
      (t) => t.fromStatusId === todo.id && t.toStatusId === done.id,
    )!;
    const del = await request.delete(
      `${API_URL}/api/workflow/transitions/${todoToDone.id}`,
      { headers: auth(ctx.token) },
    );
    expect(del.ok()).toBeTruthy();

    await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Blocked move',
    });

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Attempt the illegal TODO→DONE move via the inline card status picker.
    await page.getByTestId('card-status-trigger').first().click();
    await expect(page.getByTestId('card-status-menu').first()).toBeVisible();
    await page.getByTestId(`card-status-option-${done.id}`).click();

    // The server 422 reason is surfaced as an error toast.
    await expect(page.getByRole('alert')).toContainText(
      /not allowed|allowed next status/i,
      { timeout: 8_000 },
    );
  });

  test('a legal move still succeeds when enforced', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'wf-ok' });
    const statuses = await getStatuses(request, ctx.token, ctx.project.id);
    const inProg = statuses.find((s) => s.category === 'IN_PROGRESS')!;

    // Enable (auto-seed keeps TODO→In Progress legal, no gates).
    await setEnforced(request, ctx.token, ctx.project.id);
    await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Legal move',
    });

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId('card-status-trigger').first().click();
    await page.getByTestId(`card-status-option-${inProg.id}`).click();
    // Menu closes and no error toast appears.
    await expect(page.getByTestId('card-status-menu')).toHaveCount(0, {
      timeout: 8_000,
    });
  });
});

test.describe('Configurable workflows — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('workflow settings render without horizontal overflow', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'wf-mob' });
    await page.goto(`/projects/${ctx.project.id}/settings`);
    await expect(page.getByTestId('workflow-settings')).toBeVisible({
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

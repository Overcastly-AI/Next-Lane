/**
 * gitlab-auto-transition.spec.ts
 *
 * End-to-end tests for GitLab's auto-transition-on-merge, at the same depth
 * as `pr-auto-transition.spec.ts` (GitHub). Same feature, GitLab semantics:
 * a "Merge Request Hook" webhook token-verified via the literal
 * `X-Gitlab-Token` shared-secret header (no HMAC), and `object_attributes.
 * state === 'merged'` (not GitHub's `merged: true` boolean) as the merge
 * signal — see `gitlab.service.ts#handleMergeRequestEvent`.
 *
 *   1. Board card badge: a linked open MR renders the same `issue-pr-badge`
 *      the board uses for both providers (`issue.mapper.ts` aggregates
 *      GitHub PR + GitLab MR links into one `prLinkSummary`); once the MR is
 *      merged, the badge flips to "Merged" (desktop + mobile — no
 *      horizontal overflow).
 *   2. Settings: an admin enables `gitlab-auto-transition-toggle` targeting
 *      "Done", and the toggle + selected status survive a reload.
 *   3. A locally-tokened `Merge Request Hook` webhook, with the toggle ON,
 *      drives the linked issue's real status transition (no GitLab egress —
 *      the `X-Gitlab-Token` is the real `webhookSecret` the API returns).
 *   4. Disabled-by-default: without ever touching the toggle, an identical
 *      merged webhook links the MR but never moves the issue's status.
 */

import { test, expect } from '@playwright/test';
import {
  setupIsolatedProject,
  createIssue,
  API_URL,
} from './helpers';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

interface StatusRow {
  id: string;
  name: string;
}

async function getStatuses(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  projectId: string,
): Promise<StatusRow[]> {
  const res = await request.get(`${API_URL}/api/projects/${projectId}/statuses`, {
    headers: auth(token),
  });
  expect(res.ok(), `get statuses failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as StatusRow[];
}

async function connectGitlab(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  projectId: string,
  projectPath: string,
): Promise<string> {
  const res = await request.put(`${API_URL}/api/projects/${projectId}/gitlab`, {
    headers: auth(token),
    data: { projectPath, token: 'glpat-fakeTokenForE2E1234567890' },
  });
  expect(res.ok(), `connect gitlab failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { webhookSecret: string };
  return body.webhookSecret;
}

function mrPayload(opts: {
  iid: number;
  issueKey: string;
  state: 'opened' | 'merged';
}) {
  return {
    object_kind: 'merge_request',
    event_type: 'merge_request',
    user: { name: 'Administrator', username: 'root' },
    object_attributes: {
      id: opts.iid + 1000,
      iid: opts.iid,
      title: `[${opts.issueKey}] Ship it`,
      description: '',
      source_branch: `feature/${opts.iid}`,
      target_branch: 'main',
      state: opts.state,
      url: `https://gitlab.com/acme/widgets-gl/-/merge_requests/${opts.iid}`,
      action: opts.state === 'merged' ? 'merge' : 'open',
    },
  };
}

async function postMrWebhook(
  request: import('@playwright/test').APIRequestContext,
  projectId: string,
  token: string,
  payload: unknown,
) {
  const res = await request.post(`${API_URL}/api/gitlab/webhook/${projectId}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Gitlab-Token': token,
      'X-Gitlab-Event': 'Merge Request Hook',
    },
    data: payload,
  });
  expect(res.ok(), `webhook post: ${res.status()}`).toBeTruthy();
  return (await res.json()) as { linksUpserted: number };
}

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

test.describe('GitLab auto-transition-on-merge — desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('board card badge flips open → merged, and enabling the toggle drives a real status transition', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'gl-auto',
      projectName: 'GitLab Auto-Transition Project',
      openBoard: false,
    });

    const { id: issueId, key: issueKey } = await createIssue(
      request,
      ctx.token,
      ctx.project.id,
      { title: 'Ship the launch banner (GitLab)' },
    );
    const webhookToken = await connectGitlab(
      request,
      ctx.token,
      ctx.project.id,
      'acme/auto-widgets-gl',
    );
    const statuses = await getStatuses(request, ctx.token, ctx.project.id);
    const done = statuses.find((s) => s.name === 'Done');
    expect(done, 'expected a default "Done" status').toBeDefined();

    // ── Settings: enable auto-transition-on-merge, target "Done" ──────────
    await page.goto(`/projects/${ctx.project.id}/settings`);
    const gitlabSection = page.getByTestId('gitlab-section');
    await expect(gitlabSection.getByTestId('gitlab-webhook-url')).toBeVisible({ timeout: 8_000 });

    const autoSection = gitlabSection.getByTestId('gitlab-auto-transition-section');
    await expect(autoSection).toBeVisible();
    const toggle = autoSection.getByTestId('gitlab-auto-transition-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await autoSection.getByTestId('gitlab-auto-transition-status').selectOption(done!.id);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    // Persists across reload.
    await page.reload();
    const autoSectionAfterReload = page.getByTestId('gitlab-section').getByTestId(
      'gitlab-auto-transition-section',
    );
    await expect(autoSectionAfterReload.getByTestId('gitlab-auto-transition-toggle')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(autoSectionAfterReload.getByTestId('gitlab-auto-transition-status')).toHaveValue(
      done!.id,
    );

    // ── Board: no badge before any MR is linked ────────────────────────────
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });
    const card = page.getByTestId('issue-card').filter({ hasText: issueKey });
    await expect(card).toBeVisible();
    await expect(card.getByTestId('issue-pr-badge')).toHaveCount(0);

    // ── Open MR webhook → "PR" badge (open state) ───────────────────────────
    const openResult = await postMrWebhook(
      request,
      ctx.project.id,
      webhookToken,
      mrPayload({ iid: 42, issueKey, state: 'opened' }),
    );
    expect(openResult.linksUpserted).toBe(1);

    await page.reload();
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });
    const cardAfterOpen = page.getByTestId('issue-card').filter({ hasText: issueKey });
    const openBadge = cardAfterOpen.getByTestId('issue-pr-badge');
    await expect(openBadge).toBeVisible({ timeout: 10_000 });
    await expect(openBadge).toHaveAttribute('data-pr-state', 'open');
    await expect(openBadge).toContainText('PR');

    // ── Merged MR webhook (real X-Gitlab-Token, zero GitLab egress) ───────
    const mergedResult = await postMrWebhook(
      request,
      ctx.project.id,
      webhookToken,
      mrPayload({ iid: 42, issueKey, state: 'merged' }),
    );
    expect(mergedResult.linksUpserted).toBe(1);

    // Badge flips to "Merged" — realtime issue.updated invalidates the board.
    const cardAfterMerge = page.getByTestId('issue-card').filter({ hasText: issueKey });
    const mergedBadge = cardAfterMerge.getByTestId('issue-pr-badge');
    await expect(mergedBadge).toHaveAttribute('data-pr-state', 'merged', { timeout: 10_000 });
    await expect(mergedBadge).toContainText('Merged');

    // ── The issue itself was auto-transitioned to "Done" (real REST check,
    // not just a UI observation) ────────────────────────────────────────────
    await expect(async () => {
      const issueRes = await request.get(`${API_URL}/api/issues/${issueId}`, {
        headers: auth(ctx.token),
      });
      expect(issueRes.ok()).toBeTruthy();
      const issue = (await issueRes.json()) as { statusId: string };
      expect(issue.statusId).toBe(done!.id);
    }).toPass({ timeout: 10_000 });

    // ── The GitLab MR link itself is visible in the issue drawer too ──────
    await page.getByText('Ship the launch banner (GitLab)').first().click();
    const drawer = page.getByRole('dialog').last();
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    const devSection = drawer.getByTestId('gitlab-links-section');
    await expect(devSection).toBeVisible({ timeout: 10_000 });
    const linkRow = devSection.getByTestId('gitlab-link-row');
    await expect(linkRow).toContainText('!42');
    await expect(linkRow.getByTestId('gitlab-link-state')).toHaveText(/merged/i);
  });

  test('disabled by default: a merged webhook links the MR but never moves the issue', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'gl-auto-off',
      openBoard: false,
    });

    const { id: issueId, key: issueKey } = await createIssue(
      request,
      ctx.token,
      ctx.project.id,
      { title: 'Should stay put (GitLab)' },
    );
    const webhookToken = await connectGitlab(
      request,
      ctx.token,
      ctx.project.id,
      'acme/off-widgets-gl',
    );

    // Never touch the auto-transition toggle — verify it defaults off via the API too.
    const integrationRes = await request.get(
      `${API_URL}/api/projects/${ctx.project.id}/gitlab`,
      { headers: auth(ctx.token) },
    );
    expect(integrationRes.ok()).toBeTruthy();
    const integration = (await integrationRes.json()) as { autoTransitionOnMerge: boolean };
    expect(integration.autoTransitionOnMerge).toBe(false);

    const before = await request.get(`${API_URL}/api/issues/${issueId}`, {
      headers: auth(ctx.token),
    });
    const beforeStatusId = ((await before.json()) as { statusId: string }).statusId;

    const result = await postMrWebhook(
      request,
      ctx.project.id,
      webhookToken,
      mrPayload({ iid: 61, issueKey, state: 'merged' }),
    );
    expect(result.linksUpserted).toBe(1);

    const after = await request.get(`${API_URL}/api/issues/${issueId}`, {
      headers: auth(ctx.token),
    });
    const afterStatusId = ((await after.json()) as { statusId: string }).statusId;
    expect(afterStatusId).toBe(beforeStatusId);
  });
});

// ---------------------------------------------------------------------------
// Mobile (390px)
// ---------------------------------------------------------------------------

test.describe('GitLab auto-transition-on-merge — mobile (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('linked-MR badge renders on the board card without horizontal overflow', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'gl-auto-mob',
      openBoard: false,
    });

    const { key: issueKey } = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Mobile MR badge issue (GitLab)',
    });
    const webhookToken = await connectGitlab(
      request,
      ctx.token,
      ctx.project.id,
      'acme/mobile-widgets-gl',
    );

    const result = await postMrWebhook(
      request,
      ctx.project.id,
      webhookToken,
      mrPayload({ iid: 71, issueKey, state: 'opened' }),
    );
    expect(result.linksUpserted).toBe(1);

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });

    const card = page.getByTestId('issue-card').filter({ hasText: issueKey });
    const badge = card.getByTestId('issue-pr-badge');
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge).toHaveAttribute('data-pr-state', 'open');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

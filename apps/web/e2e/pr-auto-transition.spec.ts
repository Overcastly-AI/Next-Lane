/**
 * pr-auto-transition.spec.ts
 *
 * End-to-end tests for PR-status + auto-transition-on-merge (Phase 9):
 *   1. Board card badge: a linked open PR renders a "PR" badge on the
 *      board card; once the PR is merged, the badge flips to "Merged"
 *      (desktop + mobile — badge rendering, no horizontal overflow).
 *   2. Settings: an admin enables auto-transition-on-merge with a target
 *      status, and the toggle + selected status survive a reload.
 *   3. A locally-signed `merged` PR webhook, with the toggle ON, drives the
 *      linked issue's real status transition (no GitHub egress — the
 *      signature is computed with the real webhookSecret the API returns).
 *   4. Disabled-by-default: without ever touching the toggle, an identical
 *      merged webhook links the PR but never moves the issue's status.
 */

import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';
import {
  setupIsolatedProject,
  createIssue,
  API_URL,
} from './helpers';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function signBody(secret: string, rawBody: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
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

async function connectGithub(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  projectId: string,
  repoFullName: string,
): Promise<string> {
  const res = await request.put(`${API_URL}/api/projects/${projectId}/github`, {
    headers: auth(token),
    data: { repoFullName, token: 'ghp_fakeTokenForE2E1234567890' },
  });
  expect(res.ok(), `connect github failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { webhookSecret: string };
  return body.webhookSecret;
}

function prPayload(opts: {
  number: number;
  issueKey: string;
  merged: boolean;
}) {
  return {
    action: opts.merged ? 'closed' : 'opened',
    pull_request: {
      number: opts.number,
      title: `[${opts.issueKey}] Ship it`,
      html_url: `https://github.com/acme/widgets/pull/${opts.number}`,
      state: opts.merged ? 'closed' : 'open',
      merged: opts.merged,
      head: { ref: `feature/${opts.number}` },
      user: { login: 'octocat' },
    },
  };
}

async function postPrWebhook(
  request: import('@playwright/test').APIRequestContext,
  projectId: string,
  secret: string,
  payload: unknown,
) {
  const rawBody = JSON.stringify(payload);
  const res = await request.post(`${API_URL}/api/github/webhook/${projectId}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signBody(secret, rawBody),
      'X-GitHub-Event': 'pull_request',
    },
    data: rawBody,
  });
  expect(res.ok(), `webhook post: ${res.status()}`).toBeTruthy();
  return (await res.json()) as { linksUpserted: number };
}

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

test.describe('PR auto-transition-on-merge — desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('board card badge flips open → merged, and enabling the toggle drives a real status transition', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'pr-auto',
      projectName: 'PR Auto-Transition Project',
      openBoard: false,
    });

    const { id: issueId, key: issueKey } = await createIssue(
      request,
      ctx.token,
      ctx.project.id,
      { title: 'Ship the launch banner' },
    );
    const secret = await connectGithub(request, ctx.token, ctx.project.id, 'acme/widgets');
    const statuses = await getStatuses(request, ctx.token, ctx.project.id);
    const done = statuses.find((s) => s.name === 'Done');
    expect(done, 'expected a default "Done" status').toBeDefined();

    // ── Settings: enable auto-transition-on-merge, target "Done" ──────────
    await page.goto(`/projects/${ctx.project.id}/settings`);
    const githubSection = page.getByTestId('github-section');
    await expect(githubSection.getByTestId('github-webhook-url')).toBeVisible({ timeout: 8_000 });

    const autoSection = githubSection.getByTestId('github-auto-transition-section');
    await expect(autoSection).toBeVisible();
    const toggle = autoSection.getByTestId('github-auto-transition-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await autoSection.getByTestId('github-auto-transition-status').selectOption(done!.id);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    // Persists across reload.
    await page.reload();
    const autoSectionAfterReload = page.getByTestId('github-section').getByTestId(
      'github-auto-transition-section',
    );
    await expect(autoSectionAfterReload.getByTestId('github-auto-transition-toggle')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(autoSectionAfterReload.getByTestId('github-auto-transition-status')).toHaveValue(
      done!.id,
    );

    // ── Board: no badge before any PR is linked ────────────────────────────
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });
    const card = page.getByTestId('issue-card').filter({ hasText: issueKey });
    await expect(card).toBeVisible();
    await expect(card.getByTestId('issue-pr-badge')).toHaveCount(0);

    // ── Open PR webhook → "PR" badge (open state) ──────────────────────────
    const openResult = await postPrWebhook(
      request,
      ctx.project.id,
      secret,
      prPayload({ number: 501, issueKey, merged: false }),
    );
    expect(openResult.linksUpserted).toBe(1);

    await page.reload();
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });
    const cardAfterOpen = page.getByTestId('issue-card').filter({ hasText: issueKey });
    const openBadge = cardAfterOpen.getByTestId('issue-pr-badge');
    await expect(openBadge).toBeVisible({ timeout: 10_000 });
    await expect(openBadge).toHaveAttribute('data-pr-state', 'open');
    await expect(openBadge).toContainText('PR');

    // ── Merged PR webhook (real signature, zero GitHub egress) ────────────
    const mergedResult = await postPrWebhook(
      request,
      ctx.project.id,
      secret,
      prPayload({ number: 501, issueKey, merged: true }),
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
  });

  test('disabled by default: a merged webhook links the PR but never moves the issue', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'pr-auto-off',
      openBoard: false,
    });

    const { id: issueId, key: issueKey } = await createIssue(
      request,
      ctx.token,
      ctx.project.id,
      { title: 'Should stay put' },
    );
    const secret = await connectGithub(request, ctx.token, ctx.project.id, 'acme/off-widgets');

    // Never touch the auto-transition toggle — verify it defaults off via the API too.
    const integrationRes = await request.get(
      `${API_URL}/api/projects/${ctx.project.id}/github`,
      { headers: auth(ctx.token) },
    );
    expect(integrationRes.ok()).toBeTruthy();
    const integration = (await integrationRes.json()) as { autoTransitionOnMerge: boolean };
    expect(integration.autoTransitionOnMerge).toBe(false);

    const before = await request.get(`${API_URL}/api/issues/${issueId}`, {
      headers: auth(ctx.token),
    });
    const beforeStatusId = ((await before.json()) as { statusId: string }).statusId;

    const result = await postPrWebhook(
      request,
      ctx.project.id,
      secret,
      prPayload({ number: 601, issueKey, merged: true }),
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

test.describe('PR auto-transition-on-merge — mobile (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('linked-PR badge renders on the board card without horizontal overflow', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'pr-auto-mob',
      openBoard: false,
    });

    const { key: issueKey } = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Mobile PR badge issue',
    });
    const secret = await connectGithub(request, ctx.token, ctx.project.id, 'acme/mobile-widgets');

    const result = await postPrWebhook(
      request,
      ctx.project.id,
      secret,
      prPayload({ number: 701, issueKey, merged: false }),
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

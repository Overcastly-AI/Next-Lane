/**
 * github-integration.spec.ts
 *
 * End-to-end tests for the GitHub integration v1 kickoff (Phase 9 start):
 *   1. Settings: an ADMIN links a repo + PAT and sees the generated webhook
 *      URL/secret (desktop + mobile, no horizontal overflow at 390px).
 *   2. Inbound webhook: POST a locally-signed fake GitHub `pull_request`
 *      payload (computed with the real webhookSecret returned by the API —
 *      no GitHub egress, fully local) and assert the PR link appears in the
 *      issue's "Development" section in the drawer.
 */

import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';
import {
  setupIsolatedProject,
  createIssue,
  registerNewUser,
  addWorkspaceMember,
  login,
  API_URL,
} from './helpers';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function signBody(secret: string, rawBody: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

test.describe('GitHub integration — desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('admin links a repo, sees the webhook URL/secret, then a signed PR webhook links the issue', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'gh-desk',
      projectName: 'GitHub Integration Project',
      openBoard: false,
    });

    // Create the issue the PR will reference.
    const { key: issueKey } = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Add dark mode toggle',
    });

    // ── Settings UI: connect the repo ────────────────────────────────────
    await page.goto(`/projects/${ctx.project.id}/settings`);

    const section = page.getByTestId('github-section');
    await expect(section.getByRole('heading', { name: 'GitHub' })).toBeVisible();

    await section.getByLabel('Repository').fill('acme/widgets');
    await section.getByLabel('Personal access token').fill('ghp_fakeTokenForE2E1234567890');
    await section.getByTestId('github-save').click();

    // Webhook setup panel appears with a URL + secret.
    const webhookUrl = section.getByTestId('github-webhook-url');
    const webhookSecretEl = section.getByTestId('github-webhook-secret');
    await expect(webhookUrl).toBeVisible({ timeout: 8_000 });
    await expect(webhookSecretEl).toBeVisible();
    await expect(webhookUrl).toContainText(`/api/github/webhook/${ctx.project.id}`);

    const webhookSecret = (await webhookSecretEl.textContent())?.trim() ?? '';
    expect(webhookSecret.length).toBeGreaterThan(10);

    // Connected summary line reflects the saved repo.
    const connectedLine = section.getByText('Connected to', { exact: false }).first();
    await expect(connectedLine).toBeVisible();
    await expect(connectedLine).toContainText('acme/widgets');

    // ── Inbound webhook: signed fake pull_request payload ──────────────────
    const prPayload = {
      action: 'opened',
      pull_request: {
        number: 42,
        title: `[${issueKey}] Add dark mode toggle`,
        html_url: 'https://github.com/acme/widgets/pull/42',
        state: 'open',
        merged: false,
        head: { ref: 'feature/dark-mode' },
        user: { login: 'octocat' },
      },
    };
    const rawBody = JSON.stringify(prPayload);
    const signature = signBody(webhookSecret, rawBody);

    const webhookRes = await request.post(
      `${API_URL}/api/github/webhook/${ctx.project.id}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'pull_request',
        },
        data: rawBody,
      },
    );
    expect(webhookRes.ok(), `webhook post: ${webhookRes.status()}`).toBeTruthy();
    const webhookBody = (await webhookRes.json()) as { linksUpserted: number };
    expect(webhookBody.linksUpserted).toBe(1);

    // ── Open the issue drawer and assert the PR link appears ───────────────
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });
    await page.getByText('Add dark mode toggle').first().click();

    const drawer = page.getByRole('dialog').last();
    await expect(drawer).toBeVisible({ timeout: 10_000 });

    const devSection = drawer.getByTestId('github-links-section');
    await expect(devSection).toBeVisible({ timeout: 10_000 });
    const linkRow = devSection.getByTestId('github-link-row');
    await expect(linkRow).toContainText('#42');
    await expect(linkRow).toContainText('Add dark mode toggle');
    await expect(linkRow.getByTestId('github-link-state')).toHaveText(/open/i);
  });

  test('rejects a webhook with an invalid signature (issue drawer stays empty)', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'gh-badsig',
      openBoard: false,
    });

    // Configure GitHub via the API directly (faster than the UI for this test).
    const saveRes = await request.put(`${API_URL}/api/projects/${ctx.project.id}/github`, {
      headers: auth(ctx.token),
      data: { repoFullName: 'acme/widgets', token: 'ghp_anotherFakeToken' },
    });
    expect(saveRes.ok()).toBeTruthy();

    const { id: issueId, key: issueKey } = await createIssue(
      request,
      ctx.token,
      ctx.project.id,
      { title: 'Bad signature test issue' },
    );

    const prPayload = {
      pull_request: {
        number: 1,
        title: `[${issueKey}] should not link`,
        html_url: 'https://github.com/acme/widgets/pull/1',
        state: 'open',
        merged: false,
        head: { ref: 'branch' },
        user: { login: 'octocat' },
      },
    };
    const rawBody = JSON.stringify(prPayload);

    const webhookRes = await request.post(
      `${API_URL}/api/github/webhook/${ctx.project.id}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256':
            'sha256=0000000000000000000000000000000000000000000000000000000000000000',
          'X-GitHub-Event': 'pull_request',
        },
        data: rawBody,
      },
    );
    expect(webhookRes.status()).toBe(401);

    // No link was created — the bad-signature payload was never processed.
    const linksRes = await request.get(
      `${API_URL}/api/issues/${issueId}/github-links`,
      { headers: auth(ctx.token) },
    );
    expect(linksRes.ok()).toBeTruthy();
    expect(await linksRes.json()).toEqual([]);
  });

  test('non-admin members see a read-only summary, no form', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'gh-member',
      openBoard: false,
    });

    const saveRes = await request.put(`${API_URL}/api/projects/${ctx.project.id}/github`, {
      headers: auth(ctx.token),
      data: { repoFullName: 'acme/member-view', token: 'ghp_memberViewToken' },
    });
    expect(saveRes.ok()).toBeTruthy();

    const member = await registerNewUser(request, 'gh-member2');
    await addWorkspaceMember(request, ctx.token, ctx.workspaceId, member.email, 'MEMBER');
    await login(page, { email: member.email, password: member.password });

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const section = page.getByTestId('github-section');
    await expect(section).toBeVisible({ timeout: 10_000 });
    await expect(section.getByTestId('github-connected-summary')).toContainText(
      'acme/member-view',
    );
    await expect(section.getByTestId('github-repo-input')).toHaveCount(0);
    await expect(section.getByTestId('github-token-input')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Mobile (390px) — overflow check
// ---------------------------------------------------------------------------

test.describe('GitHub integration — mobile (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('settings section renders without horizontal overflow', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'gh-mob',
      openBoard: false,
    });

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const section = page.getByTestId('github-section');
    await expect(section).toBeVisible({ timeout: 10_000 });

    await section.getByLabel('Repository').fill('acme/mobile-widgets');
    await section.getByLabel('Personal access token').fill('ghp_mobileFakeToken1234');
    await section.getByTestId('github-save').click();
    await expect(section.getByTestId('github-webhook-url')).toBeVisible({ timeout: 8_000 });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

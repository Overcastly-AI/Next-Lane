/**
 * gitea-integration.spec.ts
 *
 * End-to-end tests for the Gitea integration v1 (third self-hosted forge,
 * after GitHub/GitLab — Phase 9 "Developer Graph"):
 *   1. Settings: an ADMIN links a self-hosted instance URL + repo + token and
 *      sees the generated webhook URL/secret (desktop + mobile, no
 *      horizontal overflow at 390px).
 *   2. Inbound webhook: POST a locally-HMAC-signed fake Gitea `pull_request`
 *      payload (computed with the real webhookSecret returned by the API —
 *      no Gitea egress, fully local) and assert the PR link appears in the
 *      issue's "Development" section in the drawer.
 *   3. An invalid signature is rejected (401) and creates no link.
 *   4. Non-admin members see a read-only summary, no form.
 *
 * Unlike `github-integration.spec.ts`/`gitlab-integration.spec.ts`, there is
 * no live-status poll and no auto-transition toggle to verify — Gitea v1 is
 * deliberately links-only.
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

/** Gitea's `X-Gitea-Signature` is a bare hex HMAC-SHA256 digest — no "sha256=" prefix, unlike GitHub's `X-Hub-Signature-256`. */
function signBody(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

test.describe('Gitea integration — desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('admin links a repo, sees the webhook URL/secret, then a signed PR webhook links the issue', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'gt-desk',
      projectName: 'Gitea Integration Project',
      openBoard: false,
    });

    // Create the issue the PR will reference.
    const { key: issueKey } = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Add offline mode',
    });

    // ── Settings UI: connect the repo ────────────────────────────────────
    await page.goto(`/projects/${ctx.project.id}/settings`);

    const section = page.getByTestId('gitea-section');
    await expect(section.getByRole('heading', { name: 'Gitea' })).toBeVisible();

    await section.getByLabel('Gitea instance URL').fill('https://git.example.com');
    await section.getByLabel('Repository').fill('acme/widgets');
    await section.getByLabel('Access token').fill('gitea_fakeTokenForE2E1234567890');
    await section.getByTestId('gitea-save').click();

    // Webhook setup panel appears with a URL + secret.
    const webhookUrl = section.getByTestId('gitea-webhook-url');
    const webhookSecretEl = section.getByTestId('gitea-webhook-secret');
    await expect(webhookUrl).toBeVisible({ timeout: 8_000 });
    await expect(webhookSecretEl).toBeVisible();
    await expect(webhookUrl).toContainText(`/api/gitea/webhook/${ctx.project.id}`);

    const webhookSecret = (await webhookSecretEl.textContent())?.trim() ?? '';
    expect(webhookSecret.length).toBeGreaterThan(10);

    // Connected summary line reflects the saved repo + instance.
    const connectedLine = section.getByText('Connected to', { exact: false }).first();
    await expect(connectedLine).toBeVisible();
    await expect(connectedLine).toContainText('acme/widgets');
    await expect(connectedLine).toContainText('git.example.com');

    // ── Inbound webhook: signed fake pull_request payload ──────────────────
    const prPayload = {
      action: 'opened',
      pull_request: {
        number: 7,
        title: `[${issueKey}] Add offline mode`,
        html_url: 'https://git.example.com/acme/widgets/pulls/7',
        state: 'open',
        merged: false,
        head: { ref: 'feature/offline-mode' },
        user: { login: 'gitea-bot' },
      },
    };
    const rawBody = JSON.stringify(prPayload);
    const signature = signBody(webhookSecret, rawBody);

    const webhookRes = await request.post(
      `${API_URL}/api/gitea/webhook/${ctx.project.id}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Gitea-Signature': signature,
          'X-Gitea-Event': 'pull_request',
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
    await page.getByText('Add offline mode').first().click();

    const drawer = page.getByRole('dialog').last();
    await expect(drawer).toBeVisible({ timeout: 10_000 });

    const devSection = drawer.getByTestId('gitea-links-section');
    await expect(devSection).toBeVisible({ timeout: 10_000 });
    const linkRow = devSection.getByTestId('gitea-link-row');
    await expect(linkRow).toContainText('#7');
    await expect(linkRow).toContainText('Add offline mode');
    await expect(linkRow.getByTestId('gitea-link-state')).toHaveText(/open/i);
  });

  test('rejects a webhook with an invalid signature (issue drawer stays empty)', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'gt-badsig',
      openBoard: false,
    });

    // Configure Gitea via the API directly (faster than the UI for this test).
    const saveRes = await request.put(`${API_URL}/api/projects/${ctx.project.id}/gitea`, {
      headers: auth(ctx.token),
      data: {
        giteaBaseUrl: 'https://git.example.com',
        repoFullName: 'acme/widgets',
        token: 'gitea_anotherFakeToken',
      },
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
        html_url: 'https://git.example.com/acme/widgets/pulls/1',
        state: 'open',
        merged: false,
        head: { ref: 'branch' },
        user: { login: 'gitea-bot' },
      },
    };
    const rawBody = JSON.stringify(prPayload);

    const webhookRes = await request.post(
      `${API_URL}/api/gitea/webhook/${ctx.project.id}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Gitea-Signature':
            '0000000000000000000000000000000000000000000000000000000000000000',
          'X-Gitea-Event': 'pull_request',
        },
        data: rawBody,
      },
    );
    expect(webhookRes.status()).toBe(401);

    // No link was created — the bad-signature payload was never processed.
    const linksRes = await request.get(
      `${API_URL}/api/issues/${issueId}/gitea-links`,
      { headers: auth(ctx.token) },
    );
    expect(linksRes.ok()).toBeTruthy();
    expect(await linksRes.json()).toEqual([]);
  });

  test('non-admin members see a read-only summary, no form', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'gt-member',
      openBoard: false,
    });

    const saveRes = await request.put(`${API_URL}/api/projects/${ctx.project.id}/gitea`, {
      headers: auth(ctx.token),
      data: {
        giteaBaseUrl: 'https://git.example.com',
        repoFullName: 'acme/member-view',
        token: 'gitea_memberViewToken',
      },
    });
    expect(saveRes.ok()).toBeTruthy();

    const member = await registerNewUser(request, 'gt-member2');
    await addWorkspaceMember(request, ctx.token, ctx.workspaceId, member.email, 'MEMBER');
    await login(page, { email: member.email, password: member.password });

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const section = page.getByTestId('gitea-section');
    await expect(section).toBeVisible({ timeout: 10_000 });
    await expect(section.getByTestId('gitea-connected-summary')).toContainText(
      'acme/member-view',
    );
    await expect(section.getByTestId('gitea-base-url-input')).toHaveCount(0);
    await expect(section.getByTestId('gitea-repo-input')).toHaveCount(0);
    await expect(section.getByTestId('gitea-token-input')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Mobile (390px) — overflow check
// ---------------------------------------------------------------------------

test.describe('Gitea integration — mobile (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('settings section renders without horizontal overflow', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'gt-mob',
      openBoard: false,
    });

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const section = page.getByTestId('gitea-section');
    await expect(section).toBeVisible({ timeout: 10_000 });

    await section.getByLabel('Gitea instance URL').fill('https://git.example.com');
    await section.getByLabel('Repository').fill('acme/mobile-widgets');
    await section.getByLabel('Access token').fill('gitea_mobileFakeToken1234');
    await section.getByTestId('gitea-save').click();
    await expect(section.getByTestId('gitea-webhook-url')).toBeVisible({ timeout: 8_000 });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

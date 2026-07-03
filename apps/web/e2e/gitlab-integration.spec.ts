/**
 * gitlab-integration.spec.ts
 *
 * End-to-end tests for the GitLab integration v1 (mirrors
 * github-integration.spec.ts's structure, GitLab semantics):
 *   1. Settings: an ADMIN links a GitLab project (namespace/project path +
 *      PAT) and sees the generated webhook URL/secret (desktop + mobile, no
 *      horizontal overflow at 390px).
 *   2. Inbound webhook: POST a fake GitLab "Merge Request Hook" payload with
 *      the literal `X-Gitlab-Token` shared secret returned by the API — no
 *      HMAC, no GitLab egress, fully local — and assert the MR link appears
 *      in the issue's "GitLab" Development section in the drawer.
 */

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

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

test.describe('GitLab integration — desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('admin links a project, sees the webhook URL/secret, then a token-verified MR webhook links the issue', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'gl-desk',
      projectName: 'GitLab Integration Project',
      openBoard: false,
    });

    // Create the issue the MR will reference.
    const { key: issueKey } = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Add light mode toggle',
    });

    // ── Settings UI: connect the project ────────────────────────────────
    await page.goto(`/projects/${ctx.project.id}/settings`);

    const section = page.getByTestId('gitlab-section');
    await expect(section.getByRole('heading', { name: 'GitLab' })).toBeVisible();

    await section.getByLabel('Project path').fill('acme/widgets-gl');
    await section.getByLabel('Personal access token').fill('glpat-fakeTokenForE2E1234567890');
    await section.getByTestId('gitlab-save').click();

    // Webhook setup panel appears with a URL + secret.
    const webhookUrl = section.getByTestId('gitlab-webhook-url');
    const webhookSecretEl = section.getByTestId('gitlab-webhook-secret');
    await expect(webhookUrl).toBeVisible({ timeout: 8_000 });
    await expect(webhookSecretEl).toBeVisible();
    await expect(webhookUrl).toContainText(`/api/gitlab/webhook/${ctx.project.id}`);

    const webhookSecret = (await webhookSecretEl.textContent())?.trim() ?? '';
    expect(webhookSecret.length).toBeGreaterThan(10);

    // Connected summary line reflects the saved project + default instance URL.
    const connectedLine = section.getByText('Connected to', { exact: false }).first();
    await expect(connectedLine).toBeVisible();
    await expect(connectedLine).toContainText('acme/widgets-gl');
    await expect(connectedLine).toContainText('gitlab.com');

    // ── Inbound webhook: real "Merge Request Hook" payload shape ──────────
    const mrPayload = {
      object_kind: 'merge_request',
      event_type: 'merge_request',
      user: { name: 'Administrator', username: 'root' },
      object_attributes: {
        id: 501,
        iid: 42,
        title: `[${issueKey}] Add light mode toggle`,
        description: '',
        source_branch: 'feature/light-mode',
        target_branch: 'main',
        state: 'opened',
        url: 'https://gitlab.com/acme/widgets-gl/-/merge_requests/42',
        action: 'open',
      },
    };

    const webhookRes = await request.post(
      `${API_URL}/api/gitlab/webhook/${ctx.project.id}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Gitlab-Token': webhookSecret,
          'X-Gitlab-Event': 'Merge Request Hook',
        },
        data: mrPayload,
      },
    );
    expect(webhookRes.ok(), `webhook post: ${webhookRes.status()}`).toBeTruthy();
    const webhookBody = (await webhookRes.json()) as { linksUpserted: number };
    expect(webhookBody.linksUpserted).toBe(1);

    // ── Open the issue drawer and assert the MR link appears ───────────────
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText(/to do/i).first()).toBeVisible({ timeout: 15_000 });
    await page.getByText('Add light mode toggle').first().click();

    const drawer = page.getByRole('dialog').last();
    await expect(drawer).toBeVisible({ timeout: 10_000 });

    const devSection = drawer.getByTestId('gitlab-links-section');
    await expect(devSection).toBeVisible({ timeout: 10_000 });
    const linkRow = devSection.getByTestId('gitlab-link-row');
    await expect(linkRow).toContainText('!42');
    await expect(linkRow).toContainText('Add light mode toggle');
    await expect(linkRow.getByTestId('gitlab-link-state')).toHaveText(/open/i);
  });

  test('rejects a webhook with an invalid X-Gitlab-Token (issue drawer stays empty)', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'gl-badtoken',
      openBoard: false,
    });

    // Configure GitLab via the API directly (faster than the UI for this test).
    const saveRes = await request.put(`${API_URL}/api/projects/${ctx.project.id}/gitlab`, {
      headers: auth(ctx.token),
      data: { projectPath: 'acme/widgets-badtoken', token: 'glpat-anotherFakeToken' },
    });
    expect(saveRes.ok()).toBeTruthy();

    const { id: issueId, key: issueKey } = await createIssue(
      request,
      ctx.token,
      ctx.project.id,
      { title: 'Bad token test issue' },
    );

    const mrPayload = {
      object_kind: 'merge_request',
      user: { username: 'root' },
      object_attributes: {
        iid: 1,
        title: `[${issueKey}] should not link`,
        state: 'opened',
        url: 'https://gitlab.com/acme/widgets-badtoken/-/merge_requests/1',
        source_branch: 'branch',
      },
    };

    const webhookRes = await request.post(
      `${API_URL}/api/gitlab/webhook/${ctx.project.id}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Gitlab-Token': 'definitely-not-the-real-secret',
          'X-Gitlab-Event': 'Merge Request Hook',
        },
        data: mrPayload,
      },
    );
    expect(webhookRes.status()).toBe(401);

    // No link was created — the bad-token payload was never processed.
    const linksRes = await request.get(
      `${API_URL}/api/issues/${issueId}/gitlab-links`,
      { headers: auth(ctx.token) },
    );
    expect(linksRes.ok()).toBeTruthy();
    expect(await linksRes.json()).toEqual([]);
  });

  test('rejects a webhook with a missing X-Gitlab-Token header entirely', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'gl-notoken',
      openBoard: false,
    });

    const saveRes = await request.put(`${API_URL}/api/projects/${ctx.project.id}/gitlab`, {
      headers: auth(ctx.token),
      data: { projectPath: 'acme/widgets-notoken', token: 'glpat-yetAnotherFakeToken' },
    });
    expect(saveRes.ok()).toBeTruthy();

    const webhookRes = await request.post(
      `${API_URL}/api/gitlab/webhook/${ctx.project.id}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Gitlab-Event': 'Push Hook',
          // Deliberately no X-Gitlab-Token header.
        },
        data: { ref: 'refs/heads/main', commits: [] },
      },
    );
    expect(webhookRes.status()).toBe(401);
  });

  test('non-admin members see a read-only summary, no form', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'gl-member',
      openBoard: false,
    });

    const saveRes = await request.put(`${API_URL}/api/projects/${ctx.project.id}/gitlab`, {
      headers: auth(ctx.token),
      data: { projectPath: 'acme/member-view-gl', token: 'glpat-memberViewToken' },
    });
    expect(saveRes.ok()).toBeTruthy();

    const member = await registerNewUser(request, 'gl-member2');
    await addWorkspaceMember(request, ctx.token, ctx.workspaceId, member.email, 'MEMBER');
    await login(page, { email: member.email, password: member.password });

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const section = page.getByTestId('gitlab-section');
    await expect(section).toBeVisible({ timeout: 10_000 });
    await expect(section.getByTestId('gitlab-connected-summary')).toContainText(
      'acme/member-view-gl',
    );
    await expect(section.getByTestId('gitlab-project-path-input')).toHaveCount(0);
    await expect(section.getByTestId('gitlab-token-input')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Mobile (390px) — overflow check
// ---------------------------------------------------------------------------

test.describe('GitLab integration — mobile (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('settings section renders without horizontal overflow', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'gl-mob',
      openBoard: false,
    });

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const section = page.getByTestId('gitlab-section');
    await expect(section).toBeVisible({ timeout: 10_000 });

    await section.getByLabel('Project path').fill('acme/mobile-widgets-gl');
    await section.getByLabel('Personal access token').fill('glpat-mobileFakeToken1234');
    await section.getByTestId('gitlab-save').click();
    await expect(section.getByTestId('gitlab-webhook-url')).toBeVisible({ timeout: 8_000 });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

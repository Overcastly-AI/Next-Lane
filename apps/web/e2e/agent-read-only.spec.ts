import { test, expect } from '@playwright/test';
import { API_URL, setupIsolatedProject } from './helpers';

/**
 * The "Agent access" switch in Project Settings.
 *
 * Founder: "I want to be able to lock a board so that the MCP server cannot
 * update it. Just read it." — scoped on their follow-up to "lock a project and
 * it going into read only for the MCP".
 *
 * The enforcement itself is proved against real HTTP in
 * `apps/api/src/agent-read-only.integration.spec.ts`, which is where a security
 * control belongs. What is left for the browser is the part a person actually
 * touches: that the switch is reachable, that it says what it does including
 * its blast radius, and — the one that matters — that flipping it in the UI
 * really does refuse a token afterwards. A toggle that looked right but wrote
 * nothing would pass any test that only read the DOM.
 */
test.describe('Agent access (read-only for API tokens)', () => {
  test('flipping the switch locks the project against a real token', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'agentlock',
      projectName: 'Agent Lock QA',
      openBoard: false,
    });

    // A token, exactly as the MCP server would hold one.
    const tokenRes = await request.post(`${API_URL}/api/me/tokens`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { name: 'mcp-agent' },
    });
    expect(tokenRes.ok()).toBeTruthy();
    const pat = (await tokenRes.json()).rawToken as string;
    const asAgent = { Authorization: `Bearer ${pat}` };

    const issueRes = await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { projectId: ctx.project.id, title: 'Seed issue' },
    });
    const issueId = (await issueRes.json()).id as string;

    // Before: the agent can write.
    const before = await request.patch(`${API_URL}/api/issues/${issueId}`, {
      headers: asAgent,
      data: { title: 'agent edit, unlocked' },
    });
    expect(before.status()).toBe(200);

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const section = page.getByTestId('agent-access-section');
    await expect(section).toBeVisible({ timeout: 15_000 });
    // The blast radius has to be on screen: someone arriving expecting a
    // board-shaped lock needs to know it covers the project before relying
    // on it.
    await expect(section).toContainText(/covers every board/i);

    const toggle = page.getByTestId('agent-read-only-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    // The note explaining that an agent cannot undo this appears only when it
    // is actually on.
    await expect(page.getByTestId('agent-read-only-note')).toBeVisible();

    // After: the same token is refused — and told why.
    await expect
      .poll(
        async () => {
          const r = await request.patch(`${API_URL}/api/issues/${issueId}`, {
            headers: asAgent,
            data: { title: 'agent edit, locked' },
          });
          return r.status();
        },
        { timeout: 10_000 },
      )
      .toBe(403);

    // Reads are untouched — that is the difference between a lock and an outage.
    const read = await request.get(`${API_URL}/api/issues/${issueId}`, {
      headers: asAgent,
    });
    expect(read.status()).toBe(200);

    // And the state survives a reload, so it is on the server and not in a hook.
    await page.reload();
    await expect(page.getByTestId('agent-read-only-toggle')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('the switch turns back off and the token writes again', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'agentunlock',
      projectName: 'Agent Unlock QA',
      openBoard: false,
    });

    const tokenRes = await request.post(`${API_URL}/api/me/tokens`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { name: 'mcp-agent' },
    });
    const pat = (await tokenRes.json()).rawToken as string;
    const issueRes = await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { projectId: ctx.project.id, title: 'Seed issue' },
    });
    const issueId = (await issueRes.json()).id as string;

    // Lock it through the API, then clear it through the UI.
    await request.patch(`${API_URL}/api/projects/${ctx.project.id}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { agentReadOnly: true },
    });

    await page.goto(`/projects/${ctx.project.id}/settings`);
    const toggle = page.getByTestId('agent-read-only-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'true', {
      timeout: 15_000,
    });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('agent-read-only-note')).toHaveCount(0);

    await expect
      .poll(
        async () => {
          const r = await request.patch(`${API_URL}/api/issues/${issueId}`, {
            headers: { Authorization: `Bearer ${pat}` },
            data: { title: 'agent edit, unlocked again' },
          });
          return r.status();
        },
        { timeout: 10_000 },
      )
      .toBe(200);
  });
});

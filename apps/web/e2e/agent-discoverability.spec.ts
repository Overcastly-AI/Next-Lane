/**
 * agent-discoverability.spec.ts
 *
 * Product-audit finding (docs/AUDIT-PRODUCT.md, Pass 14): Next Lane is
 * genuinely agent-native — a first-party MCP server that reads AND writes,
 * a real memory protocol, and a governance control an agent cannot use to
 * unlock itself — and none of it was visible anywhere a new user would
 * look. This spec covers the three surfaces built to fix that:
 *
 *   1. The MCP config generator on `/developers`, and its entry points from
 *      the API-tokens page and a project's Agents tab.
 *   2. The onboarding empty state naming the agent capability instead of a
 *      third table-stakes feature.
 *   3. Agent access + agent context promoted to a top-level "Agents" project
 *      tab, discoverable from the nav without being told.
 *
 * Runs on both configured Playwright projects (chromium-desktop 1280,
 * mobile-chrome ~393px) via the shared playwright.config.ts.
 */
import { test, expect } from '@playwright/test';
import { registerNewUser, setupIsolatedProject, API_URL } from './helpers';

test.describe('Agent discoverability', () => {
  test('onboarding names the agent capability, not a third table-stakes feature', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'onb-agent');
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/password/i).fill(user.password);
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    const panel = page.getByTestId('onboarding-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // The agent highlight is on screen, distinctly, alongside the two
    // still-genuine table-stakes highlights.
    await expect(panel.getByTestId('onboarding-highlight-agents')).toBeVisible();
    await expect(panel.getByTestId('onboarding-highlight-agents')).toContainText(
      /AI agents, built in/i,
    );
    await expect(panel.getByTestId('onboarding-highlight-agents')).toContainText(/MCP/i);
    await expect(panel.getByTestId('onboarding-highlight-board')).toBeVisible();
    await expect(panel.getByTestId('onboarding-highlight-sprints')).toBeVisible();

    // The intro paragraph itself says it, not just a feature tile easy to skim past.
    await expect(panel).toContainText(/MCP server reads and writes/i);
  });

  test('the MCP generator on /developers renders a real, copyable config wired to this install', async ({
    page,
    request,
  }) => {
    const user = await registerNewUser(request, 'mcp-gen');
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/password/i).fill(user.password);
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    await page.goto('/developers');
    const mcp = page.getByTestId('mcp-connect-section');
    await expect(mcp).toBeVisible({ timeout: 15_000 });

    // Leads the page — above the REST "Call the REST API directly" section.
    const mcpBox = await mcp.boundingBox();
    const restHeading = page.getByRole('heading', { name: 'Call the REST API directly' });
    await expect(restHeading).toBeVisible();
    const restBox = await restHeading.boundingBox();
    expect(mcpBox).toBeTruthy();
    expect(restBox).toBeTruthy();
    expect(mcpBox!.y).toBeLessThan(restBox!.y);

    // Placeholder snippet renders valid, wired-up JSON before any token is typed.
    const snippet = mcp.getByTestId('mcp-config-snippet');
    await expect(snippet).toContainText('@next-lane/mcp');
    await expect(snippet).toContainText('NEXT_LANE_API_URL');
    const initialText = (await snippet.textContent()) ?? '';
    const initialConfig = JSON.parse(initialText);
    expect(initialConfig.mcpServers['next-lane'].command).toBe('npx');
    expect(initialConfig.mcpServers['next-lane'].env.NEXT_LANE_TOKEN).toBe(
      'nlp_your_personal_access_token',
    );
    expect(initialConfig.mcpServers['next-lane'].env.NEXT_LANE_API_URL).toBeTruthy();

    // Pasting a real token (per-keystroke, matching the house typing convention)
    // updates the snippet live — no reload, no submit button.
    const reveal = mcp.getByTestId('mcp-token-reveal');
    await reveal.click();
    const input = mcp.getByTestId('mcp-token-input');
    await input.pressSequentially('nlp_test1234567890', { delay: 15 });
    await expect(snippet).toContainText('nlp_test1234567890');
    const updatedConfig = JSON.parse((await snippet.textContent()) ?? '');
    expect(updatedConfig.mcpServers['next-lane'].env.NEXT_LANE_TOKEN).toBe(
      'nlp_test1234567890',
    );

    // Copy affordance is present and labeled.
    await expect(mcp.getByTestId('mcp-config-copy')).toBeVisible();

    // The token-creation step really points at where a token is made.
    await expect(mcp.getByTestId('mcp-token-link')).toHaveAttribute('href', '/me/settings');
  });

  test('the API-tokens page links straight to the MCP generator', async ({ page, request }) => {
    const user = await registerNewUser(request, 'mcp-fromtokens');
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/password/i).fill(user.password);
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    await page.goto('/me/settings');
    const callout = page.getByTestId('connect-agent-callout');
    await expect(callout).toBeVisible({ timeout: 15_000 });
    await callout.getByTestId('connect-agent-link').click();

    await expect(page).toHaveURL(/\/developers#mcp$/, { timeout: 10_000 });
    await expect(page.getByTestId('mcp-connect-section')).toBeVisible();
  });

  test('Agents is a top-level project tab hosting agent access and agent context together', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'agents-tab',
      projectName: 'Agents Tab QA',
      openBoard: true,
    });

    // Reachable from the project nav without being told where to look —
    // no scrolling, no "More" menu, a first-class tab like Board and Docs.
    const tab = page.getByTestId('nav-agents');
    await expect(tab).toBeVisible({ timeout: 15_000 });
    await tab.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${ctx.project.id}/agents$`));
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();

    // Both the memory doc and the access lock live here together.
    await expect(page.getByTestId('agent-context-section')).toBeVisible();
    await expect(page.getByTestId('agent-access-section')).toBeVisible();

    // A path to actually connecting an agent is right here too, not just a
    // description of what agents can do once connected.
    await expect(page.getByTestId('connect-agent-callout')).toBeVisible();

    // Settings no longer buries them — but still helps a habitual scroller
    // find the new home.
    await page.goto(`/projects/${ctx.project.id}/settings`);
    await expect(page.getByTestId('agent-access-section')).toHaveCount(0);
    await expect(page.getByTestId('agent-context-section')).toHaveCount(0);
    const pointer = page.getByTestId('settings-agents-pointer');
    await expect(pointer).toBeVisible();
    await pointer.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${ctx.project.id}/agents$`));
  });

  test('agent access still really locks the project from this new home', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'agents-tab-lock',
      projectName: 'Agents Tab Lock QA',
      openBoard: false,
    });

    const tokenRes = await request.post(`${API_URL}/api/me/tokens`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { name: 'mcp-agent' },
    });
    const pat = (await tokenRes.json()).rawToken as string;

    await page.goto(`/projects/${ctx.project.id}/agents`);
    const toggle = page.getByTestId('agent-read-only-toggle');
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    const res = await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${pat}` },
      data: { projectId: ctx.project.id, title: 'blocked write' },
    });
    expect(res.status()).toBe(403);
  });
});

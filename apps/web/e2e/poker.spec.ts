/**
 * Planning Poker e2e tests.
 *
 * Design: every test is fully self-contained — each one logs in, creates its
 * own session, and runs its assertions.  `beforeAll` only seeds issues via the
 * API so individual tests don't repeat that cost; it does NOT navigate or
 * create sessions.  This avoids cross-test shared mutable state that breaks
 * under Playwright's parallel worker model (module-level `sessionUrl` set by
 * one test then read by another in a different worker where it is undefined).
 *
 * Desktop tests use the default chromium viewport; mobile tests use a 390×844
 * viewport configured via test.use() inside their describe block.
 */

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import {
  setupIsolatedProject,
  createIssue,
  API_URL,
  login,
  type IsolatedContext,
} from './helpers';

const MOBILE_VIEWPORT = { width: 390, height: 844 };

// ── Shared helpers ─────────────────────────────────────────────────────────────

/** Navigate to the project's poker index page and wait for the heading. */
async function goToPokerPage(page: Page, projectId: string): Promise<void> {
  await page.goto(`/projects/${projectId}/poker`);
  await expect(
    page.getByRole('heading', { name: /planning poker/i }),
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * Create a poker session via the UI modal.
 * Expects the "Planning Poker" index page to already be open.
 * Returns the URL of the newly-created session page.
 */
async function createPokerSession(
  page: Page,
  sessionName: string,
): Promise<string> {
  await page.getByTestId('poker-start').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  await dialog.getByLabel(/session name/i).fill(sessionName);

  // Wait for the issues list to load (at least one checkbox appears) before
  // trying to select all — avoids the race where filteredIssues is empty and
  // "Select all" is either hidden or a no-op.
  await expect(
    dialog.locator('input[type="checkbox"]').first(),
  ).toBeVisible({ timeout: 15_000 });

  // Click "Select all" to check every issue in the list.
  const selectAll = dialog.getByRole('button', { name: /select all/i });
  await expect(selectAll).toBeVisible({ timeout: 5_000 });
  await selectAll.click();

  // Confirm at least one issue is now selected (button becomes enabled).
  const startBtn = dialog.getByRole('button', { name: /start session/i });
  await expect(startBtn).toBeEnabled({ timeout: 5_000 });
  await startBtn.click();

  await expect(page).toHaveURL(/\/poker\//, { timeout: 15_000 });
  await expect(page.getByTestId('poker-session')).toBeVisible({
    timeout: 15_000,
  });

  return page.url();
}

/**
 * Log in as ctx.user, navigate to the poker index, and create a fresh session.
 * Call this at the start of each test that needs an open session page so the
 * test is fully self-contained regardless of worker assignment.
 */
async function loginAndOpenSession(
  page: Page,
  ctx: IsolatedContext,
  sessionSuffix: string,
): Promise<string> {
  await login(page, { email: ctx.user.email, password: ctx.user.password });
  await goToPokerPage(page, ctx.project.id);
  return createPokerSession(page, `Poker Session ${sessionSuffix}`);
}

/** Click the first item in the sidebar list to activate it. */
async function activateFirstItem(page: Page): Promise<void> {
  const firstItem = page.locator('[data-testid^="poker-item-"]').first();
  await expect(firstItem).toBeVisible({ timeout: 10_000 });
  await firstItem.click();
  // Confirming activation: the vote-status strip becomes visible.
  await expect(page.getByTestId('poker-vote-status')).toBeVisible({
    timeout: 10_000,
  });
}

// ── Desktop tests ─────────────────────────────────────────────────────────────

test.describe('Planning Poker — desktop', () => {
  let ctx: IsolatedContext;
  let issue1Id: string;
  let issue1Key: string;

  test.beforeAll(async ({ browser, request }) => {
    const page = await browser.newPage();
    ctx = await setupIsolatedProject(page, request, {
      label: 'poker-desktop',
      openBoard: false,
    });

    // Seed two issues so every session has items to work with.
    const r1 = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Poker issue alpha',
    });
    issue1Id = r1.id;
    issue1Key = r1.key;
    await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Poker issue beta',
    });

    await page.close();
  });

  test('create a session from the poker index page', async ({ page }) => {
    await login(page, { email: ctx.user.email, password: ctx.user.password });
    await goToPokerPage(page, ctx.project.id);
    await createPokerSession(page, 'Sprint Estimation Test');

    await expect(page.getByTestId('poker-session')).toBeVisible();
  });

  test('item list shows items; clicking one makes it active', async ({
    page,
  }) => {
    await loginAndOpenSession(page, ctx, 'item-list');

    await activateFirstItem(page);

    // Issue key chip is visible in the active-item card header.
    await expect(page.getByText(issue1Key).first()).toBeVisible();
  });

  test('cast a vote: card highlights and vote status updates', async ({
    page,
  }) => {
    await loginAndOpenSession(page, ctx, 'vote');

    await activateFirstItem(page);

    const card5 = page.getByTestId('poker-deck-card-5');
    await expect(card5).toBeVisible();
    await card5.click();

    // Selected card gets aria-pressed="true".
    await expect(card5).toHaveAttribute('aria-pressed', 'true', {
      timeout: 10_000,
    });

    // Vote status strip increments to at least 1 vote.
    await expect(page.getByTestId('poker-vote-status')).toContainText('1', {
      timeout: 10_000,
    });
  });

  test('reveal cards — commit controls appear after reveal', async ({
    page,
  }) => {
    await loginAndOpenSession(page, ctx, 'reveal');

    await activateFirstItem(page);

    // Cast a vote first so there is something to reveal.
    const card8 = page.getByTestId('poker-deck-card-8');
    await card8.click();
    await expect(card8).toHaveAttribute('aria-pressed', 'true', {
      timeout: 10_000,
    });

    // Reveal.
    const revealBtn = page.getByTestId('poker-reveal');
    await expect(revealBtn).toBeVisible();
    await revealBtn.click();

    // Commit button appears for the facilitator after reveal.
    await expect(page.getByTestId('poker-commit')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('commit estimate — story points land on the issue', async ({
    page,
    request: req,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await loginAndOpenSession(page, ctx, 'commit');

    await activateFirstItem(page);

    // Vote card 13.
    const card13 = page.getByTestId('poker-deck-card-13');
    await card13.click();
    await expect(card13).toHaveAttribute('aria-pressed', 'true', {
      timeout: 10_000,
    });

    // Reveal cards.
    await page.getByTestId('poker-reveal').click();

    // Wait for commit controls to appear.
    const commitBtn = page.getByTestId('poker-commit');
    await expect(commitBtn).toBeVisible({ timeout: 10_000 });

    // Fill in the estimate and commit.
    const commitInput = page.getByLabel(/final estimate/i);
    await commitInput.fill('13');
    await commitBtn.click();

    // Toast confirms the commit.
    await expect(page.getByText(/estimate committed/i)).toBeVisible({
      timeout: 10_000,
    });

    // Verify via API that story points were written to the issue.
    const res = await req.get(`${API_URL}/api/issues/${issue1Id}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { storyPoints: number | null };
    expect(body.storyPoints).toBe(13);
  });
});

// ── Mobile tests ──────────────────────────────────────────────────────────────

test.describe('Planning Poker — mobile', () => {
  let ctx: IsolatedContext;

  test.use({ viewport: MOBILE_VIEWPORT });

  test.beforeAll(async ({ browser, request }) => {
    const page = await browser.newPage();
    ctx = await setupIsolatedProject(page, request, {
      label: 'poker-mobile',
      openBoard: false,
    });

    await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Mobile poker issue',
    });

    await page.close();
  });

  test('can create session and cast vote on mobile', async ({ page }) => {
    await loginAndOpenSession(page, ctx, 'mobile-vote');

    await expect(page.getByTestId('poker-session')).toBeVisible();

    await activateFirstItem(page);

    const card3 = page.getByTestId('poker-deck-card-3');
    await expect(card3).toBeVisible();
    await card3.click();
    await expect(card3).toHaveAttribute('aria-pressed', 'true', {
      timeout: 10_000,
    });

    await expect(page.getByTestId('poker-vote-status')).toContainText('1', {
      timeout: 10_000,
    });
  });

  test('backlog page has poker entry point on mobile', async ({ page }) => {
    await login(page, { email: ctx.user.email, password: ctx.user.password });

    await page.goto(`/projects/${ctx.project.id}/backlog`);
    await expect(page).toHaveURL(/\/backlog/, { timeout: 15_000 });

    const pokerLink = page.getByRole('link', { name: /estimate.*poker/i });
    await expect(pokerLink).toBeVisible({ timeout: 10_000 });
    await pokerLink.click();
    await expect(page).toHaveURL(/\/poker/, { timeout: 15_000 });
  });
});

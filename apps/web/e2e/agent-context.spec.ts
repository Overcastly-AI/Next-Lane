/**
 * agent-context.spec.ts
 *
 * Web UI for the per-project agent-context handoff document (backend +
 * MCP surface shipped in commit 8ffc160, `apps/api/src/agent-context/`):
 * `GET/PUT /projects/:id/agent-context`, realtime
 * `project-agent-context.updated` event.
 *
 * Covers, on both configured Playwright projects (chromium-desktop 1280,
 * mobile-chrome ~393px) via the shared playwright.config.ts:
 *   1. Empty state renders for a brand-new project.
 *   2. An effective MEMBER+ (the project owner/ADMIN) writes content via
 *      Edit → Save; it renders as markdown and survives a reload.
 *   3. A second live browser session (same content, no reload) sees the
 *      update via the realtime `project-agent-context.updated` invalidation
 *      path.
 *   4. The staleness pill ("N changes since last update") appears live,
 *      without reload, after another session changes an issue in the
 *      project (exercises the ISSUE_EVENTS → agent-context invalidation
 *      added alongside the dedicated event).
 *   5. A workspace VIEWER sees the document read-only — no Edit control, no
 *      textarea.
 *   6. The 64 KB cap surfaces as an inline error (not just a toast) without
 *      losing the in-progress draft.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  setupIsolatedProject,
  registerNewUser,
  addWorkspaceMember,
  createIssue,
  type RegisteredUser,
  type IsolatedContext,
} from './helpers';

async function gotoSettings(page: Page, projectId: string): Promise<void> {
  await page.goto(`/projects/${projectId}/settings`);
  await expect(
    page.getByRole('heading', { name: /^settings$/i }).first(),
  ).toBeVisible({ timeout: 15_000 });
}

function agentSection(page: Page) {
  return page.getByTestId('agent-context-section');
}

/** Log a user into a fresh browser context via a directly-injected JWT (no UI login). */
async function loginViaToken(
  ctx: BrowserContext,
  user: RegisteredUser,
): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.evaluate(
    ({ token, key }) => {
      localStorage.clear();
      localStorage.setItem(key, token);
    },
    { token: user.token, key: 'nl_token' },
  );
  return page;
}

test.describe('Agent context panel', () => {
  test('empty state renders for a brand-new project', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ac-empty',
      projectName: 'Agent Context Empty Project',
      openBoard: false,
    });

    await gotoSettings(page, ctx.project.id);
    const section = agentSection(page);
    await expect(section.getByRole('heading', { name: 'Agent context' })).toBeVisible();
    await expect(
      section.getByText(/Persistent handoff memory for AI agents/i),
    ).toBeVisible();
    await expect(section.getByTestId('agent-context-empty')).toContainText(
      /No agent handoff yet/i,
    );
    await expect(section.getByText(/Never updated/i)).toBeVisible();
    await expect(section.getByTestId('agent-context-staleness-pill')).toHaveCount(0);
    // Owner is effectively ADMIN (MEMBER+) — the Edit control is present.
    await expect(section.getByTestId('agent-context-edit')).toBeVisible();
  });

  test('member writes content, it renders as markdown after save, and survives reload', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ac-write',
      projectName: 'Agent Context Write Project',
      openBoard: false,
    });

    await gotoSettings(page, ctx.project.id);
    const section = agentSection(page);
    await section.getByTestId('agent-context-edit').click();

    const textarea = section.getByTestId('agent-context-textarea');
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeFocused();
    const content = '# Handoff\n\nCurrent goal: **ship the panel**.\n\n- next step one';
    await textarea.pressSequentially(content, { delay: 5 });

    await section.getByTestId('agent-context-save').click();
    await expect(page.locator('[data-toast][data-variant="success"]')).toBeVisible({
      timeout: 10_000,
    });

    const rendered = section.getByTestId('agent-context-rendered');
    await expect(rendered).toBeVisible();
    await expect(rendered.getByRole('heading', { name: 'Handoff' })).toBeVisible();
    await expect(rendered.locator('strong')).toHaveText('ship the panel');
    await expect(section.getByText(/Updated .* by/i)).toBeVisible();

    // Survives reload.
    await page.reload();
    await expect(agentSection(page).getByTestId('agent-context-rendered')).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      agentSection(page).getByRole('heading', { name: 'Handoff' }),
    ).toBeVisible();
  });

  test('a second live session sees the save without reload, then a viewer sees read-only', async ({
    page,
    request,
    browser,
  }) => {
    const ctx: IsolatedContext = await setupIsolatedProject(page, request, {
      label: 'ac-live',
      projectName: 'Agent Context Live Project',
      openBoard: false,
    });

    // Session B: the SAME user, a second live browser context, already on
    // the settings page before the write happens in session A.
    const ctxB = await browser.newContext();
    const pageB = await loginViaToken(ctxB, ctx.user);
    await gotoSettings(pageB, ctx.project.id);
    await expect(agentSection(pageB).getByTestId('agent-context-empty')).toBeVisible();

    // Session A writes.
    await gotoSettings(page, ctx.project.id);
    const sectionA = agentSection(page);
    await sectionA.getByTestId('agent-context-edit').click();
    await sectionA
      .getByTestId('agent-context-textarea')
      .pressSequentially('Live handoff note for the next agent.', { delay: 5 });
    await sectionA.getByTestId('agent-context-save').click();
    await expect(page.locator('[data-toast][data-variant="success"]')).toBeVisible({
      timeout: 10_000,
    });

    // Session B sees it live — no reload — via the
    // `project-agent-context.updated` socket invalidation.
    await expect(
      agentSection(pageB).getByTestId('agent-context-rendered'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(agentSection(pageB)).toContainText('Live handoff note for the next agent.');

    // A separate workspace VIEWER sees the same document read-only.
    const viewer = await registerNewUser(request, 'ac-viewer');
    await addWorkspaceMember(request, ctx.token, ctx.workspaceId, viewer.email, 'VIEWER');
    const ctxC = await browser.newContext();
    const pageC = await loginViaToken(ctxC, viewer);
    await gotoSettings(pageC, ctx.project.id);
    const sectionC = agentSection(pageC);
    await expect(sectionC.getByTestId('agent-context-rendered')).toBeVisible({
      timeout: 10_000,
    });
    await expect(sectionC).toContainText('Live handoff note for the next agent.');
    await expect(sectionC.getByTestId('agent-context-edit')).toHaveCount(0);
    await expect(sectionC.getByTestId('agent-context-textarea')).toHaveCount(0);

    await pageB.close();
    await ctxB.close();
    await pageC.close();
    await ctxC.close();
  });

  test('staleness pill appears live after another session changes an issue', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ac-stale',
      projectName: 'Agent Context Staleness Project',
      openBoard: false,
    });

    // Write the handoff document first, establishing a baseline updatedAt.
    await gotoSettings(page, ctx.project.id);
    const section = agentSection(page);
    await section.getByTestId('agent-context-edit').click();
    await section
      .getByTestId('agent-context-textarea')
      .pressSequentially('Baseline handoff.', { delay: 5 });
    await section.getByTestId('agent-context-save').click();
    await expect(page.locator('[data-toast][data-variant="success"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(section.getByTestId('agent-context-staleness-pill')).toHaveCount(0);

    // Another session (the API, standing in for a teammate/agent) changes
    // the project — creates a new issue — after the handoff was written.
    await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Unrelated change after the handoff was written',
    });

    // The staleness pill appears live, without reload, via the ISSUE_EVENTS
    // → agent-context invalidation.
    await expect(section.getByTestId('agent-context-staleness-pill')).toBeVisible({
      timeout: 10_000,
    });
    await expect(section.getByTestId('agent-context-staleness-pill')).toContainText(
      /change.*since last update/i,
    );
  });

  test('the 64 KB cap surfaces as an inline error without discarding the draft', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ac-cap',
      projectName: 'Agent Context Cap Project',
      openBoard: false,
    });

    await gotoSettings(page, ctx.project.id);
    const section = agentSection(page);
    await section.getByTestId('agent-context-edit').click();
    const textarea = section.getByTestId('agent-context-textarea');

    // Paste (not per-keystroke — 64 KB is impractical to type) an over-cap
    // string via fill, then attempt to save.
    const overCap = 'a'.repeat(64 * 1024 + 1);
    await textarea.fill(overCap);
    await section.getByTestId('agent-context-save').click();

    const inlineError = section.getByTestId('agent-context-save-error');
    await expect(inlineError).toBeVisible({ timeout: 10_000 });
    await expect(inlineError).toContainText(/64 KB/i);
    // Draft (still editing) is preserved — not silently discarded.
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue(overCap);
  });
});

// ---------------------------------------------------------------------------
// Mobile (393px) — populated panel renders without overflow
// ---------------------------------------------------------------------------

test.describe('Agent context panel — mobile (393px)', () => {
  test.use({ viewport: { width: 393, height: 851 } });

  test('populated panel with a staleness pill renders without horizontal overflow', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'ac-mob',
      projectName: 'Agent Context Mobile Project',
      openBoard: false,
    });

    await gotoSettings(page, ctx.project.id);
    const section = agentSection(page);
    await section.getByTestId('agent-context-edit').click();
    await section
      .getByTestId('agent-context-textarea')
      .pressSequentially('# Mobile handoff\n\nWorks on small screens too.', { delay: 5 });
    await section.getByTestId('agent-context-save').click();
    await expect(page.locator('[data-toast][data-variant="success"]')).toBeVisible({
      timeout: 10_000,
    });

    await createIssue(request, ctx.token, ctx.project.id, { title: 'Mobile staleness trigger' });
    await expect(section.getByTestId('agent-context-staleness-pill')).toBeVisible({
      timeout: 10_000,
    });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

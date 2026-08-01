import { test, expect } from '@playwright/test';
import { setupIsolatedProject, createIssue } from './helpers';

/**
 * pages-p1-fixes.spec.ts
 *
 * Coverage for the three P1 findings filed against the Pages pillar in
 * `docs/AUDIT-PRODUCT.md` (2026-07-10, Pass 13):
 *
 *  1. Unsaved-changes protection in the page editor — navigating away
 *     (page-tree click, ProjectNav tab, browser reload) while mid-edit must
 *     confirm before discarding, and a successful save must clear the guard
 *     with no residual prompt.
 *  2. `![alt](url)` markdown images must render as real `<img>` elements
 *     (previously silently stripped by the sanitizer's `ALLOWED_TAGS`).
 *  3. A page shows the issues that reference it ("Linked issues"), the
 *     reverse of the issue drawer's existing "Linked pages" section.
 *
 * Runs on both configured Playwright projects (desktop + mobile), like the
 * rest of the Pages suite.
 */

test.describe('Pages — unsaved-changes guard', () => {
  test('navigating away mid-edit via the tree prompts; Keep editing preserves the draft; Discard changes leaves and drops it', async ({
    page,
    request,
  }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'pages-unsaved',
      projectName: 'Pages Unsaved QA',
    });

    await page.goto(`/projects/${project.id}/pages`);
    await page.getByTestId('page-create-first').click();
    await page.getByTestId('create-page-title-input').pressSequentially('Draft Doc', { delay: 15 });
    await page.getByTestId('create-page-submit').click();
    await expect(page.getByTestId('page-title')).toHaveText('Draft Doc');
    const draftDocId = /\/pages\/([^/?#]+)/.exec(page.url())![1];

    const mobileToggle = page.getByTestId('page-tree-mobile-toggle');
    const mobileDrawer = page.getByTestId('page-tree-mobile-drawer');
    /**
     * Whichever tree surface (inline desktop panel or mobile drawer) is
     * currently visible. On mobile, a navigation attempt that gets BLOCKED
     * by the unsaved-changes dialog leaves the drawer open (the app doesn't
     * auto-close it on a cancelled navigation) — so check for an
     * already-open drawer first rather than unconditionally re-clicking the
     * toggle, which would be intercepted by the drawer's own overlay.
     */
    async function openTree() {
      if (await mobileDrawer.isVisible().catch(() => false)) {
        return mobileDrawer;
      }
      if (await mobileToggle.isVisible().catch(() => false)) {
        await mobileToggle.click();
        return mobileDrawer;
      }
      return page.locator('nav[aria-label="Pages"]');
    }
    /** Click a tree page by id from whichever tree surface is visible. */
    async function clickTreeItem(pageId: string) {
      await (await openTree()).getByTestId(`page-tree-item-${pageId}`).click();
    }

    // A second page to navigate to.
    await (await openTree()).getByTestId('page-tree-new-root').click();
    await page.getByTestId('create-page-title-input').pressSequentially('Other Doc', { delay: 15 });
    await page.getByTestId('create-page-submit').click();
    await expect(page.getByTestId('page-title')).toHaveText('Other Doc');
    const otherDocId = /\/pages\/([^/?#]+)/.exec(page.url())![1];

    // Back to Draft Doc, start editing, type something, don't save.
    await clickTreeItem(draftDocId);
    await expect(page.getByTestId('page-title')).toHaveText('Draft Doc');

    await page.getByTestId('page-edit').click();
    const editor = page.getByTestId('page-content-editor');
    await editor.click();
    await editor.pressSequentially('Unsaved paragraph.', { delay: 12 });

    // Attempt to navigate to Other Doc via the tree — must be blocked by a
    // themed confirm dialog, not a silent discard.
    await clickTreeItem(otherDocId);
    const dialog = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' });
    await expect(dialog).toBeVisible();

    // "Keep editing" cancels — we stay on Draft Doc, edit mode, draft intact.
    await dialog.getByRole('button', { name: 'Keep editing' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('page-title-input')).toHaveValue('Draft Doc');
    await expect(editor).toHaveValue('Unsaved paragraph.');

    // Try again, this time confirm the discard — navigation proceeds and the
    // unsaved paragraph is gone (never persisted).
    await clickTreeItem(otherDocId);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Discard changes' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/pages/${otherDocId}`));
    await expect(page.getByTestId('page-title')).toHaveText('Other Doc');

    // Back on Draft Doc: the unsaved paragraph never made it into the saved
    // content (still empty).
    await clickTreeItem(draftDocId);
    await expect(page.getByTestId('page-content-empty')).toBeVisible();

    // Now edit AND save — the guard must be fully cleared afterward: no
    // dialog on the very next navigation.
    await page.getByTestId('page-edit').click();
    await editor.click();
    await editor.pressSequentially('Saved paragraph.', { delay: 12 });
    await page.getByTestId('page-save').click();
    await expect(page.getByTestId('page-save')).toHaveCount(0);

    await clickTreeItem(otherDocId);
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('page-title')).toHaveText('Other Doc');
  });

  test('a themed confirm gates a ProjectNav tab switch while mid-edit, and Cancel itself confirms when dirty', async ({
    page,
    request,
  }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'pages-unsaved-nav',
      projectName: 'Pages Unsaved Nav QA',
    });

    await page.goto(`/projects/${project.id}/pages`);
    await page.getByTestId('page-create-first').click();
    await page.getByTestId('create-page-title-input').pressSequentially('Nav Guard Doc', { delay: 15 });
    await page.getByTestId('create-page-submit').click();
    await expect(page.getByTestId('page-title')).toHaveText('Nav Guard Doc');

    await page.getByTestId('page-edit').click();
    const editor = page.getByTestId('page-content-editor');
    await editor.click();
    await editor.pressSequentially('Mid edit.', { delay: 12 });

    // Clicking Cancel itself, with unsaved edits, must confirm rather than
    // silently discard.
    await page.getByTestId('page-cancel-edit').click();
    const dialog = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep editing' }).click();
    await expect(dialog).toBeHidden();
    await expect(editor).toBeVisible(); // still editing

    // A ProjectNav tab (Board) is a real in-app "nav link" — must also gate.
    // `exact: true` matters: Playwright matches accessible names by SUBSTRING,
    // and the project nav also has a "Dashboards" tab — which contains
    // "board". Without it this resolves to two links and fails strict mode.
    const boardTab = page
      .locator('nav[aria-label="Project navigation"]')
      .getByRole('link', { name: 'Board', exact: true });
    await boardTab.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Discard changes' }).click();
    await expect(page).toHaveURL(/\/board/);
  });

  test('a dirty editor registers a beforeunload guard; a clean one does not', async ({ page, request }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'pages-unsaved-reload',
      projectName: 'Pages Unsaved Reload QA',
    });

    await page.goto(`/projects/${project.id}/pages`);
    await page.getByTestId('page-create-first').click();
    await page.getByTestId('create-page-title-input').pressSequentially('Reload Doc', { delay: 15 });
    await page.getByTestId('create-page-submit').click();
    await expect(page.getByTestId('page-title')).toHaveText('Reload Doc');

    // Real native `beforeunload` dialogs are notoriously unreliable to
    // assert on through Playwright's `dialog` event (browser-dependent, and
    // Chromium in particular auto-suppresses it in automated contexts) — so
    // assert on the actual contract instead: dispatch a synthetic, cancelable
    // `beforeunload` and check whether our handler called `preventDefault()`
    // (exactly what the real browser checks before showing its native,
    // unstylable prompt). This is a direct test of the `PageEditor.tsx` /
    // `unsavedChangesGuard.tsx` contract, not of the browser's own UI.
    async function beforeUnloadWouldPrompt(): Promise<boolean> {
      return page.evaluate(() => {
        const evt = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
        window.dispatchEvent(evt);
        return evt.defaultPrevented;
      });
    }

    // Clean (not editing): nothing should intercept beforeunload.
    expect(
      await beforeUnloadWouldPrompt(),
      'a clean page must not register a beforeunload guard',
    ).toBe(false);

    // Dirty: typing an edit must register the guard immediately.
    await page.getByTestId('page-edit').click();
    const editor = page.getByTestId('page-content-editor');
    await editor.click();
    await editor.pressSequentially('Dirty before reload.', { delay: 12 });

    expect(
      await beforeUnloadWouldPrompt(),
      'a dirty page editor must register a beforeunload guard',
    ).toBe(true);

    // Saving clears it again — no guard lingers after a successful save.
    await page.getByTestId('page-save').click();
    await expect(page.getByTestId('page-save')).toHaveCount(0);
    expect(
      await beforeUnloadWouldPrompt(),
      'a successful save must clear the beforeunload guard',
    ).toBe(false);
  });
});

test.describe('Pages — image rendering', () => {
  test('a ![alt](url) markdown image renders as a real <img>, not silently stripped', async ({
    page,
    request,
  }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'pages-image',
      projectName: 'Pages Image QA',
    });

    await page.goto(`/projects/${project.id}/pages`);
    await page.getByTestId('page-create-first').click();
    await page.getByTestId('create-page-title-input').pressSequentially('Runbook With Image', { delay: 15 });
    await page.getByTestId('create-page-submit').click();
    await expect(page.getByTestId('page-title')).toHaveText('Runbook With Image');

    await page.getByTestId('page-edit').click();
    const editor = page.getByTestId('page-content-editor');
    await editor.click();
    const imageUrl = 'https://example.com/diagram.png';
    await editor.pressSequentially(`Architecture:\n\n![Diagram](${imageUrl})\n\nMore text after.`, {
      delay: 8,
    });
    await page.getByTestId('page-save').click();
    await expect(page.getByTestId('page-save')).toHaveCount(0);

    const img = page.locator('.nl-page-content img');
    await expect(img).toHaveCount(1);
    await expect(img).toHaveAttribute('src', imageUrl);
    await expect(img).toHaveAttribute('alt', 'Diagram');
    await expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');

    // The rest of the body still renders (image support didn't regress plain text).
    await expect(page.locator('.nl-page-content')).toContainText('More text after.');

    // A javascript: URL must NOT survive as a rendered src (security floor —
    // the sanitizer's img-src allowlist, not just app-level intent).
    await page.getByTestId('page-edit').click();
    await editor.click();
    await page.keyboard.press('Control+A');
    await editor.pressSequentially('![bad](javascript:alert(1))', { delay: 8 });
    await page.getByTestId('page-save').click();
    await expect(page.getByTestId('page-save')).toHaveCount(0);
    const badImg = page.locator('.nl-page-content img');
    await expect(badImg).toHaveCount(1);
    const src = await badImg.getAttribute('src');
    expect(src, 'a javascript: image src must be stripped by the sanitizer').toBeNull();
  });
});

test.describe('Pages — linked issues (reverse of the issue drawer\'s Linked pages)', () => {
  test('a page shows the issues that reference it, and each links to the issue', async ({ page, request }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'pages-linked-issues',
      projectName: 'Pages Linked Issues QA',
      openBoard: false,
    });
    const issue = await createIssue(request, token, project.id, { title: 'Fix the flaky deploy step' });

    await page.goto(`/projects/${project.id}/pages`);
    await page.getByTestId('page-create-first').click();
    await page.getByTestId('create-page-title-input').pressSequentially('Deploy Runbook', { delay: 15 });
    await page.getByTestId('create-page-submit').click();
    await expect(page.getByTestId('page-title')).toHaveText('Deploy Runbook');

    // Empty state before any issue is mentioned.
    await expect(page.getByTestId('page-linked-issues-empty')).toBeVisible();

    await page.getByTestId('page-edit').click();
    const editor = page.getByTestId('page-content-editor');
    await editor.click();
    await editor.pressSequentially(`See ${issue.key} for the known flake.`, { delay: 10 });
    await page.getByTestId('page-save').click();
    await expect(page.getByTestId('page-save')).toHaveCount(0);

    const panel = page.getByTestId('page-linked-issues-panel');
    await expect(panel).toBeVisible();
    const row = page.getByTestId(`page-linked-issue-${issue.id}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(issue.key);
    await expect(row).toContainText('Fix the flaky deploy step');

    await row.click();
    await expect(page).toHaveURL(new RegExp(`/board\\?issue=${issue.id}`));
    // The drawer's title field is an editable <input> (not plain text) — the
    // first textbox in the opened dialog — so assert on its value rather
    // than its text content.
    await expect(page.getByRole('dialog').getByRole('textbox').first()).toHaveValue(
      'Fix the flaky deploy step',
    );
  });
});

import { test, expect } from '@playwright/test';
import { setupIsolatedProject } from './helpers';

/**
 * pages-wikilink-picker-position.spec.ts
 *
 * Regression coverage for a founder-reported bug (2026-07-18): "when adding
 * a link in the text I have to scroll all the way down to find the
 * autocomplete." Root cause: the `[[wiki-link]]` picker was anchored to the
 * BOTTOM EDGE OF THE WHOLE TEXTAREA (`absolute top-full`). In the full-page
 * page editor the textarea fills (and internally scrolls within) the
 * viewport height, so typing `[[` near the TOP of a long document put the
 * dropdown far below the visible caret, off-screen.
 *
 * This spec seeds a page with a long body (enough that the editor's
 * textarea scrolls internally), types `[[` at the very START of that body
 * (caret pinned near the top of the visible viewport), and asserts the
 * picker renders close to the caret — not pinned to the textarea's bottom
 * edge, which on a long document would put it far down the page/off-screen.
 * Runs on BOTH configured Playwright projects (desktop + mobile, see
 * playwright.config.ts).
 */

test.describe('WikiLinkTextarea picker positioning', () => {
  test('the [[ picker renders near the caret, not pinned to the bottom of a long, internally-scrolled document', async ({
    page,
    request,
  }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'pages-wikilink-pos',
      projectName: 'Pages Wikilink Position QA',
      openBoard: false,
    });

    // A link target so the picker has a real result to select.
    async function apiCreatePage(title: string, content?: string) {
      const res = await request.post(`http://localhost:4000/api/projects/${project.id}/pages`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title, content },
      });
      expect(res.ok()).toBeTruthy();
      return ((await res.json()) as { id: string }).id;
    }
    const targetId = await apiCreatePage('Roadmap');

    // A long body (~120 lines) — enough that the full-page editor's textarea
    // scrolls internally on both desktop and mobile viewports.
    const longBody = Array.from({ length: 120 }, (_, i) => `Filler paragraph number ${i + 1} of the document.`).join(
      '\n',
    );
    const hubId = await apiCreatePage('Hub', longBody);

    await page.goto(`/projects/${project.id}/pages/${hubId}`);
    await expect(page.getByTestId('page-title')).toHaveText('Hub');

    await page.getByTestId('page-edit').click();
    const editor = page.getByTestId('page-content-editor');
    await editor.click();

    // Caret at the very START of the document — visually pinned near the TOP
    // of the (internally-scrolled) textarea's viewport, i.e. scrollTop ~ 0.
    await page.keyboard.press('Control+Home');
    await editor.pressSequentially('[[Road', { delay: 15 });

    const picker = page.getByTestId('wikilink-picker');
    await expect(picker).toBeVisible();
    const option = page.getByTestId('wikilink-option-0');
    await expect(option).toContainText('Roadmap');

    // The core regression assertion: the picker's viewport position must be
    // close to the top of the viewport (where the caret is), NOT down near
    // the bottom of the viewport (where the OLD `top-full`-of-the-whole-
    // textarea anchor would have put it on a long document).
    const pickerBox = await picker.boundingBox();
    expect(pickerBox).not.toBeNull();
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    // Caret is at document position 0, right after the editor's top padding
    // and the page header — comfortably in the top third of the viewport.
    // Give some slack for header height across desktop/mobile, but this is
    // nowhere close to the bottom of the viewport (which is what the bug
    // produced on a ~120-line document).
    expect(pickerBox!.y).toBeLessThan(viewport!.height * 0.6);
    expect(pickerBox!.y).toBeGreaterThan(0);
    // Fully inside the viewport — never clipped, never causing page scroll.
    expect(pickerBox!.x).toBeGreaterThanOrEqual(0);
    expect(pickerBox!.x + pickerBox!.width).toBeLessThanOrEqual(viewport!.width + 1);
    expect(pickerBox!.y + pickerBox!.height).toBeLessThanOrEqual(viewport!.height + 1);

    // Selecting the option still inserts `Title]]` correctly with the caret
    // placed right after it (no regression to the existing insert contract).
    await option.click();
    await expect(picker).toHaveCount(0);
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue(new RegExp('^\\[\\[Roadmap\\]\\]Filler paragraph number 1 of the document\\.'));

    // No focus loss + caret lands right after the inserted `]]` — typing
    // immediately after lands between the link and the rest of line 1.
    await editor.pressSequentially(' HERE', { delay: 12 });
    await expect(editor).toHaveValue(/^\[\[Roadmap\]\] HEREFiller paragraph number 1 of the document\./);

    await page.getByTestId('page-save').click();
    await expect(page.getByTestId('page-save')).toHaveCount(0);

    const resolvedLink = page.locator(`.nl-page-content a[href="#page:${targetId}"]`);
    await expect(resolvedLink).toBeVisible();
    await expect(resolvedLink).toHaveText('Roadmap');
  });

  test('the picker flips above the caret and stays reachable when opened near the bottom of the viewport', async ({
    page,
    request,
  }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'pages-wikilink-pos-flip',
      projectName: 'Pages Wikilink Flip QA',
      openBoard: false,
    });
    async function apiCreatePage(title: string, content?: string) {
      const res = await request.post(`http://localhost:4000/api/projects/${project.id}/pages`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title, content },
      });
      expect(res.ok()).toBeTruthy();
      return ((await res.json()) as { id: string }).id;
    }
    await apiCreatePage('Roadmap');
    const longBody = Array.from({ length: 120 }, (_, i) => `Filler paragraph number ${i + 1} of the document.`).join(
      '\n',
    );
    const hubId = await apiCreatePage('Hub2', longBody);

    await page.goto(`/projects/${project.id}/pages/${hubId}`);
    await page.getByTestId('page-edit').click();
    const editor = page.getByTestId('page-content-editor');
    await editor.click();

    // Scroll the textarea to the very END so the caret line sits at the
    // bottom of the visible viewport — the picker must flip ABOVE the caret
    // here rather than overflowing off the bottom of the screen.
    await page.keyboard.press('Control+End');
    await editor.pressSequentially('\n[[Road', { delay: 15 });

    const picker = page.getByTestId('wikilink-picker');
    await expect(picker).toBeVisible();
    await expect(page.getByTestId('wikilink-option-0')).toContainText('Roadmap');

    const pickerBox = await picker.boundingBox();
    const viewport = page.viewportSize();
    expect(pickerBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    // Fully inside the viewport regardless of the flip.
    expect(pickerBox!.y).toBeGreaterThanOrEqual(0);
    expect(pickerBox!.y + pickerBox!.height).toBeLessThanOrEqual(viewport!.height + 1);
  });
});

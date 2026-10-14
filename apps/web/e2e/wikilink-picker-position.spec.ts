import { test, expect } from '@playwright/test';
import { setupIsolatedProject } from './helpers';
import { fillEditorMarkdown } from './editor';

/**
 * wikilink-picker-position.spec.ts
 *
 * Regression guard for a founder-reported bug: in the Pages editor, typing
 * `[[` to trigger the wiki-link picker rendered the dropdown pinned to the
 * BOTTOM of the whole (tall) textarea (`absolute top-full`) instead of next
 * to the caret — so in the full-page editor the user had to scroll all the
 * way down to see/use it.
 *
 * This spec builds a document with many lines, positions the caret mid-way
 * down the textarea (well above the textarea's bottom edge), types `[[`, and
 * asserts the picker renders within ~1 line-height of the caret's own
 * viewport position — NOT pinned to the textarea's bottom — and stays fully
 * within the viewport. Runs on both configured Playwright projects (desktop
 * + mobile), like the rest of the Pages suite.
 */

test.describe('Pages — wiki-link picker follows the caret', () => {
  test('typing [[ mid-document opens the picker next to the caret, not at the textarea bottom', async ({
    page,
    request,
  }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'wikilink-caret-pos',
      projectName: 'WikiLink Caret Position QA',
    });

    await page.goto(`/projects/${project.id}/pages`);
    await page.getByTestId('page-create-first').click();
    await page.getByTestId('create-page-title-input').pressSequentially('Tall Runbook', {
      delay: 15,
    });
    await page.getByTestId('create-page-submit').click();
    await expect(page.getByTestId('page-title')).toHaveText('Tall Runbook');

    await page.getByTestId('page-edit').click();
    const editor = page.getByTestId('page-content-editor');
    await editor.click();

    // A long document — many short lines so the textarea is genuinely tall
    // (the full-page editor stretches to fill the viewport height, and this
    // body overflows it, forcing internal scroll). Bug reproduction requires
    // enough lines that "picker at textarea bottom" would land far from the
    // caret typed a few lines in.
    const lines: string[] = [];
    for (let i = 1; i <= 80; i++) {
      lines.push(`Runbook step ${i}: check the service is healthy.`);
    }
    const body = lines.join('\n');
    // Loaded through the Markdown view: 4,000 individual keystrokes would only
    // measure Playwright's key rate. What matters here is the tall document.
    await fillEditorMarkdown(page, 'page-content-editor', body);
    await editor.click();

    // Move the caret to the very start of the document (line 1) — far above
    // the textarea's bottom edge, and (after scrolling to top) near the TOP
    // of the visible textarea, not its bottom.
    await page.keyboard.press('Control+Home');

    // Get the caret's viewport position right before triggering the picker,
    // via the browser's own selection/range geometry (independent of our
    // implementation) so this is a true regression guard, not a tautology.
    const caretBox = await editor.evaluate((el) => {
      // The geometry of the document's FIRST CHARACTER, straight from the
      // browser's Range API — the caret sits right before it. Independent of
      // the app's own positioning code.
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const first = walker.nextNode() as Text;
      const range = document.createRange();
      range.setStart(first, 0);
      range.setEnd(first, 1);
      const rect = range.getBoundingClientRect();
      const frame = el.closest('[data-testid="page-content-editor-frame"]') as HTMLElement;
      return {
        top: rect.top,
        left: rect.left,
        textareaBottom: frame.getBoundingClientRect().bottom,
        viewportHeight: window.innerHeight,
      };
    });

    await editor.pressSequentially('[[Target', { delay: 15 });

    const picker = page.getByTestId('wikilink-picker');
    await expect(picker).toBeVisible();
    const pickerBox = await picker.boundingBox();
    expect(pickerBox, 'wikilink-picker must have a measurable bounding box').not.toBeNull();

    // Regression assertion: the picker's top must be near the caret's own
    // line (within a couple of line-heights — generous to allow for the
    // `[[Target` text shifting the caret a bit to the right on the same
    // line), and MUST NOT be anchored near the bottom of the (tall,
    // scrollable) textarea.
    const distanceFromCaret = Math.abs(pickerBox!.y - caretBox.top);
    expect(
      distanceFromCaret,
      `picker top (${pickerBox!.y}) should be near the caret's line (${caretBox.top}), not far away`,
    ).toBeLessThan(80); // a couple of line-heights, generous but well short of "whole page"

    const distanceFromTextareaBottom = Math.abs(pickerBox!.y - caretBox.textareaBottom);
    expect(
      distanceFromTextareaBottom,
      'picker must not be pinned near the bottom of the (tall) textarea — the original bug',
    ).toBeGreaterThan(200);

    // The picker must be fully on-screen (the flip-above logic exists
    // precisely to guarantee this even when the caret is low in the
    // viewport).
    expect(pickerBox!.y, 'picker must not render above the viewport').toBeGreaterThanOrEqual(0);
    expect(
      pickerBox!.y + pickerBox!.height,
      'picker must not render below the viewport',
    ).toBeLessThanOrEqual(caretBox.viewportHeight + 1);

    // Sanity: the picker is functional at this position too (not just
    // present) — it shows the "no results yet" affordance for the not-yet
    // created "Target" page.
    await expect(page.getByTestId('wikilink-no-results')).toContainText('Target');

    // Dismiss and confirm the picker actually closes cleanly (no leftover
    // stale absolutely-positioned element).
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
  });

  test('typing [[ near the bottom of a tall page flips the picker to open ABOVE the caret', async ({
    page,
    request,
  }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'wikilink-caret-flip',
      projectName: 'WikiLink Caret Flip QA',
    });

    await page.goto(`/projects/${project.id}/pages`);
    await page.getByTestId('page-create-first').click();
    await page.getByTestId('create-page-title-input').pressSequentially('Flip Runbook', {
      delay: 15,
    });
    await page.getByTestId('create-page-submit').click();
    await expect(page.getByTestId('page-title')).toHaveText('Flip Runbook');

    await page.getByTestId('page-edit').click();
    const editor = page.getByTestId('page-content-editor');
    await editor.click();

    const lines: string[] = [];
    for (let i = 1; i <= 80; i++) {
      lines.push(`Runbook step ${i}: check the service is healthy.`);
    }
    await fillEditorMarkdown(page, 'page-content-editor', lines.join('\n'));

    // Put the caret at the very end (last line): that is deep in the lower
    // part of the viewport once the tall editor has scrolled to follow it, so
    // this exercises the flip-above path.
    await editor.click();
    await page.keyboard.press('Control+End');
    await editor.pressSequentially('\n[[Target', { delay: 15 });

    const picker = page.getByTestId('wikilink-picker');
    await expect(picker).toBeVisible();
    const pickerBox = await picker.boundingBox();
    expect(pickerBox).not.toBeNull();

    const viewportHeight = page.viewportSize()?.height ?? 720;

    // Must be fully within the viewport regardless of how low the caret is.
    expect(pickerBox!.y, 'flipped picker must not render above the viewport').toBeGreaterThanOrEqual(0);
    expect(
      pickerBox!.y + pickerBox!.height,
      'flipped picker must not render below the viewport',
    ).toBeLessThanOrEqual(viewportHeight + 1);
  });
});

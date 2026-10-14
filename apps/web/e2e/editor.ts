/**
 * Helpers for driving the rich markdown editor (Tiptap) from Playwright.
 *
 * The editor has two faces, addressed by one test id:
 *   - the visual surface — a contenteditable carrying `data-testid="<id>"`
 *     (role=textbox, so `pressSequentially` / `fill` / `toHaveText` work), and
 *   - the raw Markdown textarea — `data-testid="<id>-markdown"`, only present
 *     while the field is switched to Markdown (`<id>-frame` holds the toggle).
 *
 * Specs that used to assert a textarea's `toHaveValue(markdown)` read the
 * STORED markdown through the Markdown switch instead — the same string the
 * API receives — via `editorMarkdown`.
 */
import { expect, type Locator, type Page } from '@playwright/test';

type Scope = Page | Locator;

/** The visual writing surface (contenteditable). */
export function editorSurface(scope: Scope, testId: string): Locator {
  return scope.getByTestId(testId);
}

/** The whole editor (toolbar + surface + markdown textarea). */
export function editorFrame(scope: Scope, testId: string): Locator {
  return scope.getByTestId(`${testId}-frame`);
}

/** Per-keystroke typing, as a real user does it. */
export async function typeInEditor(
  scope: Scope,
  testId: string,
  text: string,
  opts: { delay?: number; click?: boolean } = {},
): Promise<void> {
  const surface = editorSurface(scope, testId);
  if (opts.click !== false) await surface.click();
  await surface.pressSequentially(text, { delay: opts.delay ?? 15 });
}

async function toggle(scope: Scope, testId: string): Promise<void> {
  await editorFrame(scope, testId).getByTestId('editor-markdown-toggle').click();
}

/**
 * The markdown this field currently holds (what Save / Comment will send).
 * Briefly flips to the Markdown view and back, leaving the field as it was.
 */
export async function editorMarkdown(scope: Scope, testId: string): Promise<string> {
  const frame = editorFrame(scope, testId);
  const wasRich = (await frame.getAttribute('data-mode')) === 'rich';
  if (wasRich) await toggle(scope, testId);
  const md = await frame.getByTestId(`${testId}-markdown`).inputValue();
  if (wasRich) {
    await toggle(scope, testId);
    await expect(frame).toHaveAttribute('data-mode', 'rich');
    await expect(editorSurface(scope, testId)).toBeFocused();
  }
  return md;
}

/**
 * Replace the field's content with RAW markdown (for specs whose subject is
 * the rendered/saved result, not the typing). Goes through the Markdown view,
 * so the string lands exactly as given, then returns to the visual editor.
 */
export async function fillEditorMarkdown(scope: Scope, testId: string, markdown: string): Promise<void> {
  const frame = editorFrame(scope, testId);
  const wasRich = (await frame.getAttribute('data-mode')) === 'rich';
  if (wasRich) await toggle(scope, testId);
  await frame.getByTestId(`${testId}-markdown`).fill(markdown);
  if (wasRich) {
    await toggle(scope, testId);
    await expect(frame).toHaveAttribute('data-mode', 'rich');
    await expect(editorSurface(scope, testId)).toBeFocused();
  }
}

/** Expect the visual surface's plain text (chips show as their label). */
export async function expectEditorText(
  scope: Scope,
  testId: string,
  expected: string | RegExp,
): Promise<void> {
  await expect(editorSurface(scope, testId)).toHaveText(expected);
}

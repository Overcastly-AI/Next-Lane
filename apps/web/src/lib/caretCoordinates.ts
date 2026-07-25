/**
 * caretCoordinates — positions a floating element (an autocomplete picker)
 * next to the caret inside a plain `<textarea>`, instead of anchored to the
 * textarea's outer edge.
 *
 * Background (2026-07-18 founder bug): `WikiLinkTextarea`'s `[[wiki-link]]`
 * picker used to render `absolute top-full left-0` of the textarea — i.e.
 * pinned to the BOTTOM of the whole element. In the full-page page editor the
 * textarea fills (and internally scrolls within) the viewport height, so a
 * caret near the top of a long document produced a dropdown far below the
 * visible area, forcing a scroll to find it. This module fixes that by
 * computing the caret's actual pixel position and placing the picker right
 * next to it, flipping above when there isn't room below, and clamping fully
 * inside the viewport.
 *
 * Split into two pieces on purpose:
 *  - `getCaretCoordinates` (DOM-dependent): the classic "hidden mirror div"
 *    technique — replicate the textarea's box model + font metrics in an
 *    off-screen div containing the text up to the caret plus a marker
 *    `<span>`, then read the marker's offset. This needs a real DOM/layout
 *    engine so it isn't unit-testable in this repo's `environment: 'node'`
 *    vitest config (see `vitest.config.ts`) — it's a thin, well-known
 *    technique kept deliberately small.
 *  - `computeDropdownPlacement` (pure): given the caret's coordinates plus
 *    viewport/element geometry, decide where the dropdown should render
 *    (flip above/below, clamp to viewport). This is the logic most likely to
 *    have off-by-one/edge-case bugs, and it's plain arithmetic — fully
 *    unit-tested in `caretCoordinates.test.ts`.
 */

export interface CaretPosition {
  /** Caret's top offset, in px, relative to the textarea's UNSCROLLED content box. */
  top: number;
  /** Caret's left offset, in px, relative to the textarea's UNSCROLLED content box. */
  left: number;
  /** Line height at the caret, in px — used to place the dropdown just below/above the line. */
  height: number;
}

// Style properties that affect text layout/wrapping and must be copied from
// the real textarea onto the mirror div so the mirrored text wraps and
// measures identically.
const MIRROR_STYLE_PROPS = [
  'boxSizing',
  'width',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontFamily',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'textIndent',
  'textTransform',
  'textAlign',
  'wordBreak',
] as const;

/**
 * Returns the pixel position of `position` (a caret index into `el.value`)
 * relative to the textarea's own unscrolled content box — i.e. BEFORE
 * subtracting `el.scrollTop`/`el.scrollLeft`. Callers combine this with the
 * textarea's `getBoundingClientRect()` and its current scroll offsets to get
 * a viewport-relative point (see `computeDropdownPlacement`).
 */
export function getCaretCoordinates(el: HTMLTextAreaElement, position: number): CaretPosition {
  const div = document.createElement('div');
  const computed = window.getComputedStyle(el);

  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.top = '0';
  div.style.left = '-9999px';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  div.style.overflow = 'hidden';

  for (const prop of MIRROR_STYLE_PROPS) {
    // Dynamic style-property copy from the computed style of the real
    // textarea — both sides are indexed by the same CSSStyleDeclaration keys.
    (div.style as unknown as Record<string, string>)[prop] = computed[prop as keyof CSSStyleDeclaration] as string;
  }

  document.body.appendChild(div);

  const before = el.value.substring(0, position);
  const textNode = document.createTextNode(before);
  div.appendChild(textNode);

  const marker = document.createElement('span');
  // A marker needs SOME content to have a measurable box.
  marker.textContent = el.value.substring(position, position + 1) || '.';
  div.appendChild(marker);

  const borderTop = parseFloat(computed.borderTopWidth || '0') || 0;
  const borderLeft = parseFloat(computed.borderLeftWidth || '0') || 0;
  const lineHeight = parseFloat(computed.lineHeight || '0') || marker.offsetHeight || 16;

  const coordinates: CaretPosition = {
    top: marker.offsetTop + borderTop,
    left: marker.offsetLeft + borderLeft,
    height: lineHeight,
  };

  document.body.removeChild(div);
  return coordinates;
}

export interface DropdownPlacementInput {
  /** `textarea.getBoundingClientRect()` — its position/size in the viewport. */
  textareaRect: { top: number; left: number; width: number; height: number };
  /** From `getCaretCoordinates` — caret position in unscrolled content coords. */
  caret: CaretPosition;
  /** `textarea.scrollTop` / `textarea.scrollLeft` at the time of measurement. */
  scrollTop: number;
  scrollLeft: number;
  /** Measured (or estimated, before first paint) dropdown box size. */
  dropdownWidth: number;
  dropdownHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Gap, in px, between the caret line and the dropdown. Defaults to 4. */
  gap?: number;
}

export interface DropdownPlacement {
  /** `position: fixed` top, in viewport px. */
  top: number;
  /** `position: fixed` left, in viewport px. */
  left: number;
  /** Which side of the caret line the dropdown ended up on. */
  placement: 'below' | 'above';
}

/**
 * Pure placement math: given the caret's position and viewport/dropdown
 * geometry, returns `position: fixed` coordinates for the dropdown that sit
 * right next to the caret, flip to the other side when there isn't room, and
 * are always fully inside the viewport (never clipped, never causing the
 * page to grow/scroll).
 */
export function computeDropdownPlacement(input: DropdownPlacementInput): DropdownPlacement {
  const gap = input.gap ?? 4;

  // Caret's position translated into viewport coordinates: textarea's own
  // viewport offset, plus the caret's offset within its UNSCROLLED content,
  // minus however far the textarea is currently scrolled.
  const caretViewportTop = input.textareaRect.top + input.caret.top - input.scrollTop;
  const caretViewportLeft = input.textareaRect.left + input.caret.left - input.scrollLeft;
  const caretBottom = caretViewportTop + input.caret.height;

  const spaceBelow = input.viewportHeight - caretBottom;
  const spaceAbove = caretViewportTop;

  let placement: DropdownPlacement['placement'];
  let top: number;
  if (spaceBelow >= input.dropdownHeight + gap || spaceBelow >= spaceAbove) {
    placement = 'below';
    top = caretBottom + gap;
  } else {
    placement = 'above';
    top = caretViewportTop - input.dropdownHeight - gap;
  }

  // Clamp fully inside the viewport vertically (belt-and-suspenders: the
  // flip above already usually fits, but a tiny viewport could still overflow).
  top = Math.max(gap, Math.min(top, input.viewportHeight - input.dropdownHeight - gap));

  // Clamp fully inside the viewport horizontally.
  const maxLeft = Math.max(gap, input.viewportWidth - input.dropdownWidth - gap);
  const left = Math.min(Math.max(caretViewportLeft, gap), maxLeft);

  return { top, left, placement };
}

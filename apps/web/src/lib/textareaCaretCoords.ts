/**
 * textareaCaretCoords.ts — computes the pixel position of the text caret
 * inside a `<textarea>`, relative to the textarea's own top-left (border-box)
 * corner, accounting for its current scroll offset.
 *
 * Dependency-free by design: the production CSP is `script-src 'self'`, so a
 * CDN-hosted caret-position library isn't an option, and pulling one into the
 * bundle for ~40 lines of logic isn't worth it either. This is the standard
 * "mirror div" technique used by libraries like `textarea-caret-position`:
 *
 *   1. Build a hidden `<div>` that replicates every CSS property affecting
 *      text layout/wrapping (font, padding, border, line-height, whitespace
 *      handling, width) so text reflows identically to the real textarea.
 *   2. Fill it with the text before the caret, then append a marker `<span>`
 *      holding the text right after the caret.
 *   3. The marker's `offsetTop`/`offsetLeft` (plus the mirror's own border,
 *      since `offsetTop`/`Left` are measured from the *padding* edge of the
 *      offset parent, not its border edge) is the caret's position relative
 *      to the textarea's border-box — from which the caller subtracts the
 *      textarea's `scrollTop`/`scrollLeft` to land in "visible viewport of
 *      the textarea" coordinates.
 */

const MIRRORED_PROPERTIES: readonly (keyof CSSStyleDeclaration)[] = [
  'boxSizing',
  'width',
  'height',
  'overflowX',
  'overflowY',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderTopStyle',
  'borderRightStyle',
  'borderBottomStyle',
  'borderLeftStyle',
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
  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'direction',
];

export interface CaretCoords {
  /** Distance from the textarea's border-box top edge to the caret's line, in px. */
  top: number;
  /** Distance from the textarea's border-box left edge to the caret, in px. */
  left: number;
  /** The caret line's height, in px — useful for positioning a popover just below/above it. */
  height: number;
}

let mirrorDiv: HTMLDivElement | null = null;

function getMirrorDiv(): HTMLDivElement {
  if (mirrorDiv && mirrorDiv.isConnected) return mirrorDiv;
  const div = document.createElement('div');
  div.setAttribute('aria-hidden', 'true');
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.top = '0';
  div.style.left = '-9999px';
  div.style.pointerEvents = 'none';
  document.body.appendChild(div);
  mirrorDiv = div;
  return div;
}

/**
 * Computes the caret's pixel position within `element`, relative to the
 * textarea's own border-box top-left corner (i.e. already adjusted for the
 * textarea's current scroll position — the returned coordinates are where
 * the caret visibly sits inside the (possibly scrolled) textarea).
 */
export function getCaretCoordinates(
  element: HTMLTextAreaElement,
  caretIndex: number,
): CaretCoords {
  const div = getMirrorDiv();
  const computed = window.getComputedStyle(element);

  // Reset, then mirror every property that affects text layout/wrapping.
  div.textContent = '';
  div.removeAttribute('style');
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.top = '0';
  div.style.left = '-9999px';
  div.style.pointerEvents = 'none';
  // Textareas always wrap and preserve whitespace — mirror that regardless
  // of any stylesheet, since it's what actually drives the reflow we need.
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';

  for (const prop of MIRRORED_PROPERTIES) {
    const value = computed[prop];
    if (typeof value === 'string') {
      div.style.setProperty(cssPropertyName(prop), value);
    }
  }

  const clampedIndex = Math.max(0, Math.min(caretIndex, element.value.length));
  div.textContent = element.value.slice(0, clampedIndex);

  const marker = document.createElement('span');
  // A non-empty marker even at end-of-text so it still occupies a line box.
  marker.textContent = element.value.slice(clampedIndex) || '.';
  div.appendChild(marker);

  const borderTop = parseFloat(computed.borderTopWidth) || 0;
  const borderLeft = parseFloat(computed.borderLeftWidth) || 0;
  const lineHeight = parseFloat(computed.lineHeight) || marker.offsetHeight || 16;

  const top = marker.offsetTop + borderTop - element.scrollTop;
  const left = marker.offsetLeft + borderLeft - element.scrollLeft;

  return { top, left, height: lineHeight };
}

/** Converts a camelCase CSSStyleDeclaration key to a kebab-case CSS property name. */
function cssPropertyName(prop: keyof CSSStyleDeclaration): string {
  return String(prop).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/** Test/cleanup hook: removes the shared mirror div from the DOM. */
export function destroyCaretMirror(): void {
  if (mirrorDiv?.parentNode) {
    mirrorDiv.parentNode.removeChild(mirrorDiv);
  }
  mirrorDiv = null;
}

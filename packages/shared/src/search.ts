/**
 * Search snippet highlighting — the delimiter contract shared by the API
 * (which produces snippets with Postgres `ts_headline`), the web UI (which
 * renders them as `<mark>`), and the MCP server (which passes them straight
 * through to an agent).
 *
 * WHY PRIVATE-USE CODE POINTS AND NOT `<b>`/`<em>`
 * ───────────────────────────────────────────────
 * `ts_headline`'s default StartSel/StopSel are `<b>`/`</b>`. Emitting raw HTML
 * into a JSON DTO is wrong for every consumer we have:
 *   • the web renders search results as TEXT nodes, so `<b>` would show up
 *     literally as the characters `<b>` (and any consumer that *did* render it
 *     as HTML would be interpreting user-authored page content as markup — an
 *     injection footgun we refuse to create);
 *   • page/issue bodies are MARKDOWN, so any ASCII-ish marker (`**`, `[hl]`,
 *     `<mark>`) can legitimately occur in the body being excerpted, making the
 *     markers ambiguous;
 *   • agents read the raw JSON, so the marker must survive JSON encoding
 *     unchanged and must never be mistaken for content.
 *
 * U+E000 / U+E001 are in the Unicode Private Use Area: permanently unassigned,
 * never produced by any keyboard or markdown tool, valid unescaped in JSON, and
 * meaningless as content. A consumer that ignores them entirely renders an
 * invisible (or at worst tofu) character rather than injecting markup — the
 * failure mode is cosmetic, not a vulnerability.
 *
 * NOTE ON UNTRUSTED CONTENT: a user *could* type U+E000 into a page body. The
 * only consequence is a spurious highlight span in the UI — {@link
 * splitSearchHighlight} always emits plain text segments, never markup, so
 * there is nothing to inject.
 *
 * Written as escape sequences on purpose: a literal PUA character in source is
 * invisible in an editor and gets mangled by copy/paste.
 */
export const SEARCH_HIGHLIGHT_START = '\uE000';
/** Closing delimiter — see {@link SEARCH_HIGHLIGHT_START}. */
export const SEARCH_HIGHLIGHT_END = '\uE001';

/**
 * Separator `ts_headline` puts between the fragments of a multi-fragment
 * snippet, and the marker the API appends when it hard-truncates an over-long
 * snippet. A horizontal ellipsis, so it reads naturally to both a human and a
 * model.
 */
export const SEARCH_SNIPPET_ELLIPSIS = '…';

/** One run of snippet text, flagged as a query match or as surrounding context. */
export interface SearchSnippetSegment {
  text: string;
  /** True when this run matched the query and should be visually emphasised. */
  highlight: boolean;
}

/**
 * Split a snippet on the highlight delimiters into plain-text segments so a UI
 * can wrap the matching runs in `<mark>` WITHOUT ever calling
 * `dangerouslySetInnerHTML`. Unpaired/stray delimiters degrade gracefully:
 * they are dropped and their text is emitted as ordinary context.
 */
export function splitSearchHighlight(snippet: string): SearchSnippetSegment[] {
  const segments: SearchSnippetSegment[] = [];
  let rest = snippet;
  for (;;) {
    const start = rest.indexOf(SEARCH_HIGHLIGHT_START);
    if (start === -1) break;
    const end = rest.indexOf(SEARCH_HIGHLIGHT_END, start + SEARCH_HIGHLIGHT_START.length);
    if (end === -1) break;
    if (start > 0) segments.push({ text: rest.slice(0, start), highlight: false });
    const inner = rest.slice(start + SEARCH_HIGHLIGHT_START.length, end);
    if (inner.length > 0) segments.push({ text: inner, highlight: true });
    rest = rest.slice(end + SEARCH_HIGHLIGHT_END.length);
  }
  if (rest.length > 0) {
    // Anything after the last complete pair, plus any stray delimiters left in
    // it, is context. Strip the delimiters so they never reach the DOM.
    const tail = stripSearchHighlight(rest);
    if (tail.length > 0) segments.push({ text: tail, highlight: false });
  }
  return segments;
}

/** Remove the highlight delimiters, leaving the plain excerpt text. */
export function stripSearchHighlight(snippet: string): string {
  return snippet
    .split(SEARCH_HIGHLIGHT_START)
    .join('')
    .split(SEARCH_HIGHLIGHT_END)
    .join('');
}

/**
 * The result groups `GET /search` can return. Callers pass a subset via
 * `?groups=` so an agent asking "what did we decide about X?" pays only for
 * the `comments` query instead of running all four.
 */
export const SEARCH_GROUPS = ['issues', 'pages', 'projects', 'comments'] as const;
export type SearchGroup = (typeof SEARCH_GROUPS)[number];

/** Default page size for every `/search` group when the caller sends no `limit`. */
export const SEARCH_DEFAULT_LIMIT = 20;
/**
 * Hard ceiling on `limit`. Snippets are generated per returned row (see
 * `ts_headline` in the API), so an unbounded page size would be both a
 * CPU and a token-budget hazard. 50 rows × ~260-char snippet ≈ 13 KB worst case.
 */
export const SEARCH_MAX_LIMIT = 50;

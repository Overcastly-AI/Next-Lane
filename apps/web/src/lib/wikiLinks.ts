/**
 * Web-side helpers built on top of `parseWikiLinks` (packages/shared/src/
 * wikilink.ts) — the ONE place that defines `[[title]]` / `[[title|alias]]`
 * syntax and resolution semantics. This module never reimplements that
 * parsing; it only adapts the shared parser's output for two web-specific
 * jobs it doesn't need to do itself:
 *   1. Resolving unresolved-link counts against a project's page tree (for
 *      the editor's "N links don't resolve yet" hint) — via `parseWikiLinks`.
 *   2. Rewriting `[[..]]` spans into standard markdown link syntax so the
 *      existing marked+DOMPurify pipeline (`renderMarkdown`) can render them
 *      as real, styleable, sanitized `<a>` tags — this needs exact source
 *      SPANS, which `parseWikiLinks`'s flat list deliberately doesn't carry
 *      (see its doc comment). `WIKI_LINK_RENDER_RE` below mirrors that
 *      parser's regex for this substitution walk only.
 */
import { parseWikiLinks, type PageTreeNode } from '@next-lane/shared';

export interface FlatPageOption {
  id: string;
  title: string;
}

/** Flatten a page tree into a flat (id, title) list, depth-first — for
 * autocomplete candidates and building the title -> id resolution index. */
export function flattenPageTree(tree: PageTreeNode[]): FlatPageOption[] {
  const out: FlatPageOption[] = [];
  function walk(nodes: PageTreeNode[]) {
    for (const node of nodes) {
      out.push({ id: node.id, title: node.title });
      if (node.children.length) walk(node.children);
    }
  }
  walk(tree);
  return out;
}

/** Case-insensitive title -> page id index, built from a project's page tree —
 * mirrors the API's own case-insensitive exact-match resolution rule. */
export function buildTitleIndex(tree: PageTreeNode[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const p of flattenPageTree(tree)) {
    idx.set(p.title.toLowerCase(), p.id);
  }
  return idx;
}

/** Count `[[links]]` in `content` that don't resolve to any page in `titleIndex`. */
export function countUnresolvedWikiLinks(content: string, titleIndex: Map<string, string>): number {
  return parseWikiLinks(content).filter((l) => !titleIndex.has(l.title.toLowerCase())).length;
}

// Mirrors the shared `WIKI_LINK_RE` pattern in packages/shared/src/wikilink.ts
// — used ONLY to locate replacement spans below; `parseWikiLinks` remains the
// single source of truth for title/alias extraction semantics.
const WIKI_LINK_RENDER_RE = /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g;

/** Markdown link text may not contain an unescaped `]`; escape defensively. */
function escapeLinkText(text: string): string {
  return text.replace(/\]/g, '\\]');
}

/**
 * Rewrite `[[wiki-link]]` syntax in raw markdown into standard markdown link
 * syntax, so it flows through the existing `renderMarkdown` (marked +
 * DOMPurify) pipeline unchanged:
 *   - Resolved (title matches a page in `titleIndex`, case-insensitive):
 *     `[display](#page:<id>)`
 *   - Unresolved (no such page yet — a valid "create later" reference, per
 *     `parseWikiLinks`'s doc contract): `[display](#create-page:<encoded
 *     title> "Page not created yet — click to create")`.
 * The `#page:` / `#create-page:` fragment scheme never causes a real
 * navigation (it's a same-document hash) and passes DOMPurify's default URI
 * allowlist (any value starting with a non-letter, e.g. `#`, is permitted).
 * `PageContent` attaches a click handler that intercepts these hrefs instead
 * of letting the browser "navigate" to a dead in-page anchor.
 */
export function transformWikiLinksForRender(
  markdown: string,
  titleIndex: Map<string, string>,
): string {
  if (!markdown) return '';
  return markdown.replace(WIKI_LINK_RENDER_RE, (full, rawTitle: string, rawAlias?: string) => {
    const title = rawTitle.trim();
    if (!title) return full;
    const alias = rawAlias?.trim();
    const display = escapeLinkText(alias || title);
    const id = titleIndex.get(title.toLowerCase());
    if (id) {
      return `[${display}](#page:${id})`;
    }
    return `[${display}](#create-page:${encodeURIComponent(title)} "Page not created yet — click to create")`;
  });
}

/**
 * Given a textarea's full value + caret position, determine whether the
 * caret sits inside an in-progress `[[query` wiki-link trigger (mirrors
 * `MentionComposer`'s `detectMention`, triggered by `[[` instead of `@`).
 *
 * Returns `{ query, startIndex }` when active (`startIndex` = index of the
 * first `[` of the `[[`), or `null` when not. Bails once the query contains
 * `|` (the user has moved on to typing alias text — `[[Title|` — the
 * fixed title is no longer being edited so nothing left to suggest against),
 * a `]`/`[` (malformed/closed), or a newline (a link never spans lines).
 */
export function detectWikiLinkTrigger(
  value: string,
  caret: number,
): { query: string; startIndex: number } | null {
  const uptoCaret = value.slice(0, caret);
  const openIdx = uptoCaret.lastIndexOf('[[');
  if (openIdx === -1) return null;
  const closeIdx = uptoCaret.lastIndexOf(']]');
  if (closeIdx > openIdx) return null; // already closed before the caret
  const query = uptoCaret.slice(openIdx + 2);
  if (/[\n[\]|]/.test(query)) return null;
  return { query, startIndex: openIdx };
}

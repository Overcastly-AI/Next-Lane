/**
 * Obsidian-style `[[wiki-link]]` parser for the Pages knowledge base.
 *
 * Shared between the API (`PagesService`, to resolve links to `PageLink` rows
 * on every save) and the web app (the `[[autocomplete]]` editor widget) so
 * there is exactly ONE definition of what counts as a wiki-link — see
 * `Page`/`PageLink` in `apps/api/prisma/schema.prisma` for the backing model.
 *
 * Syntax recognized:
 *   `[[Page Title]]`         — a bare reference; `alias` is undefined.
 *   `[[Page Title|Alias]]`   — a reference with display alias text (the
 *                              rendered/clickable text differs from the
 *                              title used to resolve the target page).
 *
 * Resolution semantics (documented here, enforced by the caller — this
 * module only extracts syntax, it never touches the database):
 *   - Titles are resolved case-insensitively, exact match, WITHIN the same
 *     project (never cross-project).
 *   - An unresolved `[[link]]` (no page with that title exists yet) is NOT
 *     an error — it is a valid, common "yet-to-be-created page" reference
 *     (the same authoring flow Obsidian/Notion support: link first, create
 *     the page later). Callers simply skip creating a `PageLink` edge for
 *     it; the raw `[[link]]` text still renders in the document.
 *   - A page linking to itself (`title` resolves to the same page the
 *     content lives in) is excluded by the caller, not this parser — this
 *     module has no notion of "the current page".
 */

/** One parsed wiki-link reference: the target page title and optional display alias. */
export interface ParsedWikiLink {
  /** The title used to resolve the target page (untrimmed of surrounding whitespace only). */
  title: string;
  /** Display alias, when the `[[Title|Alias]]` form is used. Undefined for a bare `[[Title]]`. */
  alias?: string;
}

// Matches `[[...]]`, capturing everything up to an optional `|alias` before
// the closing `]]`. Neither the title nor the alias may itself contain `[`,
// `]`, or `|` (keeps nested/malformed brackets like `[[a [[b]] c]]` from
// producing a garbage capture — the innermost well-formed pair wins).
const WIKI_LINK_RE = /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g;

/**
 * Extract every `[[wiki-link]]` reference from a markdown document, in
 * source order. Titles/aliases are trimmed of surrounding whitespace; a
 * link whose title is empty/whitespace-only (`[[]]`, `[[ ]]`) is skipped.
 * Duplicate references (the same title linked twice in one document) are
 * all returned — callers that need a deduplicated edge set should dedupe
 * downstream (e.g. by resolved target page id).
 */
export function parseWikiLinks(markdown: string): ParsedWikiLink[] {
  if (!markdown) return [];

  const links: ParsedWikiLink[] = [];
  WIKI_LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKI_LINK_RE.exec(markdown)) !== null) {
    const title = match[1].trim();
    if (!title) continue;
    const aliasRaw = match[2];
    const alias = aliasRaw !== undefined ? aliasRaw.trim() : undefined;
    links.push(alias ? { title, alias } : { title });
  }
  return links;
}

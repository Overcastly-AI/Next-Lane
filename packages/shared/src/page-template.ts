/**
 * Page-template placeholder rendering.
 *
 * A doc template's body is plain markdown that may contain `{{placeholder}}`
 * tokens, substituted at the moment a page is created from it. This lives in
 * `packages/shared` because BOTH sides must agree exactly: the API renders the
 * body it persists, and the web editor renders a live preview before you
 * commit. If the two implementations drifted, the preview would be a lie.
 *
 * Deliberately NOT a template engine. There are no conditionals, loops,
 * partials, or expression evaluation — a doc template is content, not code,
 * and anything Turing-complete here would be a script-injection surface that
 * runs on the server with the creating user's identity. The entire feature is
 * "replace a fixed set of known tokens with strings".
 */

/** A token's value is resolved from this context at render time. */
export interface PageTemplateContext {
  /** The resolved page title (after title-template + override resolution). */
  title: string;
  /** Display name of the user creating the page. */
  author: string;
  /**
   * Creation instant. Injected rather than read from the clock inside the
   * renderer so the function stays pure and testable, and so the API and the
   * web preview can be pinned to the same instant.
   */
  now: Date;
}

/**
 * Every supported token, with a human-readable description. Exported so the
 * template editor can render a "tokens you can use" legend that is guaranteed
 * to match what the renderer actually substitutes — no hand-kept doc list to
 * fall out of sync.
 */
export const PAGE_TEMPLATE_TOKENS = [
  { token: 'title', description: 'The new page’s title' },
  { token: 'date', description: 'Creation date, ISO (2026-07-30)' },
  { token: 'time', description: 'Creation time, 24h local (14:05)' },
  { token: 'datetime', description: 'Creation date and time (2026-07-30 14:05)' },
  { token: 'year', description: 'Creation year (2026)' },
  { token: 'month', description: 'Creation month, zero-padded (07)' },
  { token: 'day', description: 'Creation day, zero-padded (30)' },
  { token: 'author', description: 'Name of whoever creates the page' },
] as const;

export type PageTemplateToken = (typeof PAGE_TEMPLATE_TOKENS)[number]['token'];

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Build the token→value map for a render.
 *
 * Date parts are taken from the LOCAL-time getters rather than slicing
 * `toISOString()`, which is UTC: for a user at UTC-5 creating a page at 21:00
 * on the 30th, the ISO slice would date the doc the 31st. A meeting note
 * stamped with tomorrow's date is a real, quietly-wrong outcome.
 */
function tokenValues(ctx: PageTemplateContext): Record<PageTemplateToken, string> {
  const d = ctx.now;
  const year = String(d.getFullYear());
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const date = `${year}-${month}-${day}`;
  return {
    title: ctx.title,
    date,
    time,
    datetime: `${date} ${time}`,
    year,
    month,
    day,
    author: ctx.author,
  };
}

/**
 * `{{ token }}` — the name, optionally surrounded by whitespace. Intentionally
 * strict: only `[a-zA-Z]+` matches, so a literal `{{ 1 + 1 }}` or a stray
 * `{{}}` in prose is left exactly as written rather than being mangled.
 */
const TOKEN_RE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/**
 * Substitute every known `{{token}}` in `body`.
 *
 * UNKNOWN TOKENS ARE LEFT VERBATIM, not blanked. A template that writes
 * `{{customer}}` is far more likely to be a deliberate fill-me-in marker for
 * the author than a typo, and silently deleting it would destroy content with
 * no way to notice. Leaving it visible is self-documenting: the reader sees
 * exactly what still needs filling in.
 */
export function renderPageTemplate(body: string, ctx: PageTemplateContext): string {
  const values = tokenValues(ctx);
  return body.replace(TOKEN_RE, (match, name: string) => {
    const key = name.toLowerCase() as PageTemplateToken;
    return key in values ? values[key] : match;
  });
}

/**
 * The tokens actually used by a template body, deduped and in first-use order.
 * Powers the editor's "this template uses…" hint and lets the UI warn about an
 * unknown token BEFORE it ships into every page made from the template.
 */
export function usedPageTemplateTokens(body: string): {
  known: PageTemplateToken[];
  unknown: string[];
} {
  const knownNames = new Set<string>(PAGE_TEMPLATE_TOKENS.map((t) => t.token));
  const known: PageTemplateToken[] = [];
  const unknown: string[] = [];
  for (const m of body.matchAll(TOKEN_RE)) {
    const name = m[1].toLowerCase();
    if (knownNames.has(name)) {
      if (!known.includes(name as PageTemplateToken)) known.push(name as PageTemplateToken);
    } else if (!unknown.includes(name)) {
      unknown.push(name);
    }
  }
  return { known, unknown };
}

/** Max lengths, enforced by the API DTO and mirrored by the editor's counters. */
export const PAGE_TEMPLATE_NAME_MAX = 100;
export const PAGE_TEMPLATE_DESCRIPTION_MAX = 280;
/**
 * A template body is a document, so this is generous — but not unbounded: the
 * value is persisted and re-rendered into every page created from it, and an
 * unbounded text column is a cheap way for one member to bloat a workspace.
 */
export const PAGE_TEMPLATE_CONTENT_MAX = 100_000;

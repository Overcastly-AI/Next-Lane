/**
 * Minimal parser for the repo-root CHANGELOG.md (Keep-a-Changelog layout as
 * written by the release automation). Bundled at build time via the
 * `__APP_CHANGELOG__` define, so "What's new" works offline and under the strict
 * production CSP (no runtime fetch).
 */

export interface ChangelogRef {
  label: string;
  url: string;
}

export interface ChangelogItem {
  /** Conventional-commit scope without the trailing colon, e.g. `web`. */
  scope: string | null;
  /** Plain text — markdown links flattened to their label. */
  text: string;
  /** Trailing issue / commit references pulled out of the line. */
  refs: ChangelogRef[];
}

export interface ChangelogSection {
  title: string;
  items: ChangelogItem[];
}

export interface ChangelogEntry {
  version: string;
  date: string | null;
  sections: ChangelogSection[];
}

const HEADING = /^##\s+\[([^\]]+)\](?:\s+[—–-]+\s+(\S+))?\s*$/;
const REF = /\s*\(\[([^\]]+)\]\(([^)]+)\)\)/g;

function parseItem(raw: string): ChangelogItem {
  const refs: ChangelogRef[] = [];
  let body = raw.replace(REF, (_m, label: string, url: string) => {
    refs.push({ label, url });
    return '';
  });
  // Flatten any remaining inline links to their label.
  body = body.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
  let scope: string | null = null;
  const m = /^\*\*([^*]+?):\*\*\s*/.exec(body);
  if (m) {
    scope = m[1];
    body = body.slice(m[0].length);
  }
  return { scope, text: body, refs };
}

/**
 * Returns released entries newest-first (file order), skipping `[Unreleased]`
 * and any heading that is not a semver version. `limit` caps the count.
 */
export function parseChangelog(markdown: string, limit = 5): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let entry: ChangelogEntry | null = null;
  let section: ChangelogSection | null = null;
  let current: string | null = null;

  const flush = () => {
    if (current !== null && section) section.items.push(parseItem(current.trim()));
    current = null;
  };

  for (const line of markdown.split(/\r?\n/)) {
    const h = HEADING.exec(line);
    if (h || /^##\s/.test(line)) {
      flush();
      section = null;
      if (h && /^\d+\.\d+\.\d+/.test(h[1])) {
        if (entries.length >= limit) break;
        entry = { version: h[1], date: h[2] ?? null, sections: [] };
        entries.push(entry);
      } else {
        entry = null;
      }
      continue;
    }
    if (!entry) continue;
    const s = /^###\s+(.+?)\s*$/.exec(line);
    if (s) {
      flush();
      section = { title: s[1], items: [] };
      entry.sections.push(section);
      continue;
    }
    const li = /^[*-]\s+(.*)$/.exec(line);
    if (li && section) {
      flush();
      current = li[1];
    } else if (current !== null && /^\s+\S/.test(line)) {
      current += ` ${line.trim()}`; // wrapped continuation
    } else if (line.trim() === '') {
      flush();
    }
  }
  flush();
  return entries;
}

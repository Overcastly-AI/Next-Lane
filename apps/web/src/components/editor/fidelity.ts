/**
 * Markdown fidelity patches on top of `@tiptap/markdown`.
 *
 * The stock serializer is correct but eager: it backslash-escapes every `_`,
 * `*`, `[`, `]`, `~` and HTML-encodes every `<` / `&`, so `snake_case` is
 * stored as `snake\_case` and `a < b` as `a &lt; b`. That renders identically,
 * but it silently rewrites the user's text, pollutes full-text search and what
 * MCP agents read back, and (worst) would break `@first_last@x.com` mentions.
 * This module keeps escaping to the cases where leaving the character alone
 * would genuinely change how the markdown parses, and fixes the other places
 * where the stock output differs from how this product's markdown is written
 * (single-newline line breaks, bare autolinks, no `&nbsp;` blank paragraphs).
 */

import type { MarkdownParseHelpers, MarkdownParseResult, MarkdownToken } from '@tiptap/core';
import { Markdown, MarkdownManager } from '@tiptap/markdown';
import HardBreak from '@tiptap/extension-hard-break';
import Link from '@tiptap/extension-link';
import Paragraph from '@tiptap/extension-paragraph';
import { BulletList, OrderedList } from '@tiptap/extension-list';
import { Table } from '@tiptap/extension-table';

/** Private-use delimiters around markdown that must bypass the text escaper. */
const VERBATIM_OPEN = '\uE002';
const VERBATIM_CLOSE = '\uE003';
const isWs = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWord = (c: string | undefined) => c !== undefined && /[A-Za-z0-9]/.test(c);
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;

/**
 * Indexes of `~` characters that could pair into strikethrough. A run of
 * tildes opens when the character after it is not whitespace and closes when
 * the one before it is not; it needs escaping only if a partner exists, so
 * "~5 min, ~/path" (the second one follows a space) stays as typed.
 */
function tildesNeedingEscape(text: string): Set<number> {
  const runs: Array<{ start: number; end: number; open: boolean; close: boolean }> = [];
  const re = /~+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text[m.index - 1];
    const after = text[m.index + m[0].length];
    runs.push({
      start: m.index,
      end: m.index + m[0].length,
      open: after !== undefined && !/\s/.test(after),
      close: before !== undefined && !/\s/.test(before),
    });
  }
  const out = new Set<number>();
  runs.forEach((r, i) => {
    const partner =
      (r.open && runs.slice(i + 1).some((o) => o.close)) ||
      (r.close && runs.slice(0, i).some((o) => o.open));
    if (partner) for (let k = r.start; k < r.end; k++) out.add(k);
  });
  return out;
}

/**
 * Escape `text` only where leaving it bare could be re-read as markdown syntax.
 * Exported for the unit suite.
 */
export function escapeMarkdownText(text: string): string {
  // Verbatim spans (lifted atoms, see `liftAtomMarks`) are already markdown.
  if (text.includes(VERBATIM_OPEN)) {
    const parts: string[] = [];
    let rest = text;
    for (;;) {
      const a = rest.indexOf(VERBATIM_OPEN);
      if (a === -1) {
        parts.push(escapeMarkdownText(rest));
        break;
      }
      const b = rest.indexOf(VERBATIM_CLOSE, a);
      if (b === -1) {
        parts.push(escapeMarkdownText(rest));
        break;
      }
      if (a > 0) parts.push(escapeMarkdownText(rest.slice(0, a)));
      parts.push(rest.slice(a, b + 1));
      rest = rest.slice(b + 1);
      if (!rest) break;
    }
    return parts.join('');
  }
  const tildeEscape = tildesNeedingEscape(text);
  const hasLinkLike = /\]\(/.test(text);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const prev = i > 0 ? text[i - 1] : undefined;
    const next = i + 1 < text.length ? text[i + 1] : undefined;
    switch (c) {
      case '\\':
        out += next === undefined || ASCII_PUNCT.test(next) ? '\\\\' : c;
        break;
      case '`':
        out += '\\`';
        break;
      case '*':
        // Only emphasis-capable when not surrounded by whitespace on both sides.
        out += isWs(prev) && isWs(next) && prev !== undefined && next !== undefined ? c : '\\*';
        break;
      case '_':
        // Intraword underscores never open emphasis (GFM); whitespace-flanked
        // ones can't either.
        out +=
          (isWord(prev) && isWord(next)) ||
          (prev !== undefined && next !== undefined && isWs(prev) && isWs(next))
            ? c
            : '\\_';
        break;
      case '~':
        out += tildeEscape.has(i) ? '\\~' : c;
        break;
      case '[':
        out += hasLinkLike || (prev === '!' ) ? '\\[' : c;
        break;
      case ']':
        out += hasLinkLike ? '\\]' : c;
        break;
      case '<':
        // Raw HTML is its own node (RawHtmlNode); a literal `<tag` in text must
        // not be re-read as one.
        out += next !== undefined && /[A-Za-z/!?]/.test(next) ? '&lt;' : c;
        break;
      case '&':
        // Only the entities the parser decodes (`&amp;` `&lt;` `&gt;` `&quot;`,
        // numeric) need protecting; `&copy;` and friends are left as typed.
        out += /^(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|lt|gt|quot|amp);/.test(text.slice(i + 1))
          ? '&amp;'
          : c;
        break;
      default:
        out += c;
    }
  }
  return out;
}

/**
 * Lines of rendered paragraph text that would turn into a different block if
 * left bare ("# not a heading", "- not a list", "1. not a list", "> quote", a
 * line of dashes). A paragraph holds only inline content, so any such line is
 * literal text and safe to neutralise with a leading backslash.
 */
const BLOCK_START = /^\s{0,3}(?:#{1,6}(?=\s|$)|[-+*](?=\s)|>|`{3,}|~{3,}|\[[ xX]\](?=\s))/;
function neutraliseBlockStarts(rendered: string): string {
  return rendered
    .split('\n')
    .map((line) => {
      // `---` / `===` / `***` setext underline or thematic break.
      if (/^\s{0,3}([-=*_])(\s*\1){2,}\s*$/.test(line)) return line.replace(/^(\s{0,3})/, '$1\\');
      // `1.` / `1)` — the backslash goes before the delimiter, not the digit.
      const ordered = /^(\s{0,3}\d{1,9})([.)])(?=\s|$)/.exec(line);
      if (ordered) return line.replace(ordered[0], `${ordered[1]}\\${ordered[2]}`);
      if (BLOCK_START.test(line)) return line.replace(/^(\s{0,3})/, '$1\\');
      return line;
    })
    .join('\n');
}

const URL_AUTOLINK = /^https?:\/\/\S+$/i;

export const FidelityParagraph = Paragraph.extend({
  renderMarkdown: (node, h) => {
    const content = Array.isArray(node?.content) ? node.content : [];
    // Blank paragraphs vanish: markdown can't express them without `&nbsp;`
    // litter, and they render identically (paragraph spacing is CSS).
    if (content.length === 0) return '';
    return neutraliseBlockStarts(h.renderChildren(content));
  },
});

type RenderFn = (
  node: Parameters<NonNullable<typeof Paragraph.config.renderMarkdown>>[0],
  h: Parameters<NonNullable<typeof Paragraph.config.renderMarkdown>>[1],
  ctx?: Parameters<NonNullable<typeof Paragraph.config.renderMarkdown>>[2],
) => string;

/** The stock table renderer pads itself with blank lines; blocks are already
 *  separated by exactly one, so the padding would stack up. */
export const FidelityTable = Table.extend({
  renderMarkdown: (node, h, ctx) =>
    ((Table.config.renderMarkdown as RenderFn)(node, h, ctx) ?? '')
      .replace(/^\n+/, '')
      .replace(/\n+$/, ''),
});

/** `breaks: true` everywhere: a bare newline IS the line break. */
export const FidelityHardBreak = HardBreak.extend({
  renderMarkdown: () => '\n',
});

export const FidelityLink = Link.extend({
  // Stock priority (1000) makes the link the OUTER mark, which serializes bold
  // links as `[**x**](url)` — and MarkdownRenderer prints the asterisks
  // literally inside an anchor. Inner link gives `**[x](url)**`, which renders.
  priority: 10,
  addAttributes() {
    return {
      ...this.parent?.(),
      // How an autolink was written, so `<https://x>` stays `<https://x>`.
      angle: { default: false, rendered: false },
    };
  },
  parseMarkdown: (token, helpers) => {
    return helpers.applyMark('link', helpers.parseInline(token.tokens || []), {
      href: token.href,
      title: token.title || null,
      angle: typeof token.raw === 'string' && token.raw.startsWith('<'),
    });
  },
  renderMarkdown: (node, h, ctx) => {
    const href = (node.attrs?.href as string | undefined) ?? '';
    const title = (node.attrs?.title as string | null | undefined) ?? '';
    // The serializer renders marks as opening + closing around the text and
    // passes the span's raw text as `meta.markText`.
    const markText = (ctx?.meta as { markText?: string } | undefined)?.markText;
    if (!title && markText !== undefined) {
      const isEmail = href === `mailto:${markText}`;
      if (markText === href || isEmail) {
        if (node.attrs?.angle) return `<${h.renderChildren(node)}>`;
        if (isEmail || URL_AUTOLINK.test(href)) return h.renderChildren(node);
      }
    }
    const text = h.renderChildren(node);
    return title ? `[${text}](${href} "${title}")` : `[${text}](${href})`;
  },
});

/**
 * Lists remember whether the source was "loose" (blank lines between items),
 * because that decides whether items render with <p> wrappers — i.e. spacing.
 */
type ParseFn = (token: MarkdownToken, helpers: MarkdownParseHelpers) => MarkdownParseResult;
const looseAttr = { loose: { default: false, rendered: false } };

export const FidelityBulletList = BulletList.extend({
  addAttributes() {
    return { ...this.parent?.(), ...looseAttr };
  },
  parseMarkdown: (token, helpers) => {
    const parsed = (BulletList.config.parseMarkdown as ParseFn | undefined)?.(token, helpers);
    if (parsed && !Array.isArray(parsed) && token.loose) {
      return { ...parsed, attrs: { ...(parsed.attrs ?? {}), loose: true } };
    }
    return parsed ?? [];
  },
  renderMarkdown: (node, h) =>
    node.content ? h.renderChildren(node.content, node.attrs?.loose ? '\n\n' : '\n') : '',
});

export const FidelityOrderedList = OrderedList.extend({
  addAttributes() {
    return { ...this.parent?.(), ...looseAttr };
  },
  // marked's own list tokenizer — the bundled ordered-list one mis-nests an
  // ordered list under a bullet under an ordered item.
  markdownTokenizer: {
    name: 'orderedList',
    level: 'block',
    start: () => -1,
    tokenize: () => undefined,
  },
  parseMarkdown: (token, helpers) => {
    const parsed = (OrderedList.config.parseMarkdown as ParseFn | undefined)?.(token, helpers);
    if (parsed && !Array.isArray(parsed) && token.loose) {
      return { ...parsed, attrs: { ...(parsed.attrs ?? {}), loose: true } };
    }
    return parsed ?? [];
  },
  renderMarkdown: (node, h) =>
    node.content ? h.renderChildren(node.content, node.attrs?.loose ? '\n\n' : '\n') : '',
});

type JsonNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: JsonNode[];
};

/** Inline leaf nodes that can carry marks, and how each is written as markdown. */
const MARKABLE_ATOM_MARKDOWN: Record<string, (a: Record<string, unknown>) => string> = {
  wikiLink: (a) => `[[${String(a.title ?? '')}${a.alias ? `|${String(a.alias)}` : ''}]]`,
  mention: (a) => `@${String(a.email ?? '')}`,
  rawHtmlInline: (a) => String(a.html ?? ''),
  image: (a) =>
    `![${String(a.alt ?? '')}](${String(a.src ?? '')}${a.title ? ` "${String(a.title)}"` : ''})`,
};

/**
 * The serializer wraps marks around TEXT only: a bold/italic/link span that
 * contains a chip or image loses the mark (`**[[Page]]**` -> `[[Page]]`,
 * `[![logo](i)](url)` -> `![logo](i)`). Before serializing, turn every marked
 * atom into a text node holding its literal markdown (flagged verbatim so the
 * escaper leaves it alone) carrying the same marks; the serializer's own mark
 * handling then does the right thing, including merging neighbouring spans.
 */
export function liftAtomMarks(node: JsonNode): JsonNode {
  if (!node.content) return node;
  // Blank paragraphs (Enter pressed twice) have no markdown spelling that
  // survives a round trip without `&nbsp;` litter; they are paragraph spacing,
  // and markdown already provides that. Dropped at the document level.
  const blocks =
    node.type === 'doc'
      ? node.content.filter((c) => !(c.type === 'paragraph' && (c.content?.length ?? 0) === 0))
      : node.content;
  return {
    ...node,
    content: blocks.map((child) => {
      const render = child.type ? MARKABLE_ATOM_MARKDOWN[child.type] : undefined;
      if (render && child.marks && child.marks.length > 0) {
        return {
          type: 'text',
          text: `${VERBATIM_OPEN}${render(child.attrs ?? {})}${VERBATIM_CLOSE}`,
          marks: child.marks,
        };
      }
      return liftAtomMarks(child);
    }),
  };
}

interface ManagerInternals {
  applyMarkToContent: (
    markType: string,
    content: JsonNode[],
    attrs?: Record<string, unknown>,
  ) => JsonNode[];
  serialize: (json: JsonNode) => string;
  codeTypes: Set<string>;
  encodeTextForMarkdown: (
    text: string,
    node: { marks?: Array<string | { type: string }> },
    parentNode?: { type?: string },
  ) => string;
}

/**
 * `Markdown` with the minimal-escape text encoder and atom-aware marks.
 *
 * `encodeTextForMarkdown` / `applyMarkToContent` are the manager's private
 * choke points for text escaping and mark application. They are patched on the
 * prototype (not the instance) because the Markdown extension parses the
 * editor's INITIAL content inside its own `onBeforeCreate`, before any hook of
 * ours could run. This app is the package's only consumer.
 */
const proto = MarkdownManager.prototype as unknown as ManagerInternals;

// The stock parse helper only marks text nodes, so `**[[Page]]**` or a linked
// image lost its mark on load. Extend it to the inline atoms.
const stockApply = proto.applyMarkToContent;
proto.applyMarkToContent = function (this: ManagerInternals, markType, content, attrs) {
  const mark = attrs ? { type: markType, attrs } : { type: markType };
  const isAtom = (n: JsonNode) => !!n.type && n.type in MARKABLE_ATOM_MARKDOWN;
  const rest = stockApply.call(
    this,
    markType,
    content.map((n) => (isAtom(n) ? { type: 'text', text: '' } : n)),
    attrs,
  );
  return rest.map((n, i) =>
    isAtom(content[i]) ? { ...content[i], marks: [...(content[i].marks ?? []), mark] } : n,
  );
};

proto.encodeTextForMarkdown = function (this: ManagerInternals, text, node, parentNode) {
  const insideCode =
    (parentNode?.type != null && this.codeTypes.has(parentNode.type)) ||
    (node.marks ?? []).some((m) => this.codeTypes.has(typeof m === 'string' ? m : m.type));
  return insideCode ? text : escapeMarkdownText(text);
};

export const FidelityMarkdown = Markdown.extend({
  onBeforeCreate() {
    (this.parent as (() => void) | undefined)?.();
    const manager = this.editor.markdown as unknown as ManagerInternals | undefined;
    if (!manager) return;
    this.editor.getMarkdown = () =>
      manager
        .serialize(liftAtomMarks(this.editor.getJSON() as JsonNode))
        .split(VERBATIM_OPEN)
        .join('')
        .split(VERBATIM_CLOSE)
        .join('');
  },
});

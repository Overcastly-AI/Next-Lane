/**
 * Raw HTML preservation.
 *
 * Issue/page markdown can legitimately contain raw HTML (`<details>`, `<br>`,
 * `<kbd>`, comments) — typically written by agents over MCP — and
 * `MarkdownRenderer` passes it through DOMPurify. The editor has no schema for
 * arbitrary HTML, and the stock behaviour is to silently drop the tags. These
 * two atom nodes hold the exact source so it survives an edit byte-for-byte; in
 * the editor they show as inert code (never injected as live HTML).
 */
import { Node } from '@tiptap/core';

// `<br>`, `</kbd>`, `<a href="x">`, `<img src=x />`, `<!-- comment -->`.
// A tag name must be followed by whitespace, `/` or `>` so that autolinks
// (`<https://x.y>`, `<a@b.co>`) are never mistaken for tags.
const INLINE_HTML =
  /^(?:<!--[\s\S]*?-->|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*?)?\s*\/?>)/;

const BLOCK_TAGS =
  'address|article|aside|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';
const BLOCK_HTML_START = new RegExp(`^ {0,3}<(?:/?(?:${BLOCK_TAGS})(?:\\s|/?>|$)|!--)`, 'i');
// CommonMark type 7: a line holding nothing but one complete tag.
const LONE_TAG_LINE = /^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*?)?\s*\/?>[ \t]*(?:\n|$)/;
const RAW_TEXT_START = /^ {0,3}<(pre|script|style|textarea)(?:\s|>|$)/i;

export const RawHtmlInline = Node.create({
  name: 'rawHtmlInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { html: { default: '' } };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ node }) {
    return ['code', { class: 'nl-raw-html', title: 'Raw HTML (kept as written)' }, node.attrs.html as string];
  },
  renderText: ({ node }) => node.attrs.html as string,
  markdownTokenizer: {
    name: 'rawHtmlInline',
    level: 'inline',
    start: (src: string) => src.indexOf('<'),
    tokenize: (src: string) => {
      const m = INLINE_HTML.exec(src);
      if (!m) return undefined;
      return { type: 'rawHtmlInline', raw: m[0], html: m[0] };
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode('rawHtmlInline', { html: token.html as string }),
  renderMarkdown: (node) => (node.attrs?.html as string | undefined) ?? '',
});

/** Consume one CommonMark HTML block (types 1, 2 and 6) from the start of `src`. */
function consumeHtmlBlock(src: string): string | null {
  const raw = RAW_TEXT_START.exec(src);
  if (raw) {
    const close = new RegExp(`</${raw[1]}>`, 'i').exec(src);
    if (!close) return src.replace(/\n+$/, '');
    const end = src.indexOf('\n', close.index);
    return end === -1 ? src : src.slice(0, end);
  }
  if (!BLOCK_HTML_START.test(src) && !LONE_TAG_LINE.test(src)) return null;
  if (/^ {0,3}<!--/.test(src)) {
    const close = src.indexOf('-->');
    if (close === -1) return null;
    const end = src.indexOf('\n', close);
    return end === -1 ? src : src.slice(0, end);
  }
  // Type 6: runs until the first blank line.
  const blank = /\n[ \t]*\n/.exec(src);
  return blank ? src.slice(0, blank.index) : src.replace(/\n+$/, '');
}

export const RawHtmlBlock = Node.create({
  name: 'rawHtmlBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { html: { default: '' } };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ node }) {
    return [
      'pre',
      { class: 'nl-raw-html-block', title: 'Raw HTML (kept as written)' },
      ['code', {}, node.attrs.html as string],
    ];
  },
  renderText: ({ node }) => node.attrs.html as string,
  markdownTokenizer: {
    name: 'rawHtmlBlock',
    level: 'block',
    // Marked calls this to find where a paragraph is interrupted. Types 1-6
    // (not the lone-tag type 7) may interrupt one.
    start: (src: string) => {
      const re = /\n(?= {0,3}<)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const rest = src.slice(m.index + 1);
        if (BLOCK_HTML_START.test(rest) || RAW_TEXT_START.test(rest)) return m.index + 1;
      }
      return -1;
    },
    tokenize: (src: string) => {
      const html = consumeHtmlBlock(src);
      if (html === null) return undefined;
      return { type: 'rawHtmlBlock', raw: html, html };
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode('rawHtmlBlock', { html: token.html as string }),
  renderMarkdown: (node) => ((node.attrs?.html as string | undefined) ?? '').replace(/\n+$/, ''),
});

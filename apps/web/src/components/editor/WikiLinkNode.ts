/**
 * WikiLink — an inline atom node for `[[Title]]` / `[[Title|alias]]`.
 *
 * Storage stays plain markdown: the node's markdown tokenizer reads the exact
 * syntax the server parses (`parseWikiLinks`, packages/shared/src/wikilink.ts)
 * and its renderer writes it back byte-for-byte (title and alias are kept
 * untrimmed so an untouched link never changes). In the editor it is shown as
 * a chip. Cross-project links use the very same syntax — the API resolves a
 * title workspace-wide — so there is nothing extra to model here.
 */
import { InputRule, Node, mergeAttributes } from '@tiptap/core';

// Same pattern as WIKI_LINK_RE in packages/shared/src/wikilink.ts, anchored.
const WIKI_LINK_AT_START = /^\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/;

export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      title: { default: '' },
      alias: { default: null as string | null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-wikilink]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const title = String(node.attrs.title ?? '');
    const alias = node.attrs.alias as string | null;
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-wikilink': title,
        class: 'nl-wikilink',
        title: alias ? `Links to “${title.trim()}”` : undefined,
      }),
      (alias ?? title).trim(),
    ];
  },

  // Chip text for copy/paste into plain-text targets.
  renderText({ node }) {
    const alias = node.attrs.alias as string | null;
    return `[[${node.attrs.title}${alias ? `|${alias}` : ''}]]`;
  },

  // Typing the closing `]]` turns `[[Title]]` / `[[Title|alias]]` into a chip.
  addInputRules() {
    const type = this.type;
    return [
      new InputRule({
        find: /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]$/,
        handler: ({ state, range, match }) => {
          if (!match[1].trim()) return null;
          // Replace the whole `[[…]]` (not just a capture group, which is what
          // `nodeInputRule` would do) with the chip.
          state.tr.replaceWith(
            range.from,
            range.to,
            type.create({ title: match[1], alias: match[2] ?? null }),
          );
        },
      }),
    ];
  },

  markdownTokenizer: {
    name: 'wikiLink',
    level: 'inline',
    start: (src: string) => src.indexOf('[['),
    tokenize: (src: string) => {
      const m = WIKI_LINK_AT_START.exec(src);
      if (!m) return undefined;
      // The server skips a link whose title is blank — leave it as text.
      if (!m[1].trim()) return undefined;
      return {
        type: 'wikiLink',
        raw: m[0],
        title: m[1],
        alias: m[2] ?? null,
      };
    },
  },

  parseMarkdown: (token, helpers) =>
    helpers.createNode('wikiLink', {
      title: token.title as string,
      alias: (token.alias as string | null) ?? null,
    }),

  renderMarkdown: (node) => {
    const alias = node.attrs?.alias as string | null | undefined;
    return `[[${node.attrs?.title ?? ''}${alias ? `|${alias}` : ''}]]`;
  },
});

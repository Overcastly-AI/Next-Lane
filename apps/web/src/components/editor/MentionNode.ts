/**
 * Mention — an inline atom node for `@user@example.com`.
 *
 * The stored form is exactly what the API's mention parser reads
 * (`NotificationsService.resolveMentions`: `@` + an email-shaped token), so
 * notifications keep working with no server change. The regex below is that
 * parser's, anchored. Holding the mention as a node (rather than text) keeps
 * the email out of the markdown escaper — `first_last@x.com` must never gain a
 * backslash, or the server would stop recognising it.
 */
import { Node, mergeAttributes } from '@tiptap/core';

export const MENTION_AT_START = /^@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/;

export const Mention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { email: { default: '' } };
  },

  parseHTML() {
    return [{ tag: 'span[data-mention]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-mention': node.attrs.email as string,
        class: 'nl-mention',
      }),
      `@${node.attrs.email as string}`,
    ];
  },

  renderText({ node }) {
    return `@${node.attrs.email as string}`;
  },

  markdownTokenizer: {
    name: 'mention',
    level: 'inline',
    start: (src: string) => src.indexOf('@'),
    tokenize: (src: string) => {
      const m = MENTION_AT_START.exec(src);
      if (!m) return undefined;
      return { type: 'mention', raw: m[0], email: m[1] };
    },
  },

  parseMarkdown: (token, helpers) =>
    helpers.createNode('mention', { email: token.email as string }),

  renderMarkdown: (node) => `@${node.attrs?.email ?? ''}`,
});

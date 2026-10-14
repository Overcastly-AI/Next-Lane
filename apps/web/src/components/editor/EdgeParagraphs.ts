/**
 * Keeps an empty paragraph before/after a document that begins/ends with a
 * block atom (raw-HTML block, horizontal rule). Without it the only places the
 * caret can go are NodeSelections of the atom, so `focus('end')`, Ctrl+End or
 * autofocus select it and the first keystroke REPLACES it.
 *
 * The paragraphs are editor-only: blank paragraphs are dropped when serializing
 * (see `liftAtomMarks`), so an untouched document keeps its exact markdown.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';

/** Block node types that are leaves (no text position inside them). */
export const ATOM_BLOCK_TYPES = new Set(['rawHtmlBlock', 'horizontalRule']);

const key = new PluginKey('nlEdgeParagraphs');

function ensure(state: EditorState): Transaction | null {
  const { doc, schema } = state;
  const para = schema.nodes.paragraph;
  if (!para || doc.childCount === 0) return null;
  const isAtomBlock = (n: typeof doc) => ATOM_BLOCK_TYPES.has(n.type.name);
  let tr: Transaction | null = null;
  if (isAtomBlock(doc.lastChild as typeof doc)) {
    tr = state.tr.insert(doc.content.size, para.create());
  }
  if (isAtomBlock(doc.firstChild as typeof doc)) {
    tr = (tr ?? state.tr).insert(0, para.create());
  }
  return tr;
}

export const EdgeParagraphs = Extension.create({
  name: 'nlEdgeParagraphs',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        appendTransaction: (trs, _old, next) => {
          if (!trs.some((t) => t.docChanged)) return null;
          const tr = ensure(next);
          return tr ? tr.setMeta('addToHistory', false) : null;
        },
      }),
    ];
  },
});

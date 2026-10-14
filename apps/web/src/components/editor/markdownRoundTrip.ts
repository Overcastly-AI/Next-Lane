/**
 * Headless markdown -> editor -> markdown. Used by the round-trip suite and by
 * the editor itself (to decide whether an edit changed anything at all).
 */
import { Editor } from '@tiptap/core';
import { createMarkdownExtensions } from './extensions';

/** Serialize an editor's document to markdown with no outer blank lines. */
export function editorToMarkdown(editor: Editor): string {
  return editor.getMarkdown().replace(/^\n+/, '').replace(/\s+$/, '');
}

export function roundTripMarkdown(md: string): string {
  const editor = new Editor({
    extensions: createMarkdownExtensions(),
    content: md,
    contentType: 'markdown',
  });
  try {
    return editorToMarkdown(editor);
  } finally {
    editor.destroy();
  }
}

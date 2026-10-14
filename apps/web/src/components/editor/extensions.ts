/**
 * The ONE extension set behind every rich-text surface — and the markdown
 * (de)serializer the round-trip suite exercises. Storage format is markdown;
 * nothing in here may change what a server-side parser (wiki-links, mentions,
 * full-text search) or `MarkdownRenderer` would see for untouched content.
 */
import type { AnyExtension } from '@tiptap/core';
import { Marked } from 'marked';
import StarterKit from '@tiptap/starter-kit';
import { FidelityTable, FidelityBulletList, FidelityOrderedList, FidelityHardBreak, FidelityLink, FidelityMarkdown, FidelityParagraph } from './fidelity';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { EditorImage } from './ImageNode';
import { WikiLink } from './WikiLinkNode';
import { Mention } from './MentionNode';
import { RawHtmlBlock, RawHtmlInline } from './RawHtmlNode';

export function createMarkdownExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      // No markdown spelling exists for underline.
      underline: false,
      paragraph: false,
      hardBreak: false,
      orderedList: false,
      bulletList: false,
      link: false,
    }),
    FidelityBulletList,
    FidelityOrderedList,
    FidelityParagraph,
    FidelityHardBreak,
    FidelityLink.configure({
      openOnClick: false,
      autolink: false,
      linkOnPaste: true,
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    FidelityTable,
    TableRow,
    TableHeader,
    TableCell,
    EditorImage.configure({ inline: true, allowBase64: false }),
    WikiLink,
    Mention,
    RawHtmlInline,
    RawHtmlBlock,
    // marked is configured with `breaks: true` in MarkdownRenderer, so a single
    // newline is a hard break everywhere the content is shown. Parse the same way.
    FidelityMarkdown.configure({
      // A PRIVATE marked instance. The editor registers its own tokenizers on
      // whatever instance it is given; the default is the global `marked` that
      // `MarkdownRenderer` also uses, and sharing it would leak editor-only
      // token types into every rendered issue, comment and page.
      marked: new Marked() as never,
      markedOptions: { gfm: true, breaks: true },
    }),
  ];
}

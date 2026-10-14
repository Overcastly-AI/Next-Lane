/** Public contract of the rich markdown editor (kept free of tiptap imports so
 *  callers never pull the editor chunk in just to type a prop). */
import type { UserDto } from '@next-lane/shared';
import type { FlatPageOption } from '@/lib/wikiLinks';

export type EditorToolbarVariant = 'full' | 'compact';

export interface RichMarkdownEditorProps {
  /** Markdown source — the ONLY storage format. */
  value: string;
  onChange: (markdown: string) => void;
  /** Accessible name; exposed as the textbox's aria-label. */
  'aria-label': string;
  placeholder?: string;
  /** Lands on the editing surface (contenteditable, or the textarea in Markdown mode). */
  'data-testid'?: string;
  /** Members offered by `@` autocomplete. Omit to turn mentions off. */
  users?: UserDto[];
  /** Pages offered by `[[` autocomplete. Omit to turn wiki-links off. */
  pages?: FlatPageOption[];
  /** Pasted / dropped / picked files. Omit to leave paste/drop untouched. */
  onFiles?: (files: File[]) => void;
  /** Return true to mark the key handled (the editor then ignores it). */
  onKeyDown?: (event: KeyboardEvent) => boolean | void;
  /**
   * Focus left the whole editor (surface, toolbar and Markdown toggle).
   * Receives the markdown the field holds right now — prefer it to any
   * closed-over state, which can be a keystroke behind.
   */
  onBlurOut?: (markdown: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  /**
   * Escape with unsent content blurs the editor (keeping the draft) instead of
   * letting an enclosing drawer/modal close and discard it. Empty -> Escape
   * passes through and closes as usual.
   */
  escapeKeepsDraft?: boolean;
  /** Cap on the writing area's height (any CSS length); longer content scrolls inside. */
  maxHeight?: string;
  /** Hard cap on the markdown length, like a textarea's maxLength. */
  maxLength?: number;
  toolbar?: EditorToolbarVariant;
  /** `inline`: bordered field. `canvas`: borderless, fills its parent (pages). */
  variant?: 'inline' | 'canvas';
  /** Minimum height of the writing area, any CSS length. */
  minHeight?: string;
  className?: string;
  /** Start in raw Markdown mode (mostly for tests/settings). */
  initialMode?: 'rich' | 'markdown';
}

export interface RichMarkdownEditorHandle {
  focus(): void;
  /** Insert markdown at the caret (or at the end when the editor has no selection). */
  insertMarkdown(markdown: string): void;
  /** Insert an image node at the caret. */
  insertImage(image: { src: string; alt: string }): void;
  /** Swap an image (by its current src) for another, or remove it with `null`. */
  replaceImage(src: string, next: { src: string; alt: string } | null): void;
}

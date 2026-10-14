/**
 * RichMarkdownEditorImpl — the Tiptap-backed editor behind every markdown
 * field. Import it via `@/components/ui/RichMarkdownEditor` (lazy wrapper).
 *
 * THE INVARIANT: the value that goes in and comes out is markdown, nothing
 * else. Three rules keep that honest:
 *   1. Loading never writes. The document is built from `value` without
 *      emitting an update, so opening a field and leaving it never changes it.
 *   2. If an edit leaves the document equal to how it loaded (typed then
 *      deleted, undo), the ORIGINAL string is emitted — not a re-serialised
 *      near-copy — so "no real change" is also "no diff".
 *   3. The Markdown switch hands the textarea the exact string last emitted
 *      (or loaded), and edits made there go straight to the parent; the visual
 *      document is only rebuilt from them when you switch back.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import { Placeholder } from '@tiptap/extensions';
import type { Editor } from '@tiptap/core';
import { PAGE_IMAGE_MIME_TYPES } from '@next-lane/shared';
import type { UserDto } from '@next-lane/shared';
import type { FlatPageOption } from '@/lib/wikiLinks';
import { cn } from '@/lib/cn';
import { createMarkdownExtensions } from './extensions';
import { editorToMarkdown } from './markdownRoundTrip';
import { EditorToolbar } from './EditorToolbar';
import { SuggestionPicker } from './SuggestionPicker';
import { createSuggestionExtension, type PickerBridge, type PickerState } from './suggestions';
import type { RichMarkdownEditorHandle, RichMarkdownEditorProps } from './types';

/** Plain-text pastes that look like markdown are parsed as markdown. */
const MARKDOWN_HINT = /(^|\n)(#{1,6} |[-*+] |\d+[.)] |> |```|\|.+\|)|\*\*|__|\[\[|\]\(|`[^`\n]+`|~~/;

function normalizeUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('/')) return url;
  return `https://${url}`;
}

export const RichMarkdownEditorImpl = forwardRef<RichMarkdownEditorHandle, RichMarkdownEditorProps>(
  function RichMarkdownEditorImpl(props, ref) {
    const {
      value,
      onChange,
      placeholder,
      users,
      pages,
      onFiles,
      onKeyDown,
      onBlurOut,
      autoFocus,
      disabled,
      maxLength,
      toolbar = 'full',
      variant = 'inline',
      minHeight,
      className,
      initialMode = 'rich',
    } = props;
    const ariaLabel = props['aria-label'];
    const testId = props['data-testid'];

    const [mode, setModeState] = useState<'rich' | 'markdown'>(initialMode);
    // The imperative handle (image upload callbacks resolve at arbitrary
    // times) must see the mode as it is NOW, not as of the last render.
    const modeRef = useRef(mode);
    const setMode = useCallback((m: 'rich' | 'markdown') => {
      modeRef.current = m;
      setModeState(m);
    }, []);
    const [dropActive, setDropActive] = useState(false);
    const [linkOpen, setLinkOpen] = useState(false);
    const [picker, setPicker] = useState<PickerState | null>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Latest-value refs: the editor (and its plugins) are created once.
    const onChangeRef = useRef(onChange);
    const onKeyDownRef = useRef(onKeyDown);
    const onFilesRef = useRef(onFiles);
    const maxLengthRef = useRef(maxLength);
    const usersRef = useRef<UserDto[] | undefined>(users);
    const pagesRef = useRef<FlatPageOption[] | undefined>(pages);
    onChangeRef.current = onChange;
    onKeyDownRef.current = onKeyDown;
    onFilesRef.current = onFiles;
    maxLengthRef.current = maxLength;
    usersRef.current = users;
    pagesRef.current = pages;

    const wrapperRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const linkInputRef = useRef<HTMLInputElement>(null);

    // What the parent last held. Markdown out === `lastEmitted`, always.
    const lastEmitted = useRef(value);
    // How the current document looked when loaded (see rule 2 above).
    const baseline = useRef<{ original: string; normalized: string } | null>(null);
    const initialValue = useRef(value);

    // ── autocomplete bridge ──────────────────────────────────────────────
    const pickerRef = useRef<PickerState | null>(null);
    const selectedRef = useRef(0);
    const bridge = useMemo<PickerBridge>(
      () => ({
        open: (s) => {
          selectedRef.current = 0;
          const next = { ...s, selectedIndex: 0 };
          pickerRef.current = next;
          setSelectedIndex(0);
          setPicker(next);
        },
        update: (s) => {
          selectedRef.current = 0;
          const next = { ...s, selectedIndex: 0 };
          pickerRef.current = next;
          setSelectedIndex(0);
          setPicker(next);
        },
        close: (kind) => {
          if (pickerRef.current?.kind !== kind) return;
          pickerRef.current = null;
          setPicker(null);
        },
        key: (kind, e) => {
          const p = pickerRef.current;
          if (!p || p.kind !== kind || p.items.length === 0) return false;
          const n = p.items.length;
          if (e.key === 'ArrowDown') {
            selectedRef.current = (selectedRef.current + 1) % n;
            setSelectedIndex(selectedRef.current);
            return true;
          }
          if (e.key === 'ArrowUp') {
            selectedRef.current = selectedRef.current === 0 ? n - 1 : selectedRef.current - 1;
            setSelectedIndex(selectedRef.current);
            return true;
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            p.command(p.items[Math.min(selectedRef.current, n - 1)]);
            return true;
          }
          return false;
        },
      }),
      [],
    );

    const dataRefs = useMemo(() => ({ users: usersRef, pages: pagesRef }), []);

    const extensions = useMemo(
      () => [
        ...createMarkdownExtensions({ wikiLinks: pages !== undefined, mentions: users !== undefined }),
        Placeholder.configure({ placeholder: placeholder ?? '', showOnlyWhenEditable: true }),
        createSuggestionExtension(dataRefs, bridge),
      ],
      // The placeholder text is read once; changing it re-creating the editor
      // would drop the caret.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    const openLinkBar = useRef<() => void>(() => {});

    const editor = useEditor({
      extensions,
      content: value,
      contentType: 'markdown',
      editable: !disabled,
      autofocus: autoFocus ? 'end' : false,
      injectCSS: false,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': ariaLabel,
          ...(placeholder ? { 'aria-placeholder': placeholder, placeholder } : {}),
          ...(testId ? { 'data-testid': testId } : {}),
          spellcheck: 'true',
          autocapitalize: 'sentences',
          class: cn(
            'markdown-body nl-editor-content outline-none',
            variant === 'canvas' ? 'min-h-[50vh]' : 'min-h-[4.5rem]',
          ),
        },
        handlePaste: (view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length > 0 && onFilesRef.current) {
            event.preventDefault();
            onFilesRef.current(files);
            return true;
          }
          // Plain text that is really markdown (copied from a README, an AI
          // answer, another tracker…) becomes formatted content, not literal
          // `## ` characters. Rich (HTML) pastes keep the browser's handling.
          const html = event.clipboardData?.getData('text/html');
          const text = event.clipboardData?.getData('text/plain') ?? '';
          const inCode = view.state.selection.$from.parent.type.name === 'codeBlock';
          if (!html && text && !inCode && MARKDOWN_HINT.test(text)) {
            event.preventDefault();
            editorRef.current?.commands.insertContent(text, { contentType: 'markdown' });
            return true;
          }
          return false;
        },
        handleDrop: (_view, event) => {
          setDropActive(false);
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (files.length > 0 && onFilesRef.current) {
            event.preventDefault();
            onFilesRef.current(files);
            return true;
          }
          return false;
        },
        handleDOMEvents: {
          // A DOM-level hook rather than `handleKeyDown`: on Android Chrome
          // ProseMirror re-synthesises Enter as a modifier-less key event, so
          // Cmd/Ctrl+Enter would never reach a `handleKeyDown` there.
          keydown: (view, event) => {
            // An open picker owns arrows/Enter/Tab/Esc (its plugin handles them).
            if (pickerRef.current) return false;
            // ⌘/Ctrl+K on a selection (or inside a link) edits the link — the
            // convention in every rich editor. With nothing selected it falls
            // through to the app's global search palette, which owns ⌘K.
            if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'k') {
              const e = editorRef.current;
              // ProseMirror syncs the DOM selection asynchronously, so right
              // after Shift+Arrow its own state can still say "empty": ask the
              // DOM too.
              const sel = window.getSelection();
              const inside = !!sel && view.dom.contains(sel.anchorNode);
              const domSelected = inside && !sel.isCollapsed;
              const domInLink = inside && !!sel.anchorNode?.parentElement?.closest('a[href]');
              if (e && (!e.state.selection.empty || domSelected || domInLink || e.isActive('link'))) {
                event.preventDefault();
                event.stopPropagation();
                // Make ProseMirror adopt the DOM selection NOW: focus is about to
                // move to the link field, after which it would never sync it.
                try {
                  (view as unknown as { domObserver: { flush(): void } }).domObserver.flush();
                } catch {
                  /* internal API moved: the selection is then as of the last sync */
                }
                openLinkBar.current();
                return true;
              }
            }
            return onKeyDownRef.current?.(event) === true;
          },
          dragover: (_view, event) => {
            if (!onFilesRef.current) return false;
            if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return false;
            event.preventDefault();
            setDropActive(true);
            return false;
          },
          dragleave: () => {
            setDropActive(false);
            return false;
          },
        },
      },
      onCreate: ({ editor: e }) => {
        baseline.current = { original: value, normalized: editorToMarkdown(e) };
      },
      onUpdate: ({ editor: e }) => {
        const md = editorToMarkdown(e);
        // The editor can adjust a freshly loaded document before `onCreate`
        // (e.g. appending the trailing paragraph after a final table). That is
        // load-time normalisation, not an edit: treat it as the baseline.
        if (!baseline.current) baseline.current = { original: initialValue.current, normalized: md };
        const max = maxLengthRef.current;
        if (max !== undefined && md.length > max) {
          // Like a textarea's maxLength: refuse the keystroke.
          e.commands.undo();
          return;
        }
        const b = baseline.current;
        const next = b && md === b.normalized ? b.original : md;
        if (next === lastEmitted.current) return;
        lastEmitted.current = next;
        // ProseMirror calls us outside React's event system, where updates are
        // batched asynchronously. Flush so the parent's state (and any handler
        // closing over it — blur-to-save, Cmd+Enter) is never a keystroke
        // behind, exactly like a controlled textarea.
        flushSync(() => onChangeRef.current(next));
      },
    });
    const editorRef = useRef<Editor | null>(null);
    editorRef.current = editor;

    // External value change (parent reset, realtime, cancel…) → rebuild the doc.
    useEffect(() => {
      if (!editor || mode !== 'rich') return;
      if (value === lastEmitted.current) return;
      lastEmitted.current = value;
      editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
      baseline.current = { original: value, normalized: editorToMarkdown(editor) };
    }, [value, editor, mode]);

    useEffect(() => {
      editor?.setEditable(!disabled);
    }, [editor, disabled]);

    // Autofocus, retried: the `autofocus` editor option fires once at creation,
    // which can be before the view is attached (lazy chunk, modal mount) or be
    // undone by the control that opened us unmounting. A few animation frames
    // of "focus until it sticks" make "click Edit → caret is there" reliable.
    useEffect(() => {
      if (!editor || !autoFocus || initialMode !== 'rich') return;
      let tries = 0;
      let raf = 0;
      const attempt = () => {
        if (editor.isDestroyed) return;
        editor.commands.focus('end');
        if (!editor.isFocused && tries++ < 8) raf = requestAnimationFrame(attempt);
      };
      raf = requestAnimationFrame(attempt);
      return () => cancelAnimationFrame(raf);
    }, [editor, autoFocus, initialMode]);

    // ARIA combobox state for the open picker, set on the contenteditable.
    useEffect(() => {
      // `editor.view` throws until the view is mounted (first render in a modal).
      let dom: HTMLElement | null = null;
      try {
        dom = editor?.view.dom ?? null;
      } catch {
        dom = null;
      }
      if (!dom) return;
      if (picker) {
        dom.setAttribute('aria-autocomplete', 'list');
        dom.setAttribute('aria-expanded', 'true');
        dom.setAttribute('aria-controls', `${picker.kind}-picker`);
        if (picker.items.length > 0) {
          dom.setAttribute('aria-activedescendant', `${picker.kind}-option-${selectedIndex}`);
        } else dom.removeAttribute('aria-activedescendant');
      } else {
        ['aria-autocomplete', 'aria-expanded', 'aria-controls', 'aria-activedescendant'].forEach((a) =>
          dom.removeAttribute(a),
        );
      }
    }, [editor, picker, selectedIndex]);

    // ── link bar ─────────────────────────────────────────────────────────
    const [linkValue, setLinkValue] = useState('');
    // Whether the caret/selection is on an existing link (for "Update"/"Remove").
    const [linkHas, setLinkHas] = useState(false);
    openLinkBar.current = () => {
      if (!editor || mode !== 'rich') return;
      setLinkValue((editor.getAttributes('link').href as string | undefined) ?? '');
      setLinkHas(editor.isActive('link'));
      setLinkOpen(true);
    };
    useEffect(() => {
      if (linkOpen) linkInputRef.current?.focus();
    }, [linkOpen]);

    function applyLink() {
      if (!editor) return;
      const href = normalizeUrl(linkValue);
      setLinkOpen(false);
      if (!href) {
        editor.chain().focus().extendMarkRange('link').unsetLink().run();
        return;
      }
      const { empty } = editor.state.selection;
      if (empty && !linkHas) {
        editor
          .chain()
          .focus()
          .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
          .run();
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
      }
    }

    // ── mode switch ──────────────────────────────────────────────────────
    function toggleMode() {
      if (modeRef.current === 'rich') {
        setMode('markdown');
        requestAnimationFrame(() => textareaRef.current?.focus());
      } else {
        // Flip first: from here on an in-flight image upload edits the live
        // document, which is rebuilt from the latest markdown just below.
        setMode('rich');
        if (editor) {
          const md = lastEmitted.current;
          editor.commands.setContent(md, { contentType: 'markdown', emitUpdate: false });
          baseline.current = { original: md, normalized: editorToMarkdown(editor) };
        }
        requestAnimationFrame(() => editor?.commands.focus('end'));
      }
    }

    // Autosize the raw-markdown textarea to its content (canvas fills instead).
    useEffect(() => {
      const el = textareaRef.current;
      if (!el || mode !== 'markdown' || variant === 'canvas') return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight + 2}px`;
    }, [value, mode, variant]);

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          if (modeRef.current === 'markdown') textareaRef.current?.focus();
          else editorRef.current?.commands.focus('end');
        },
        insertMarkdown(md) {
          if (modeRef.current === 'markdown') {
            const el = textareaRef.current;
            const cur = lastEmitted.current;
            const start = el?.selectionStart ?? cur.length;
            const end = el?.selectionEnd ?? start;
            const next = `${cur.slice(0, start)}${md}${cur.slice(end)}`;
            lastEmitted.current = next;
            onChangeRef.current(next);
          } else {
            editorRef.current?.chain().focus().insertContent(md, { contentType: 'markdown' }).run();
          }
        },
        insertImage({ src, alt }) {
          if (modeRef.current === 'markdown') {
            const el = textareaRef.current;
            const cur = lastEmitted.current;
            const start = el?.selectionStart ?? cur.length;
            const end = el?.selectionEnd ?? start;
            const next = `${cur.slice(0, start)}![${alt}](${src})\n${cur.slice(end)}`;
            lastEmitted.current = next;
            onChangeRef.current(next);
          } else {
            editorRef.current
              ?.chain()
              .focus()
              // Its own block, like the old `![…](…)\n` line.
              .insertContent({ type: 'paragraph', content: [{ type: 'image', attrs: { src, alt } }] })
              .run();
          }
        },
        replaceImage(src, next) {
          if (modeRef.current === 'markdown') {
            const cur = lastEmitted.current;
            const esc = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`!\\[[^\\]]*\\]\\(${esc}\\)(\\n?)`);
            // Keep whatever line ending the placeholder had (none at the very
            // end of the text); drop the line with it when removing.
            const out = cur.replace(re, (_m, nl: string) => (next ? `![${next.alt}](${next.src})${nl}` : ''));
            lastEmitted.current = out;
            onChangeRef.current(out);
            return;
          }
          const e = editorRef.current;
          if (!e) return;
          let found: { pos: number; size: number } | null = null;
          e.state.doc.descendants((node, pos) => {
            if (!found && node.type.name === 'image' && node.attrs.src === src) {
              found = { pos, size: node.nodeSize };
            }
            return !found;
          });
          if (!found) return;
          const { pos, size } = found as { pos: number; size: number };
          const tr = e.state.tr;
          if (next) tr.setNodeMarkup(pos, undefined, { ...e.state.doc.nodeAt(pos)?.attrs, ...next });
          else tr.delete(pos, pos + size);
          // Not an edit the user can undo into a half-uploaded state.
          tr.setMeta('addToHistory', false);
          e.view.dispatch(tr);
        },
      }),
      [],
    );

    // Focus left the whole editor (surface + toolbar + link bar + toggle)?
    const handleBlur = useCallback(
      (e: React.FocusEvent<HTMLDivElement>) => {
        const next = e.relatedTarget as Node | null;
        if (next && wrapperRef.current?.contains(next)) return;
        setDropActive(false);
        onBlurOut?.(lastEmitted.current);
      },
      [onBlurOut],
    );

    const canUpload = !!onFiles;
    const sizeStyle = minHeight ? { minHeight } : undefined;

    return (
      <div
        ref={wrapperRef}
        data-testid={testId ? `${testId}-frame` : undefined}
        data-mode={mode}
        data-drop-active={dropActive ? '' : undefined}
        onBlur={handleBlur}
        className={cn(
          'nl-editor relative flex min-h-0 w-full min-w-0 max-w-full flex-col',
          variant === 'inline' &&
            'rounded border border-ink-200 bg-surface transition-colors duration-[120ms] hover:border-ink-300 focus-within:border-signal-500 focus-within:ring-2 focus-within:ring-signal-200',
          variant === 'canvas' && 'flex-1',
          disabled && 'opacity-70',
          dropActive && 'ring-2 ring-signal-400 ring-offset-2',
          className,
        )}
      >
        {editor && !disabled && (
          <EditorToolbar
            editor={editor}
            variant={toolbar}
            disabled={disabled}
            canUploadImages={canUpload}
            onPickImages={() => fileInputRef.current?.click()}
            onLink={() => openLinkBar.current()}
            mode={mode}
            onToggleMode={toggleMode}
            testId={testId ? `${testId}-toolbar` : undefined}
          />
        )}

        {linkOpen && mode === 'rich' && (
          // A div, not a <form>: this editor often lives inside a <form>
          // (comments, create-issue), and a nested one would submit it.
          <div
            data-testid="editor-link-bar"
            role="group"
            aria-label="Link"
            className="flex flex-wrap items-center gap-2 border-b border-ink-100 bg-surface px-2 py-1.5"
          >
            <label className="sr-only" htmlFor={`${testId ?? 'editor'}-link-url`}>
              Link address
            </label>
            <input
              ref={linkInputRef}
              id={`${testId ?? 'editor'}-link-url`}
              data-testid="editor-link-input"
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  applyLink();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  e.nativeEvent.stopImmediatePropagation();
                  setLinkOpen(false);
                  editor?.commands.focus();
                }
              }}
              placeholder="https://…"
              inputMode="url"
              autoComplete="off"
              className="h-10 min-w-0 flex-1 rounded border border-ink-200 bg-surface px-2 text-base text-ink-900 placeholder:text-ink-400 focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-200 sm:h-8 sm:text-sm"
            />
            <button
              type="button"
              data-testid="editor-link-apply"
              onClick={applyLink}
              className="h-10 rounded bg-signal-600 px-3 text-xs font-semibold text-white hover:bg-signal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-300 sm:h-8"
            >
              {linkHas ? 'Update' : 'Add link'}
            </button>
            {linkHas && (
              <button
                type="button"
                data-testid="editor-link-remove"
                onClick={() => {
                  setLinkOpen(false);
                  editor.chain().focus().extendMarkRange('link').unsetLink().run();
                }}
                className="h-10 rounded px-2 text-xs font-medium text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 sm:h-8"
              >
                Remove
              </button>
            )}
          </div>
        )}

        <div
          className={cn(
            'min-h-0',
            variant === 'canvas' ? 'flex-1 overflow-y-auto' : '',
            mode === 'markdown' && 'hidden',
            variant === 'inline' ? 'px-3 py-2' : 'px-0 py-2',
            // 16px on phones: iOS zooms the page on focus below that.
            'text-base sm:text-sm',
          )}
          style={sizeStyle}
          onClick={(e) => {
            // Clicking the padding below the last line focuses the end.
            if (e.target === e.currentTarget) editor?.commands.focus('end');
          }}
        >
          <EditorContent editor={editor} />
        </div>

        {mode === 'markdown' && (
          <textarea
            ref={textareaRef}
            data-testid={testId ? `${testId}-markdown` : undefined}
            aria-label={`${ariaLabel} — Markdown source`}
            value={value}
            maxLength={maxLength}
            disabled={disabled}
            spellCheck
            onChange={(e) => {
              lastEmitted.current = e.target.value;
              onChange(e.target.value);
            }}
            onKeyDown={(e) => {
              if (onKeyDown?.(e.nativeEvent) === true) e.preventDefault();
            }}
            style={sizeStyle}
            className={cn(
              'block w-full resize-none bg-transparent px-3 py-2 font-mono text-sm leading-relaxed text-ink-900',
              'placeholder:text-ink-400 focus:outline-none',
              variant === 'canvas' ? 'min-h-[50vh] flex-1 px-0' : 'min-h-[4.5rem]',
            )}
            placeholder={placeholder}
          />
        )}

        {picker && mode === 'rich' && (
          <SuggestionPicker
            picker={picker}
            selectedIndex={selectedIndex}
            wrapperRef={wrapperRef}
            onHover={(i) => {
              selectedRef.current = i;
              setSelectedIndex(i);
            }}
          />
        )}

        {canUpload && (
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={PAGE_IMAGE_MIME_TYPES.join(',')}
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
            data-testid="editor-file-input"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length > 0) onFilesRef.current?.(files);
            }}
          />
        )}
      </div>
    );
  },
);

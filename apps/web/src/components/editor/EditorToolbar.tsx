/**
 * Formatting toolbar for the rich markdown editor.
 *
 * Design: an instrument strip, not a ribbon. Quiet ink glyphs grouped by
 * purpose with hairline ticks between groups; the one accent is the pressed
 * state (signal wash + ring) and the mono `Markdown` switch pinned at the end.
 *
 * Every button keeps the editor's selection and focus: `mousedown` is
 * prevented (so a tap never blurs the writing surface — vital on phones where
 * a blur dismisses the on-screen keyboard) and the toolbar itself is a single
 * roving-tabindex stop with arrow-key navigation (`role="toolbar"`).
 */
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { cn } from '@/lib/cn';
import type { EditorToolbarVariant } from './types';
import {
  BoldIcon,
  BulletListIcon,
  CodeBlockIcon,
  CodeIcon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  OrderedListIcon,
  QuoteIcon,
  StrikeIcon,
  TableIcon,
  TaskListIcon,
} from './icons';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';

interface ToolButton {
  id: string;
  label: string;
  shortcut?: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onRun: () => void;
}

export interface EditorToolbarProps {
  editor: Editor;
  variant: EditorToolbarVariant;
  disabled?: boolean;
  canUploadImages: boolean;
  onPickImages: () => void;
  onLink: () => void;
  mode: 'rich' | 'markdown';
  onToggleMode: () => void;
  testId?: string;
}

const btnBase =
  'inline-flex shrink-0 items-center justify-center rounded text-ink-500 transition-colors duration-[120ms] ' +
  'h-10 w-10 sm:h-8 sm:w-8 hover:bg-ink-100 hover:text-ink-800 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 ' +
  'disabled:pointer-events-none disabled:opacity-40 ' +
  'aria-pressed:bg-signal-50 aria-pressed:text-signal-700 aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-signal-200';

export function EditorToolbar({
  editor,
  variant,
  disabled,
  canUploadImages,
  onPickImages,
  onLink,
  mode,
  onToggleMode,
  testId,
}: EditorToolbarProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      link: e.isActive('link'),
      table: e.isActive('table'),
    }),
  });

  const run = () => editor.chain().focus();
  const rich = mode === 'rich';

  const groups: ToolButton[][] = [
    [
      { id: 'bold', label: 'Bold', shortcut: `${MOD}B`, icon: <BoldIcon />, active: state.bold, onRun: () => run().toggleBold().run() },
      { id: 'italic', label: 'Italic', shortcut: `${MOD}I`, icon: <ItalicIcon />, active: state.italic, onRun: () => run().toggleItalic().run() },
      ...(variant === 'full'
        ? [{ id: 'strike', label: 'Strikethrough', shortcut: `${MOD}⇧S`, icon: <StrikeIcon />, active: state.strike, onRun: () => run().toggleStrike().run() }]
        : []),
      { id: 'code', label: 'Inline code', shortcut: `${MOD}E`, icon: <CodeIcon />, active: state.code, onRun: () => run().toggleCode().run() },
    ],
    ...(variant === 'full'
      ? [
          [
            { id: 'h2', label: 'Heading 2', shortcut: '## ', icon: <span className="font-mono text-[11px] font-semibold">H2</span>, active: state.h2, onRun: () => run().toggleHeading({ level: 2 }).run() },
            { id: 'h3', label: 'Heading 3', shortcut: '### ', icon: <span className="font-mono text-[11px] font-semibold">H3</span>, active: state.h3, onRun: () => run().toggleHeading({ level: 3 }).run() },
          ],
        ]
      : []),
    [
      { id: 'bullet', label: 'Bulleted list', shortcut: '- ', icon: <BulletListIcon />, active: state.bullet, onRun: () => run().toggleBulletList().run() },
      { id: 'ordered', label: 'Numbered list', shortcut: '1. ', icon: <OrderedListIcon />, active: state.ordered, onRun: () => run().toggleOrderedList().run() },
      ...(variant === 'full'
        ? [{ id: 'task', label: 'Task list', shortcut: '[] ', icon: <TaskListIcon />, active: state.task, onRun: () => run().toggleTaskList().run() }]
        : []),
      { id: 'quote', label: 'Quote', shortcut: '> ', icon: <QuoteIcon />, active: state.quote, onRun: () => run().toggleBlockquote().run() },
      { id: 'codeblock', label: 'Code block', shortcut: '```', icon: <CodeBlockIcon />, active: state.codeBlock, onRun: () => run().toggleCodeBlock().run() },
    ],
    [
      { id: 'link', label: 'Link', shortcut: `${MOD}K`, icon: <LinkIcon />, active: state.link, onRun: onLink },
      ...(variant === 'full'
        ? [
            {
              id: 'table',
              label: 'Insert table',
              icon: <TableIcon />,
              active: state.table,
              disabled: state.table,
              onRun: () => run().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
            },
          ]
        : []),
      ...(canUploadImages
        ? [{ id: 'image', label: 'Insert image', icon: <ImageIcon />, onRun: onPickImages }]
        : []),
    ],
  ];

  const flat = groups.flat();
  const [roving, setRoving] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const buttons = Array.from(
      stripRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    );
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1) return;
    let next = current;
    if (e.key === 'ArrowRight') next = (current + 1) % buttons.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      editor.commands.focus();
      return;
    } else return;
    e.preventDefault();
    buttons[next]?.focus();
    const idx = flat.findIndex((b) => b.id === buttons[next]?.dataset.toolId);
    if (idx >= 0) setRoving(idx);
  }

  let index = -1;
  return (
    <div className="flex items-stretch border-b border-ink-100 bg-ink-50/60" data-testid={testId}>
      <div
        ref={stripRef}
        role="toolbar"
        aria-label="Formatting"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className="nl-tabstrip flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1.5 py-1"
      >
        {rich &&
          groups.map((group, gi) => (
            <div key={gi} role="group" className="flex shrink-0 items-center gap-0.5">
              {gi > 0 && <span role="separator" aria-orientation="vertical" className="mx-1 h-4 w-px shrink-0 bg-ink-200" />}
              {group.map((b) => {
                index += 1;
                return (
                  <button
                    key={b.id}
                    type="button"
                    data-tool-id={b.id}
                    data-testid={`editor-tool-${b.id}`}
                    aria-label={b.label}
                    aria-pressed={b.active ?? false}
                    title={b.shortcut ? `${b.label} (${b.shortcut.trim()})` : b.label}
                    disabled={disabled || b.disabled}
                    tabIndex={index === roving ? 0 : -1}
                    onFocus={() => setRoving(flat.findIndex((x) => x.id === b.id))}
                    // Keep the writing surface focused + selection intact.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={b.onRun}
                    className={btnBase}
                  >
                    {b.icon}
                  </button>
                );
              })}
            </div>
          ))}
        {rich && state.table && (
          <div role="group" aria-label="Table" className="flex shrink-0 items-center gap-0.5">
            <span role="separator" aria-orientation="vertical" className="mx-1 h-4 w-px shrink-0 bg-ink-200" />
            {[
              ['Add row', () => run().addRowAfter().run()],
              ['Add column', () => run().addColumnAfter().run()],
              ['Delete row', () => run().deleteRow().run()],
              ['Delete column', () => run().deleteColumn().run()],
              ['Delete table', () => run().deleteTable().run()],
            ].map(([label, fn]) => (
              <button
                key={label as string}
                type="button"
                data-testid={`editor-table-${(label as string).toLowerCase().replace(' ', '-')}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={fn as () => void}
                className={cn(
                  'inline-flex h-10 shrink-0 items-center rounded px-2 text-[11px] font-medium text-ink-600 sm:h-8',
                  'hover:bg-ink-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400',
                  label === 'Delete table' && 'text-red-600 hover:text-red-700',
                )}
              >
                {label as string}
              </button>
            ))}
          </div>
        )}
        {!rich && (
          <p className="px-2 font-mono text-[11px] text-ink-500">Raw Markdown — what is stored</p>
        )}
      </div>

      <div className="flex shrink-0 items-center border-l border-ink-100 px-1.5">
        <button
          type="button"
          data-testid="editor-markdown-toggle"
          aria-pressed={!rich}
          aria-label="Markdown source"
          title={rich ? 'Edit the raw Markdown' : 'Back to the visual editor'}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggleMode}
          className={cn(
            'inline-flex h-10 items-center gap-1.5 rounded px-2 font-mono text-[11px] font-medium tracking-wide sm:h-8',
            'text-ink-500 transition-colors duration-[120ms] hover:bg-ink-100 hover:text-ink-800',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400',
            'aria-pressed:bg-signal-600 aria-pressed:text-white aria-pressed:hover:bg-signal-700',
          )}
        >
          <span aria-hidden="true">{'</>'}</span>
          <span className="hidden sm:inline">Markdown</span>
          <span className="sm:hidden">MD</span>
        </button>
      </div>
    </div>
  );
}

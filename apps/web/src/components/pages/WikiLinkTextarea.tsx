/**
 * WikiLinkTextarea — a markdown textarea that shows a page-picker dropdown
 * whenever the caret is inside an in-progress `[[query` wiki-link trigger.
 * Selecting a page inserts `Title]]` (completing the `[[` the user already
 * typed); picking "Create new page" from the empty-query state is handled
 * by the caller (`PageEditor`) since it needs to mutate page data.
 *
 * Mirrors `MentionComposer`'s contract/keyboard UX 1:1 (arrow keys navigate,
 * Enter/Tab accept, Escape dismiss, click accepts) so the two composers feel
 * identical to a user who's learned one of them.
 *
 * Focus safety: caret placement after insertion uses ONLY
 * `element.setSelectionRange` — never `.focus()` — so the textarea never
 * loses focus mid-edit (the codebase's documented focus-loss lesson).
 */
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { Textarea } from '@/components/ui/Textarea';
import { detectWikiLinkTrigger, type FlatPageOption } from '@/lib/wikiLinks';
import { cn } from '@/lib/cn';

export interface WikiLinkTextareaProps {
  value: string;
  onChange: (value: string) => void;
  pages: FlatPageOption[];
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  'aria-label'?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  className?: string;
  'data-testid'?: string;
}

export interface WikiLinkTextareaHandle {
  focus(): void;
}

export const WikiLinkTextarea = forwardRef<WikiLinkTextareaHandle, WikiLinkTextareaProps>(
  function WikiLinkTextarea(
    {
      value,
      onChange,
      pages,
      placeholder,
      rows = 16,
      disabled,
      onKeyDown: parentOnKeyDown,
      onBlur: parentOnBlur,
      className,
      'aria-label': ariaLabel,
      'data-testid': dataTestId,
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [query, setQuery] = useState<string | null>(null);
    const [startIndex, setStartIndex] = useState(0);
    const [selectedIndex, setSelectedIndex] = useState(0);

    useImperativeHandle(ref, () => ({
      focus() {
        textareaRef.current?.focus();
      },
    }));

    const filtered =
      query !== null
        ? pages.filter((p) => p.title.toLowerCase().includes(query.toLowerCase()))
        : [];

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        onChange(newValue);
        const caret = e.target.selectionStart ?? newValue.length;
        const trigger = detectWikiLinkTrigger(newValue, caret);
        if (trigger) {
          setQuery(trigger.query);
          setStartIndex(trigger.startIndex);
          setSelectedIndex(0);
        } else {
          setQuery(null);
        }
      },
      [onChange],
    );

    const insertPage = useCallback(
      (page: FlatPageOption) => {
        if (!textareaRef.current) return;
        const caret = textareaRef.current.selectionStart ?? value.length;
        // startIndex points at the FIRST `[` of the `[[` already typed —
        // replace from just after it (index + 2) through the caret with the
        // resolved title, and close the link with `]]`.
        const before = value.slice(0, startIndex + 2);
        const after = value.slice(caret);
        const insertion = `${page.title}]]`;
        const newValue = `${before}${insertion}${after}`;
        onChange(newValue);
        setQuery(null);

        const newCaret = before.length + insertion.length;
        requestAnimationFrame(() => {
          textareaRef.current?.setSelectionRange(newCaret, newCaret);
        });
      },
      [value, startIndex, onChange],
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (query !== null && filtered.length > 0) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex((i) => (i + 1) % filtered.length);
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex((i) => (i === 0 ? filtered.length - 1 : i - 1));
            return;
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            insertPage(filtered[selectedIndex]);
            return;
          }
        }
        if (e.key === 'Escape' && query !== null) {
          e.preventDefault();
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          setQuery(null);
          return;
        }
        parentOnKeyDown?.(e);
      },
      [query, filtered, selectedIndex, insertPage, parentOnKeyDown],
    );

    const isOpen = query !== null;
    const hasResults = filtered.length > 0;

    return (
      // flex/min-h-0 so a parent can stretch the textarea into a full-page
      // editing canvas (PageEditor's edit mode) — inert when not stretched.
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={(e) => {
            parentOnBlur?.(e);
          }}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className={cn('font-mono text-sm leading-relaxed', className)}
          aria-label={ariaLabel}
          aria-autocomplete={isOpen ? 'list' : undefined}
          aria-expanded={isOpen}
          aria-controls={isOpen ? 'wikilink-picker' : undefined}
          aria-activedescendant={isOpen && hasResults ? `wikilink-option-${selectedIndex}` : undefined}
          data-testid={dataTestId}
        />

        {isOpen && (
          <ul
            id="wikilink-picker"
            role="listbox"
            data-testid="wikilink-picker"
            aria-label="Insert a wiki-link"
            className={cn(
              'absolute top-full left-0 z-50 mt-1 w-80 max-w-[90vw]',
              'max-h-56 overflow-y-auto rounded-lg border border-ink-200 bg-surface shadow-cardHover',
              'motion-safe:animate-nl-fade-in',
            )}
          >
            {hasResults ? (
              filtered.slice(0, 30).map((page, idx) => (
                <li
                  key={page.id}
                  id={`wikilink-option-${idx}`}
                  role="option"
                  aria-selected={idx === selectedIndex}
                  data-testid={`wikilink-option-${idx}`}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
                    idx === selectedIndex
                      ? 'bg-signal-50 text-signal-700'
                      : 'text-ink-700 hover:bg-ink-50',
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertPage(page);
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-ink-400" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v4a1 1 0 0 0 1 1h4M6 3h6l6 6v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
                  </svg>
                  <span className="truncate">{page.title}</span>
                </li>
              ))
            ) : (
              <li
                role="option"
                aria-selected={false}
                aria-disabled="true"
                data-testid="wikilink-no-results"
                className="px-3 py-2 text-sm text-ink-400"
              >
                {query ? (
                  <>No page titled &ldquo;{query}&rdquo; yet — finish typing <code>]]</code> to link it anyway.</>
                ) : (
                  'Type a page title to link it…'
                )}
              </li>
            )}
          </ul>
        )}
      </div>
    );
  },
);

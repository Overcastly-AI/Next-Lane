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
 *
 * Picker positioning (2026-07-18 founder bug fix): the dropdown used to be
 * `absolute top-full left-0` of the textarea — pinned to the textarea's
 * BOTTOM EDGE. In the full-page page editor the textarea fills (and
 * internally scrolls within) the viewport height, so a caret near the top of
 * a long document put the dropdown far below the visible area, forcing a
 * scroll to find it. It now tracks the caret itself: `computeDropdownPlacement`
 * (see `lib/caretCoordinates.ts`) measures the caret's real pixel position and
 * places the picker as `position: fixed` right next to it, flipping above
 * when there isn't room below and always clamped fully inside the viewport.
 * Repositioned on caret movement (query/startIndex change), textarea scroll,
 * and window resize — NOT on unrelated re-renders (e.g. arrow-key selection),
 * to avoid jitter.
 */
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Textarea } from '@/components/ui/Textarea';
import { detectWikiLinkTrigger, type FlatPageOption } from '@/lib/wikiLinks';
import { computeDropdownPlacement, getCaretCoordinates, type DropdownPlacement } from '@/lib/caretCoordinates';
import { cn } from '@/lib/cn';

// Fallback size used for the very first layout pass, before the picker has
// rendered once and we can measure its real box (CSS caps it at `w-80
// max-w-[90vw]` / `max-h-56`, so this is a close estimate — a same-frame
// `useLayoutEffect` remeasures against the real box immediately after,
// before paint, so there's no visible jump).
const ESTIMATED_PICKER_WIDTH = 320;
const ESTIMATED_PICKER_HEIGHT = 224;

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
    const pickerRef = useRef<HTMLUListElement>(null);
    const [query, setQuery] = useState<string | null>(null);
    const [startIndex, setStartIndex] = useState(0);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [placement, setPlacement] = useState<DropdownPlacement | null>(null);

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

    // Recompute the picker's caret-anchored position. Reads live DOM
    // measurements (never reads/writes React state directly here besides the
    // `placement` setter) so it's safe to call from effects and DOM event
    // listeners alike.
    const reposition = useCallback(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const caretIndex = textarea.selectionStart ?? 0;
      const caret = getCaretCoordinates(textarea, caretIndex);
      const textareaRect = textarea.getBoundingClientRect();
      const pickerEl = pickerRef.current;
      setPlacement(
        computeDropdownPlacement({
          textareaRect,
          caret,
          scrollTop: textarea.scrollTop,
          scrollLeft: textarea.scrollLeft,
          dropdownWidth: pickerEl?.offsetWidth || ESTIMATED_PICKER_WIDTH,
          dropdownHeight: pickerEl?.offsetHeight || ESTIMATED_PICKER_HEIGHT,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        }),
      );
    }, []);

    // Follow the caret: reposition whenever the trigger's query/start moves
    // (i.e. the user keeps typing the link title) or the picker just opened.
    // Deliberately does NOT depend on `selectedIndex` (arrow-key navigation
    // never moves the caret) so it never jitters on unrelated re-renders.
    useLayoutEffect(() => {
      if (query === null) {
        setPlacement(null);
        return;
      }
      reposition();
    }, [query, startIndex, reposition]);

    // While open, also track the textarea's own internal scroll (the
    // full-page editor's textarea scrolls WITHIN itself — see PageEditor) and
    // window resizes, so the picker keeps tracking the caret's live viewport
    // position rather than going stale.
    useLayoutEffect(() => {
      if (query === null) return;
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.addEventListener('scroll', reposition);
      window.addEventListener('resize', reposition);
      return () => {
        textarea.removeEventListener('scroll', reposition);
        window.removeEventListener('resize', reposition);
      };
    }, [query, reposition]);

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
            ref={pickerRef}
            id="wikilink-picker"
            role="listbox"
            data-testid="wikilink-picker"
            aria-label="Insert a wiki-link"
            // Caret-anchored, not textarea-anchored (2026-07-18 fix — see the
            // component doc comment): `position: fixed` at a viewport point
            // computed by `computeDropdownPlacement`, which flips above the
            // caret line when there isn't room below and clamps fully inside
            // the viewport. Until the first measurement lands (same paint,
            // via `useLayoutEffect`), park it off-screen instead of at the
            // fixed-position default (0,0) to avoid a top-left flash.
            style={
              placement
                ? { top: placement.top, left: placement.left }
                : { top: -9999, left: -9999 }
            }
            className={cn(
              'fixed z-50 w-80 max-w-[90vw]',
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

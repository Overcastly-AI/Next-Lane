/**
 * The `@` / `[[` autocomplete popup. Same affordances (and test ids) the
 * textarea composers had; positioned at the caret and flipped above it when
 * the caret sits low in the viewport, so it is never pushed off-screen.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { UserDto } from '@next-lane/shared';
import { Avatar } from '@/components/ui/Avatar';
import type { FlatPageOption } from '@/lib/wikiLinks';
import { cn } from '@/lib/cn';
import type { PickerState } from './suggestions';

const GAP = 6;
const FLIP_VIEWPORT_THRESHOLD = 0.6;

export function SuggestionPicker({
  picker,
  selectedIndex,
  wrapperRef,
  onHover,
}: {
  picker: PickerState;
  selectedIndex: number;
  wrapperRef: React.RefObject<HTMLElement>;
  onHover: (index: number) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });
  const isMention = picker.kind === 'mention';
  const testPrefix = isMention ? 'mention' : 'wikilink';

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const list = listRef.current;
    const rect = picker.rect;
    if (!wrapper || !rect) return;
    const w = wrapper.getBoundingClientRect();
    const width = list?.offsetWidth || 320;
    const left = Math.min(Math.max(rect.left - w.left, 0), Math.max(0, w.width - width));
    const openAbove = rect.top > window.innerHeight * FLIP_VIEWPORT_THRESHOLD;
    setPos(
      openAbove
        ? { left, bottom: w.bottom - rect.top + GAP }
        : { left, top: rect.bottom - w.top + GAP },
    );
  }, [picker.rect, picker.items.length, picker.query, wrapperRef]);

  // Keep the highlighted option in view when arrowing through a long list.
  useLayoutEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`#${testPrefix}-option-${selectedIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, testPrefix]);

  const hasResults = picker.items.length > 0;
  return (
    <ul
      ref={listRef}
      id={`${testPrefix}-picker`}
      role="listbox"
      data-testid={`${testPrefix}-picker`}
      aria-label={isMention ? 'Select a member to mention' : 'Insert a wiki-link'}
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
      className={cn(
        'absolute z-50 w-80 max-w-[90vw] max-h-56 overflow-y-auto rounded-lg border border-ink-200 bg-surface shadow-cardHover',
        'motion-safe:animate-nl-fade-in',
      )}
    >
      {hasResults ? (
        picker.items.map((item, idx) => {
          const selected = idx === selectedIndex;
          const common = {
            id: `${testPrefix}-option-${idx}`,
            role: 'option' as const,
            'aria-selected': selected,
            'data-testid': `${testPrefix}-option-${idx}`,
            // mousedown (not click) so the editor never loses focus.
            onMouseDown: (e: React.MouseEvent) => {
              e.preventDefault();
              picker.command(item);
            },
            onMouseEnter: () => onHover(idx),
          };
          if (isMention) {
            const user = item as UserDto;
            return (
              <li
                key={user.id}
                {...common}
                className={cn(
                  'flex min-h-[44px] cursor-pointer items-center gap-2.5 px-3 py-2 text-sm sm:min-h-0',
                  selected ? 'bg-signal-50 text-signal-700' : 'text-ink-700 hover:bg-ink-50',
                )}
              >
                <Avatar user={user} size="sm" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{user.name}</p>
                  <p className="truncate text-xs text-ink-400">{user.email}</p>
                </div>
              </li>
            );
          }
          const page = item as FlatPageOption;
          return (
            <li
              key={page.id}
              {...common}
              className={cn(
                'flex min-h-[44px] cursor-pointer items-center gap-2 px-3 py-2 text-sm sm:min-h-0',
                selected ? 'bg-signal-50 text-signal-700' : 'text-ink-700 hover:bg-ink-50',
              )}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-ink-400" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v4a1 1 0 0 0 1 1h4M6 3h6l6 6v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
              </svg>
              <span className="truncate">{page.title}</span>
            </li>
          );
        })
      ) : (
        <li
          role="option"
          aria-selected={false}
          aria-disabled="true"
          data-testid={`${testPrefix}-no-results`}
          className="px-3 py-2 text-sm text-ink-400"
        >
          {isMention ? (
            <>No members match &ldquo;@{picker.query}&rdquo;</>
          ) : picker.query ? (
            <>
              No page titled &ldquo;{picker.query}&rdquo; yet — finish typing <code>]]</code> to link it anyway.
            </>
          ) : (
            'Type a page title to link it…'
          )}
        </li>
      )}
    </ul>
  );
}

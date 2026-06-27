/**
 * MentionComposer — a textarea wrapper that shows a member-picker dropdown
 * whenever the user types `@` (or `@partial-text`). Selecting a member inserts
 * the token `@<email>` in the format the backend's mention parser expects.
 *
 * Keyboard contract:
 *  - Arrow ↑/↓  move selection
 *  - Enter / Tab  insert the selected member
 *  - Escape       dismiss without inserting
 *  - Normal typing filters the list character by character
 *
 * Focus safety: we ONLY use `element.setSelectionRange` to adjust the caret
 * after insertion — we never call `.focus()` ourselves (avoiding re-entry
 * focus-loss that was a previous bug in this codebase).
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { UserDto } from '@next-lane/shared';
import { Textarea } from '@/components/ui/Textarea';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/cn';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface MentionComposerProps {
  value: string;
  onChange: (value: string) => void;
  users: UserDto[];
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  'aria-label'?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  className?: string;
  /** data-testid forwarded to the textarea element */
  'data-testid'?: string;
}

/** Methods exposed to parent via ref so they can focus the textarea. */
export interface MentionComposerHandle {
  focus(): void;
}

// ────────────────────────────────────────────────────────────────────────────
// Picker detection helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Given the full textarea value and the current caret position, determine
 * whether the caret is inside an `@mention` token.
 *
 * Returns `{ query, atIndex }` when active, or `null` when the caret is not
 * after a `@` that is still being completed. `atIndex` is the position of the
 * `@` char; `query` is everything after it up to the caret.
 *
 * Rules:
 *  - The `@` must be preceded by whitespace, the start of the string, or
 *    another `@`. This prevents triggering inside e-mail addresses that already
 *    exist in the text.
 *  - The query portion may contain any non-whitespace character (email chars).
 */
function detectMention(
  value: string,
  caret: number,
): { query: string; atIndex: number } | null {
  // Scan backwards from caret to find an `@` not preceded by non-whitespace.
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === '@') {
      // Check the character before `@`: must be start-of-string, space, or newline.
      const before = value[i - 1];
      if (i === 0 || before === ' ' || before === '\n' || before === '\t') {
        const query = value.slice(i + 1, caret);
        // query must not contain whitespace
        if (!/\s/.test(query)) {
          return { query, atIndex: i };
        }
      }
      return null; // `@` preceded by non-whitespace → inside an email, ignore
    }
    // Hit whitespace → no mention active
    if (ch === ' ' || ch === '\n' || ch === '\t') return null;
    i--;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export const MentionComposer = forwardRef<
  MentionComposerHandle,
  MentionComposerProps
>(function MentionComposer(
  {
    value,
    onChange,
    users,
    placeholder,
    rows = 2,
    disabled,
    onKeyDown: parentOnKeyDown,
    className,
    'aria-label': ariaLabel,
    'data-testid': dataTestId,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Picker state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [atIndex, setAtIndex] = useState<number>(0);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  useImperativeHandle(ref, () => ({
    focus() {
      textareaRef.current?.focus();
    },
  }));

  // ---- Filtered members ------------------------------------------------
  const filteredUsers =
    mentionQuery !== null
      ? users.filter((u) => {
          const q = mentionQuery.toLowerCase();
          return (
            u.name.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q)
          );
        })
      : [];

  // Clamp selectedIndex when the list shrinks.
  useEffect(() => {
    if (selectedIndex >= filteredUsers.length) {
      setSelectedIndex(Math.max(0, filteredUsers.length - 1));
    }
  }, [filteredUsers.length, selectedIndex]);

  // ---- Textarea handlers ----------------------------------------------

  /**
   * On every keystroke, re-evaluate whether the caret is in a mention context.
   * We read `selectionStart` from the event target — this is reliable and does
   * not cause any focus changes.
   */
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onChange(newValue);
      const caret = e.target.selectionStart ?? newValue.length;
      const mention = detectMention(newValue, caret);
      if (mention) {
        setMentionQuery(mention.query);
        setAtIndex(mention.atIndex);
        setSelectedIndex(0);
      } else {
        setMentionQuery(null);
      }
    },
    [onChange],
  );

  /**
   * Intercept arrow keys, Enter, Tab, and Escape when the picker is open so
   * those keys navigate / confirm / dismiss the picker instead of the textarea.
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionQuery !== null && filteredUsers.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % filteredUsers.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((i) =>
            i === 0 ? filteredUsers.length - 1 : i - 1,
          );
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          insertMention(filteredUsers[selectedIndex]);
          return;
        }
      }
      if (e.key === 'Escape' && mentionQuery !== null) {
        e.preventDefault();
        e.stopPropagation();
        // Also stop the native event from reaching the document-level Escape
        // handler in useOverlay (which would close the drawer).
        e.nativeEvent.stopImmediatePropagation();
        setMentionQuery(null);
        return;
      }
      // Let parent handle the rest (e.g. Cmd+Enter to submit).
      parentOnKeyDown?.(e);
    },
    [mentionQuery, filteredUsers, selectedIndex, parentOnKeyDown],
  );

  // ---- Insertion ------------------------------------------------------

  const insertMention = useCallback(
    (user: UserDto) => {
      if (!textareaRef.current) return;
      const caret = textareaRef.current.selectionStart ?? value.length;
      const token = `@${user.email}`;
      // Replace from `atIndex` (the `@`) to the current caret with the token + space.
      const before = value.slice(0, atIndex);
      const after = value.slice(caret);
      const newValue = `${before}${token} ${after}`;
      onChange(newValue);
      setMentionQuery(null);

      // Place caret right after the inserted token + space, without stealing focus.
      const newCaret = before.length + token.length + 1;
      // Use rAF so the React state update has flushed before we set selection.
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(newCaret, newCaret);
        }
      });
    },
    [value, atIndex, onChange],
  );

  // ---- Dismiss on click outside ----------------------------------------
  // We use `onMouseDown` on picker items (not `onClick`) so the textarea never
  // loses focus when the user clicks a suggestion.

  // Show picker whenever there is an active mention query (even if no matches),
  // so users get feedback that their query didn't match anyone.
  const isOpen = mentionQuery !== null;
  // Only enable keyboard navigation/insertion when there are actual results.
  const hasResults = filteredUsers.length > 0;

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={className}
        aria-label={ariaLabel}
        aria-autocomplete={isOpen ? 'list' : undefined}
        aria-expanded={isOpen}
        aria-controls={isOpen ? 'mention-picker' : undefined}
        aria-activedescendant={
          isOpen && hasResults ? `mention-option-${selectedIndex}` : undefined
        }
        data-testid={dataTestId}
      />

      {isOpen && (
        <ul
          id="mention-picker"
          role="listbox"
          data-testid="mention-picker"
          aria-label="Select a member to mention"
          className={cn(
            'absolute top-full left-0 z-50 mt-1 w-72',
            'max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-cardHover',
          )}
        >
          {hasResults ? (
            filteredUsers.map((user, idx) => (
              <li
                key={user.id}
                id={`mention-option-${idx}`}
                role="option"
                aria-selected={idx === selectedIndex}
                data-testid={`mention-option-${idx}`}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm',
                  idx === selectedIndex
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-700 hover:bg-gray-50',
                )}
                // onMouseDown instead of onClick keeps the textarea focused
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(user);
                }}
              >
                <Avatar user={user} size="sm" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{user.name}</p>
                  <p className="truncate text-xs text-gray-400">{user.email}</p>
                </div>
              </li>
            ))
          ) : (
            <li
              role="option"
              aria-selected={false}
              aria-disabled="true"
              data-testid="mention-no-results"
              className="px-3 py-2 text-sm text-gray-400"
            >
              No members match &ldquo;@{mentionQuery}&rdquo;
            </li>
          )}
        </ul>
      )}
    </div>
  );
});

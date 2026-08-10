import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from 'react';
import { cn } from '@/lib/cn';

/**
 * DateInput — the canonical date control.
 *
 * WHY THIS EXISTS (do not "simplify" it back into a plain controlled input):
 *
 * A native `<input type="date">` is three separate segments, and it fires
 * `change` on EVERY keystroke that leaves all three of them filled. Typing the
 * year of 12/25/2031 therefore emits four complete-looking dates —
 * `0002-12-25`, `0020-12-25`, `0203-12-25`, `2031-12-25` — one per digit.
 *
 * A field that wrote straight from `onChange` turned each of those into a real
 * mutation, which broke typing in two compounding ways:
 *
 *   1. Every intermediate year was persisted, written to the activity log, and
 *      put through server validation — so typing a due date on an issue that
 *      already had a start date threw "startDate must be on or before dueDate"
 *      three times before the user finished the year.
 *   2. Whenever one of those writes echoed back a value different from what was
 *      in the box (a refetch racing the write, or a rejected write leaving the
 *      old value), React assigned to `input.value` — and assigning to a focused
 *      date input resets ALL of its segments. The year could never be finished;
 *      it came back as `0001-12-25`, or the field emptied entirely. Choosing
 *      from the calendar always worked, because that sets every segment at once
 *      and fires exactly one change event.
 *
 * So: the typed value lives in local state, the `value` prop is only allowed to
 * overwrite it while the field is unfocused, and `onCommit` fires once per
 * settled edit — when the year is actually plausible (>= 1000, i.e. all four
 * digits are in), on blur, on Enter, or on unmount so a half-finished edit
 * isn't lost when the drawer closes.
 */
export interface DateInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'type' | 'defaultValue'
  > {
  /**
   * Current value — a `yyyy-mm-dd` string, a full ISO timestamp (the date part
   * is used), or null/'' for no date.
   */
  value: string | null | undefined;
  /**
   * Called once per settled edit with `yyyy-mm-dd`, or null when cleared.
   * Never called with a partially typed date.
   */
  onCommit: (value: string | null) => void;
}

/** Narrow an ISO timestamp or date string down to the `yyyy-mm-dd` the input wants. */
export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

/**
 * Is this draft finished enough to send? A date input reports a value only once
 * every segment is filled, so the sole ambiguous segment is the year: the user
 * is mid-year until all four digits are in. Years below 1000 are treated as
 * still-being-typed — they are reachable only by typing, never by the picker,
 * and blur commits whatever is in the box anyway.
 */
export function isSettledDateDraft(draft: string): boolean {
  if (draft === '') return false; // empty is only committed on blur — see below
  const year = Number(draft.slice(0, 4));
  return Number.isFinite(year) && year >= 1000;
}

export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(
  (
    { value, onCommit, className, onBlur, onFocus, onKeyDown, ...rest },
    ref,
  ) => {
    const normalized = toDateInputValue(value);
    const [draft, setDraft] = useState(normalized);
    const focused = useRef(false);
    // Last value handed to onCommit, so a blur after an in-place commit (or a
    // no-op edit) doesn't fire a second, identical write.
    const committed = useRef(normalized);
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const onCommitRef = useRef(onCommit);
    onCommitRef.current = onCommit;

    // Accept outside changes (a different issue, someone else's edit, a clear
    // button) — but never while the user is mid-edit, since overwriting a
    // focused date input wipes every segment.
    useEffect(() => {
      if (focused.current) return;
      setDraft(normalized);
      committed.current = normalized;
    }, [normalized]);

    const commit = useCallback((next: string) => {
      if (next === committed.current) return;
      committed.current = next;
      onCommitRef.current(next === '' ? null : next);
    }, []);

    // Flush a finished-but-unblurred edit when the field goes away — closing the
    // drawer with Escape unmounts the input without a blur event.
    useEffect(
      () => () => {
        const pending = draftRef.current;
        if (pending !== committed.current && isSettledDateDraft(pending)) {
          committed.current = pending;
          onCommitRef.current(pending);
        }
      },
      [],
    );

    return (
      <input
        ref={ref}
        type="date"
        value={draft}
        onFocus={(e: FocusEvent<HTMLInputElement>) => {
          focused.current = true;
          onFocus?.(e);
        }}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const next = e.target.value;
          setDraft(next);
          // Committing a settled date immediately keeps picker selections and
          // finished typing saving right away; the local draft means the
          // resulting re-render can't disturb the segments being edited.
          if (isSettledDateDraft(next)) commit(next);
        }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') commit(draftRef.current);
          onKeyDown?.(e);
        }}
        onBlur={(e: FocusEvent<HTMLInputElement>) => {
          focused.current = false;
          // On blur the user is done, so an empty field means "cleared" rather
          // than "mid-edit", and a hand-typed year below 1000 is taken at face
          // value.
          commit(draftRef.current);
          onBlur?.(e);
        }}
        className={cn(
          'h-9 rounded border border-ink-200 bg-surface px-2.5 text-sm text-ink-900',
          'transition-all duration-[120ms] hover:border-ink-300',
          'focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-200',
          'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400',
          // The native picker glyph defaults to a heavy black square that sits
          // outside the palette; dim it to a muted ink and let it come forward
          // on hover/focus like every other affordance in the system.
          '[&::-webkit-calendar-picker-indicator]:cursor-pointer',
          '[&::-webkit-calendar-picker-indicator]:opacity-45',
          '[&::-webkit-calendar-picker-indicator]:transition-opacity',
          '[&::-webkit-calendar-picker-indicator]:duration-[120ms]',
          'hover:[&::-webkit-calendar-picker-indicator]:opacity-90',
          'focus:[&::-webkit-calendar-picker-indicator]:opacity-90',
          className,
        )}
        {...rest}
      />
    );
  },
);
DateInput.displayName = 'DateInput';

/**
 * NlqlInput — a context-aware autocomplete input for the NLQL query language.
 *
 * Renders a combobox (input + dropdown listbox) that calls suggestNlql() on
 * every keystroke and caret movement. Keyboard UX: ↓/↑ moves highlight,
 * Enter/Tab accepts, Esc closes, clicking accepts.
 *
 * ARIA: combobox pattern — input has role="combobox" aria-expanded
 * aria-controls aria-activedescendant; listbox has role="listbox";
 * each option has role="option".
 *
 * testids: nlql-query-input (the input), nlql-suggestions (listbox),
 * nlql-suggestion-N (each option).
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useMemo,
} from 'react';
import {
  suggestNlql,
  type NlqlSuggestContext,
  type NlqlSuggestion,
} from '@next-lane/shared';
import { useLabels, useUsers, useSprints } from '@/api/meta';
import { useComponents } from '@/api/components';
import { useCustomFields } from '@/api/custom-fields';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NlqlInputProps {
  value: string;
  onChange: (v: string) => void;
  projectId: string;
  /** Additional ARIA description id (e.g. for error messages). */
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
  placeholder?: string;
  className?: string;
  /** Statuses to include as value suggestions — threaded in from BoardPage. */
  statuses?: string[];
  /** Custom field defs from the board — threaded in from BoardPage. */
  customFieldDefs?: Array<{ id: string; key: string; name: string; type: string }>;
}

// ---------------------------------------------------------------------------
// Kind → display tag
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<string, string> = {
  field: 'field',
  operator: 'op',
  keyword: 'kw',
  function: 'fn',
  value: 'val',
};

const KIND_COLORS: Record<string, string> = {
  field: 'bg-signal-50 text-signal-700 ring-signal-200',
  operator: 'bg-ink-50 text-ink-600 ring-ink-200',
  keyword: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  function: 'bg-amber-50 text-amber-700 ring-amber-200',
  value: 'bg-ink-50 text-ink-500 ring-ink-200',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NlqlInput({
  value,
  onChange,
  projectId,
  statuses = [],
  customFieldDefs = [],
  placeholder = 'Filter: priority = HIGH AND assignee = me()',
  className,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-label': ariaLabel = 'NLQL filter query',
  'data-testid': testId = 'nlql-query-input',
}: NlqlInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Unique ids for ARIA
  const listboxId = useId();

  // Dropdown state
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<number>(-1);
  const [suggestions, setSuggestions] = useState<NlqlSuggestion[]>([]);
  const [replaceRange, setReplaceRange] = useState<{ from: number; to: number }>({ from: 0, to: 0 });

  // Data hooks
  const labelsQuery = useLabels(projectId);
  const usersQuery = useUsers();
  const sprintsQuery = useSprints(projectId);
  const componentsQuery = useComponents(projectId);
  const customFieldsQuery = useCustomFields(projectId);

  // Build suggestion context from loaded data
  const ctx = useMemo<NlqlSuggestContext>(() => {
    const cfDefs = customFieldDefs.length > 0
      ? customFieldDefs
      : (customFieldsQuery.data ?? []);

    return {
      statuses,
      types: ['TASK', 'BUG', 'STORY', 'EPIC', 'SUBTASK'],
      priorities: ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'],
      statusCategories: ['TODO', 'IN_PROGRESS', 'DONE'],
      labels: (labelsQuery.data ?? []).map((l) => l.name),
      users: (usersQuery.data ?? []).map((u) => ({
        label: u.name,
        value: u.email ?? u.name,
      })),
      components: (componentsQuery.data ?? []).map((c) => c.name),
      sprints: (sprintsQuery.data ?? []).map((s) => s.name),
      customFields: cfDefs.map((cf) => ({
        key: cf.key,
        kind: cf.type,
      })),
    };
  }, [
    statuses,
    labelsQuery.data,
    usersQuery.data,
    sprintsQuery.data,
    componentsQuery.data,
    customFieldDefs,
    customFieldsQuery.data,
  ]);

  // Compute suggestions whenever the value or caret changes
  const computeSuggestions = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? value.length;

    try {
      const result = suggestNlql(value, cursor, ctx);
      setSuggestions(result.suggestions);
      setReplaceRange({ from: result.from, to: result.to });
      setHighlighted(-1);
      setOpen(result.suggestions.length > 0);
    } catch {
      // Defensive: never crash
      setSuggestions([]);
      setOpen(false);
    }
  }, [value, ctx]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Accept a suggestion — insert into the input and keep focus.
  const acceptSuggestion = useCallback(
    (suggestion: NlqlSuggestion) => {
      const { from, to } = replaceRange;
      const before = value.slice(0, from);
      const after = value.slice(to);
      const insert = suggestion.insertText;
      const newValue = before + insert + after;

      onChange(newValue);
      setOpen(false);
      setSuggestions([]);
      setHighlighted(-1);

      // Move caret to end of insertion
      const newCaret = from + insert.length;
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(newCaret, newCaret);
        }
      });
    },
    [value, replaceRange, onChange],
  );

  // Keyboard handler on the input
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (highlighted >= 0 && highlighted < suggestions.length) {
          e.preventDefault();
          acceptSuggestion(suggestions[highlighted]);
        } else {
          // No highlight: close the dropdown
          setOpen(false);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        setHighlighted(-1);
      }
    },
    [open, suggestions, highlighted, acceptSuggestion],
  );

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlighted < 0) return;
    const listbox = listboxRef.current;
    if (!listbox) return;
    const item = listbox.children[highlighted] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  const activeDescendant =
    open && highlighted >= 0 ? `${listboxId}-option-${highlighted}` : undefined;

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        ref={inputRef}
        data-testid={testId}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={activeDescendant}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onInput={computeSuggestions}
        onKeyUp={(e) => {
          // Recompute on arrow keys that move the caret but don't trigger onChange
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' &&
              e.key !== 'Enter' && e.key !== 'Tab' && e.key !== 'Escape') {
            computeSuggestions();
          }
        }}
        onKeyDown={handleKeyDown}
        onClick={computeSuggestions}
        onFocus={computeSuggestions}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className={cn(
          'h-9 w-full rounded border border-ink-200 bg-white px-3 font-mono text-xs text-ink-900',
          'placeholder:text-ink-400 transition-all duration-[120ms]',
          'hover:border-ink-300',
          'focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-200',
          ariaInvalid && 'border-red-400 focus:border-red-500 focus:ring-red-200',
          className,
        )}
      />

      {open && suggestions.length > 0 && (
        <ul
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          data-testid="nlql-suggestions"
          aria-label="NLQL suggestions"
          className={cn(
            'absolute left-0 top-full z-50 mt-1',
            'max-h-64 w-full min-w-[18rem] overflow-y-auto',
            'rounded-lg border border-ink-200 bg-white shadow-cardHover',
            'motion-safe:animate-nl-fade-in',
          )}
        >
          {suggestions.map((suggestion, idx) => {
            const isHighlighted = idx === highlighted;
            const kindLabel = KIND_LABELS[suggestion.kind] ?? suggestion.kind;
            const kindColor = KIND_COLORS[suggestion.kind] ?? KIND_COLORS.value;

            return (
              <li
                key={`${suggestion.label}-${idx}`}
                id={`${listboxId}-option-${idx}`}
                role="option"
                data-testid={`nlql-suggestion-${idx}`}
                aria-selected={isHighlighted}
                onMouseDown={(e) => {
                  // Prevent the input from losing focus on click
                  e.preventDefault();
                  acceptSuggestion(suggestion);
                }}
                onMouseEnter={() => setHighlighted(idx)}
                className={cn(
                  'flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-1.5',
                  'text-sm transition-colors duration-[80ms]',
                  isHighlighted
                    ? 'bg-signal-50 text-signal-900'
                    : 'text-ink-800 hover:bg-ink-50',
                )}
              >
                <span className="min-w-0 truncate font-mono text-xs font-medium">
                  {suggestion.label}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  {suggestion.detail && (
                    <span className="truncate text-[11px] text-ink-400 max-w-[12rem]">
                      {suggestion.detail}
                    </span>
                  )}
                  <span
                    className={cn(
                      'rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1',
                      kindColor,
                    )}
                  >
                    {kindLabel}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

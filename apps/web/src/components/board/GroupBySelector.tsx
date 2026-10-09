/**
 * GroupBySelector — swimlane dimension picker for the board toolbar.
 * Same 36px/40px-touch control family as the Filter trigger.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CustomFieldDefinitionDto } from '@next-lane/shared';
import { DropdownPanel } from '@/components/ui/DropdownPanel';
import {
  CORE_GROUP_BY_OPTIONS,
  customFieldGroupByOptions,
  type GroupByOption,
} from '@/lib/groupByDimensions';
import type { GroupByDimension } from './BoardSwimlanesView';
import { cn } from '@/lib/cn';

export function GroupBySelector({
  value,
  onChange,
  customFieldDefs,
}: {
  value: GroupByDimension | null;
  onChange: (next: GroupByDimension | null) => void;
  customFieldDefs: CustomFieldDefinitionDto[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const customOptions = useMemo(
    () => customFieldGroupByOptions(customFieldDefs),
    [customFieldDefs],
  );
  const allOptions: GroupByOption[] = [...CORE_GROUP_BY_OPTIONS, ...customOptions];
  const activeLabel = allOptions.find((o) => o.value === value)?.label;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        data-testid="swimlane-groupby"
        aria-label="Group by"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-sm font-medium transition-colors duration-[120ms] max-sm:h-10',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
          value
            ? 'border-signal-300 bg-signal-50 text-signal-700 hover:bg-signal-100'
            : 'border-ink-200 bg-surface text-ink-700 shadow-xs hover:border-ink-300 hover:bg-ink-50',
        )}
      >
        {/* Rows/swimlane icon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="3" width="18" height="5" rx="1" />
          <rect x="3" y="10" width="18" height="5" rx="1" />
          <rect x="3" y="17" width="18" height="5" rx="1" />
        </svg>
        {value ? `Group: ${activeLabel}` : 'Group by'}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <DropdownPanel
        open={open}
        anchorRef={ref}
        panelRef={panelRef}
        role="menu"
        aria-label="Group by menu"
        className="w-52 max-h-[26rem] overflow-y-auto rounded-xl border border-ink-200 bg-surface p-1.5 shadow-dropdown"
      >
        <>
          {/* None option */}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={value === null}
            data-testid="groupby-option-none"
            onClick={() => { onChange(null); setOpen(false); }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm max-sm:py-3 transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500',
              value === null
                ? 'bg-signal-50 font-medium text-signal-700'
                : 'text-ink-700 hover:bg-ink-50',
            )}
          >
            None
          </button>

          <div className="my-1 border-t border-ink-100" />

          {CORE_GROUP_BY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="menuitemradio"
              aria-checked={value === opt.value}
              data-testid={`groupby-option-${opt.value}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm max-sm:py-3 transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500',
                value === opt.value
                  ? 'bg-signal-50 font-medium text-signal-700'
                  : 'text-ink-700 hover:bg-ink-50',
              )}
            >
              {opt.label}
            </button>
          ))}

          {customOptions.length > 0 && (
            <>
              <div className="my-1 border-t border-ink-100" />
              <p
                className="px-2.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500"
                aria-hidden="true"
              >
                Custom fields
              </p>
              {customOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === opt.value}
                  data-testid={`groupby-option-${opt.value}`}
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm max-sm:py-3 transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500',
                    value === opt.value
                      ? 'bg-signal-50 font-medium text-signal-700'
                      : 'text-ink-700 hover:bg-ink-50',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </>
          )}
        </>
      </DropdownPanel>
    </div>
  );
}


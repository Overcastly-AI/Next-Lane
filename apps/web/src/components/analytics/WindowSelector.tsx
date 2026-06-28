/**
 * 14 / 30 / 90-day rolling window selector.
 * Renders as a segmented control (button group) matching the Dispatch design tokens.
 */
export function WindowSelector({
  days,
  onChange,
  testId = 'window-selector',
}: {
  days: number;
  onChange: (days: number) => void;
  testId?: string;
}) {
  const options: { value: number; label: string }[] = [
    { value: 14, label: '14d' },
    { value: 30, label: '30d' },
    { value: 90, label: '90d' },
  ];

  return (
    <div
      className="inline-flex rounded-lg border border-ink-200 bg-ink-50 p-0.5"
      role="group"
      aria-label="Time window"
      data-testid={testId}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={days === opt.value}
          data-testid={`${testId}-${opt.value}`}
          className={`rounded-md px-3 py-1 text-xs font-semibold transition-all duration-[120ms] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-300 ${
            days === opt.value
              ? 'bg-white text-signal-700 shadow-xs'
              : 'text-ink-500 hover:text-ink-800'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

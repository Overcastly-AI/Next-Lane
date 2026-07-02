/**
 * Headline metric card used in analytics pages.
 * `accent` is an optional Tailwind class for the top border colour.
 */
export function StatCard({
  label,
  value,
  accent = 'border-t-signal-400',
  testId,
}: {
  label: string;
  value: string | number;
  accent?: string;
  testId?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-xl border border-ink-200 bg-surface p-4 shadow-card border-t-2 ${accent}`}
      data-testid={testId}
    >
      <span className="text-xs font-medium uppercase tracking-wide text-ink-400">
        {label}
      </span>
      <span className="text-2xl font-bold tabular-nums text-ink-900">
        {value}
      </span>
    </div>
  );
}

/**
 * Skeleton placeholder while stat cards are loading.
 */
export function StatCardSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-ink-200 bg-surface p-4 shadow-card border-t-2 border-t-ink-200">
      <div className="h-3 w-20 animate-pulse rounded bg-ink-100" />
      <div className="h-7 w-12 animate-pulse rounded bg-ink-100" />
    </div>
  );
}

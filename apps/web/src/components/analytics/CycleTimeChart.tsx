import { useMemo } from 'react';
import type { CycleTimeBucketDto } from '@next-lane/shared';

/**
 * Hand-rolled SVG horizontal bar chart for cycle-time bucket distribution.
 * Buckets arrive from the API in order; we render them preserving that order.
 * Matches the VelocityChart / BurndownChart visual style.
 */
export function CycleTimeChart({ buckets }: { buckets: CycleTimeBucketDto[] }) {
  const maxCount = useMemo(
    () => Math.max(1, ...buckets.map((b) => b.count)),
    [buckets],
  );

  const total = useMemo(() => buckets.reduce((s, b) => s + b.count, 0), [buckets]);

  return (
    <div
      className="w-full"
      data-testid="cycle-time-chart"
      role="img"
      aria-label="Cycle-time distribution: number of issues completed per time bucket"
    >
      <span className="sr-only">
        {buckets
          .map((b) => `${b.bucket}: ${b.count} issue${b.count === 1 ? '' : 's'}`)
          .join(', ')}
      </span>
      <div className="space-y-2.5" aria-hidden="true">
        {buckets.map((b) => {
          const pct = total === 0 ? 0 : (b.count / maxCount) * 100;
          return (
            <div key={b.bucket} className="flex items-center gap-3">
              <span className="w-10 shrink-0 text-right text-xs font-medium text-ink-500">
                {b.bucket}
              </span>
              <div className="flex-1 overflow-hidden rounded-full bg-ink-100 h-3">
                <div
                  className="h-3 rounded-full bg-brand-600 transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-left text-xs tabular-nums text-ink-600">
                {b.count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import type { CategoryCountDto } from '@next-lane/shared';

/** Horizontal bar breakdown for a list of (key, count) pairs. */
export function CategoryBars({
  items,
  colorFn,
  labelFn,
  testId,
}: {
  items: CategoryCountDto[];
  /** Return a Tailwind bg-* class or inline hex string for the bar fill. */
  colorFn: (key: string) => string;
  /** Return a human-readable label for the key. */
  labelFn: (key: string) => string;
  testId?: string;
}) {
  const maxCount = Math.max(1, ...items.map((i) => i.count));
  const total = items.reduce((s, i) => s + i.count, 0);

  return (
    <div
      className="space-y-2"
      data-testid={testId}
      role="img"
      aria-label="Category breakdown"
    >
      <span className="sr-only">
        {items.map((i) => `${labelFn(i.key)}: ${i.count}`).join(', ')}
      </span>
      <div className="space-y-2" aria-hidden="true">
        {items.map((item) => {
          const pct = total === 0 ? 0 : (item.count / maxCount) * 100;
          const color = colorFn(item.key);
          // Detect whether color is a Tailwind class or a hex/rgb value
          const isTailwind = !color.startsWith('#') && !color.startsWith('rgb');
          return (
            <div key={item.key} className="flex items-center gap-2.5">
              <span className="w-20 shrink-0 truncate text-right text-xs font-medium text-ink-500">
                {labelFn(item.key)}
              </span>
              <div className="flex-1 overflow-hidden rounded-full bg-ink-100 h-2.5">
                <div
                  className={`h-2.5 rounded-full transition-[width] duration-300 ${isTailwind ? color : ''}`}
                  style={{
                    width: `${pct}%`,
                    ...(isTailwind ? {} : { backgroundColor: color }),
                  }}
                />
              </div>
              <span className="w-6 shrink-0 text-left text-xs tabular-nums text-ink-600">
                {item.count}
              </span>
            </div>
          );
        })}
        {items.length === 0 && (
          <p className="text-xs text-ink-400">No open issues.</p>
        )}
      </div>
    </div>
  );
}

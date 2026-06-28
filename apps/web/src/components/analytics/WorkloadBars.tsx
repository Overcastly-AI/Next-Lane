import type { WorkloadRowDto } from '@next-lane/shared';

/**
 * Horizontal bar list of open issues by assignee. The "Unassigned" row
 * (userId null) is rendered with a neutral treatment.
 */
export function WorkloadBars({ rows }: { rows: WorkloadRowDto[] }) {
  const maxOpen = Math.max(1, ...rows.map((r) => r.open));

  return (
    <div
      className="space-y-2.5"
      data-testid="workload-bars"
      role="img"
      aria-label="Open issues per assignee"
    >
      <span className="sr-only">
        {rows.map((r) => `${r.name}: ${r.open} open`).join(', ')}
      </span>
      <div className="space-y-2.5" aria-hidden="true">
        {rows.map((r) => {
          const pct = (r.open / maxOpen) * 100;
          const isUnassigned = r.userId === null;
          return (
            <div key={r.userId ?? 'unassigned'} className="flex items-center gap-3">
              <span
                className={`w-24 shrink-0 truncate text-right text-xs font-medium ${
                  isUnassigned ? 'italic text-ink-400' : 'text-ink-700'
                }`}
              >
                {r.name}
              </span>
              <div className="flex-1 overflow-hidden rounded-full bg-ink-100 h-3">
                <div
                  className={`h-3 rounded-full transition-[width] duration-300 ${
                    isUnassigned ? 'bg-ink-300' : 'bg-brand-600'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-left text-xs tabular-nums font-semibold text-ink-700">
                {r.open}
              </span>
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="text-xs text-ink-400">No open issues assigned.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Per-visualization gadget renderers. Each takes only the already-evaluated
 * `data` payload for its kind — all filtering/grouping happens server-side
 * (`DashboardsService`), so these stay pure presentation.
 */
import type {
  DashboardBreakdownGadgetData,
  DashboardBurndownGadgetData,
  DashboardStatGadgetData,
  DashboardTableGadgetData,
} from '@next-lane/shared';
import { Badge } from '@/components/ui/Badge';
import { BurndownChart } from '@/components/reports/BurndownChart';
import { EmptyState } from '@/components/ui/States';

const COLUMN_LABELS: Record<string, string> = {
  key: 'Key',
  title: 'Title',
  status: 'Status',
  assignee: 'Assignee',
  points: 'Points',
};

export function StatGadget({ data }: { data: DashboardStatGadgetData }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 py-6 text-center">
      <span className="font-mono text-4xl font-semibold tabular-nums text-ink-900" data-testid="gadget-stat-value">
        {data.count}
      </span>
      <span className="text-xs font-medium text-ink-400">
        {data.count === 1 ? 'issue matches' : 'issues match'}
      </span>
    </div>
  );
}

export function TableGadget({ data }: { data: DashboardTableGadgetData }) {
  if (data.rows.length === 0) {
    return (
      <div className="py-4">
        <EmptyState title="No matching issues" />
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-ink-100 text-[11px] uppercase tracking-wide text-ink-400">
            {data.columns.map((col) => (
              <th key={col} className="px-2 py-1.5 font-semibold">
                {COLUMN_LABELS[col] ?? col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.id} className="border-b border-ink-50 last:border-0">
              {data.columns.map((col) => (
                <td key={col} className="px-2 py-1.5 align-middle text-ink-700">
                  {col === 'key' && <span className="nl-issue-key">{row.key}</span>}
                  {col === 'title' && <span className="line-clamp-1">{row.title}</span>}
                  {col === 'status' && (row.status ? <Badge>{row.status}</Badge> : '—')}
                  {col === 'assignee' && (row.assignee ?? <span className="text-ink-300">Unassigned</span>)}
                  {col === 'points' && (
                    <span className="font-mono tabular-nums">{row.points ?? '—'}</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.truncated && (
        <p className="mt-2 px-2 text-[11px] text-ink-400">
          Showing the first {data.rows.length} matching issues.
        </p>
      )}
    </div>
  );
}

export function BreakdownGadget({ data }: { data: DashboardBreakdownGadgetData }) {
  if (data.buckets.length === 0) {
    return (
      <div className="py-4">
        <EmptyState title="No matching issues" />
      </div>
    );
  }
  const max = Math.max(...data.buckets.map((b) => b.count), 1);
  return (
    <ul className="space-y-2" aria-label={`Breakdown by ${data.field}`}>
      {data.buckets.map((bucket) => (
        <li key={bucket.key} className="flex items-center gap-3">
          <span className="w-24 shrink-0 truncate text-xs font-medium text-ink-600" title={bucket.key}>
            {bucket.key}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full bg-signal-500"
              style={{ width: `${Math.max(4, (bucket.count / max) * 100)}%` }}
            />
          </div>
          <span className="w-6 shrink-0 text-right font-mono text-xs tabular-nums text-ink-700">
            {bucket.count}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function BurndownGadget({ data }: { data: DashboardBurndownGadgetData }) {
  if (data.series.length === 0) {
    return (
      <div className="py-4">
        <EmptyState
          title="No burndown data"
          description={`${data.sprintName} has no dates or story-pointed issues yet.`}
        />
      </div>
    );
  }
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-ink-500">{data.sprintName}</p>
      <BurndownChart series={data.series} totalCommitted={data.totalCommitted} />
    </div>
  );
}

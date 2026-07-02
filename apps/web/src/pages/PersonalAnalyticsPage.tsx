import { useState } from 'react';
import { IssueType, Priority } from '@next-lane/shared';
import { usePersonalAnalytics } from '@/api/analytics';
import { AppHeader } from '@/components/AppHeader';
import { ErrorState, EmptyState } from '@/components/ui/States';
import { WindowSelector } from '@/components/analytics/WindowSelector';
import { StatCard, StatCardSkeleton } from '@/components/analytics/StatCard';
import { ThroughputChart } from '@/components/analytics/ThroughputChart';
import { CategoryBars } from '@/components/analytics/CategoryBars';
import { titleCase } from '@/components/issue/issueMeta';

/**
 * Tailwind bg-* class strings keyed by IssueType.
 * Colors match the IssueTypeIcon hex values mapped to Tailwind equivalents:
 *   STORY  #22c55e → bg-green-500
 *   TASK   #3b82f6 → bg-blue-500   (signal-500)
 *   BUG    #ef4444 → bg-red-500
 *   EPIC   #a855f7 → bg-purple-500
 *   SUBTASK #6b7280 → bg-ink-500
 */
const TYPE_COLOR_CLASSES: Record<string, string> = {
  [IssueType.STORY]: 'bg-green-500',
  [IssueType.TASK]: 'bg-blue-500',
  [IssueType.BUG]: 'bg-red-500',
  [IssueType.EPIC]: 'bg-purple-500',
  [IssueType.SUBTASK]: 'bg-ink-500',
};

/**
 * Tailwind bg-* class strings keyed by Priority.
 * Colors match the PRIORITY_META hex values mapped to Tailwind equivalents:
 *   HIGHEST #dc2626 → bg-red-600
 *   HIGH    #ef4444 → bg-red-500
 *   MEDIUM  #f59e0b → bg-amber-400
 *   LOW     #3b82f6 → bg-blue-500  (signal-500)
 *   LOWEST  #6b7280 → bg-ink-500
 */
const PRIORITY_COLOR_CLASSES: Record<string, string> = {
  [Priority.HIGHEST]: 'bg-red-600',
  [Priority.HIGH]: 'bg-red-500',
  [Priority.MEDIUM]: 'bg-amber-400',
  [Priority.LOW]: 'bg-blue-500',
  [Priority.LOWEST]: 'bg-ink-500',
};

function typeColor(key: string): string {
  return TYPE_COLOR_CLASSES[key] ?? 'bg-ink-500';
}

function priorityColor(key: string): string {
  return PRIORITY_COLOR_CLASSES[key] ?? 'bg-ink-500';
}

export function PersonalAnalyticsPage() {
  const [days, setDays] = useState<number>(30);
  const query = usePersonalAnalytics(days);
  const data = query.data;

  const avgCycleDisplay =
    data?.avgCycleTimeDays == null
      ? '—'
      : `${data.avgCycleTimeDays.toFixed(1)}d`;

  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader />

      {/* Sub-header */}
      <div className="flex items-center justify-between border-b border-ink-100 bg-surface px-4 py-2.5">
        <div>
          <h1 className="font-display text-sm font-bold tracking-[-0.01em] text-ink-900">
            My Analytics
          </h1>
          <p className="text-xs text-ink-400">
            Your personal delivery metrics across all projects.
          </p>
        </div>
        <WindowSelector
          days={days}
          onChange={setDays}
          testId="personal-analytics-window"
        />
      </div>

      <main
        className="flex-1 overflow-y-auto bg-ink-50"
        data-testid="personal-analytics"
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">

          {/* Error */}
          {query.isError && !query.isLoading && (
            <ErrorState
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          )}

          {/* Stat cards */}
          <section aria-labelledby="personal-stats-heading">
            <h2 id="personal-stats-heading" className="sr-only">
              Summary metrics
            </h2>
            <div
              className="grid grid-cols-2 gap-3 sm:grid-cols-4"
              data-testid="personal-stat-cards"
            >
              {query.isLoading ? (
                <>
                  <StatCardSkeleton />
                  <StatCardSkeleton />
                  <StatCardSkeleton />
                  <StatCardSkeleton />
                </>
              ) : (
                <>
                  <StatCard
                    label="Open"
                    value={data?.assigned.open ?? 0}
                    accent="border-t-signal-400"
                    testId="stat-open"
                  />
                  <StatCard
                    label={`Completed (${days}d)`}
                    value={data?.assigned.completed ?? 0}
                    accent="border-t-brand-500"
                    testId="stat-completed"
                  />
                  <StatCard
                    label="Overdue"
                    value={data?.assigned.overdue ?? 0}
                    accent="border-t-red-400"
                    testId="stat-overdue"
                  />
                  <StatCard
                    label="Avg cycle time"
                    value={avgCycleDisplay}
                    accent="border-t-amber-400"
                    testId="stat-cycle-time"
                  />
                </>
              )}
            </div>
          </section>

          {/* Throughput chart */}
          <section
            className="rounded-xl border border-ink-200 bg-surface p-4 shadow-card sm:p-5"
            aria-labelledby="throughput-heading"
          >
            <div className="mb-3">
              <h2
                id="throughput-heading"
                className="text-sm font-semibold text-ink-900"
              >
                Throughput
              </h2>
              <p className="text-xs text-ink-500">
                Issues completed (and created) each day over the window.
              </p>
            </div>

            {query.isLoading ? (
              <div className="h-40 w-full animate-pulse rounded-lg bg-ink-100" />
            ) : !data || data.throughput.length === 0 ? (
              <EmptyState
                title="No completed work in this window yet."
                description="Finish some issues to see throughput here."
              />
            ) : (
              <ThroughputChart series={data.throughput} />
            )}
          </section>

          {/* Breakdowns */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* By type */}
            <section
              className="rounded-xl border border-ink-200 bg-surface p-4 shadow-card sm:p-5"
              aria-labelledby="bytype-heading"
            >
              <h2
                id="bytype-heading"
                className="mb-3 text-sm font-semibold text-ink-900"
              >
                Open issues by type
              </h2>
              {query.isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-5 animate-pulse rounded bg-ink-100"
                    />
                  ))}
                </div>
              ) : !data || data.byType.length === 0 ? (
                <EmptyState
                  title="No open issues."
                  description="You have no open issues assigned right now."
                />
              ) : (
                <CategoryBars
                  items={data.byType}
                  colorFn={typeColor}
                  labelFn={(k) => titleCase(k)}
                  testId="by-type-bars"
                />
              )}
            </section>

            {/* By priority */}
            <section
              className="rounded-xl border border-ink-200 bg-surface p-4 shadow-card sm:p-5"
              aria-labelledby="bypriority-heading"
            >
              <h2
                id="bypriority-heading"
                className="mb-3 text-sm font-semibold text-ink-900"
              >
                Open issues by priority
              </h2>
              {query.isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-5 animate-pulse rounded bg-ink-100"
                    />
                  ))}
                </div>
              ) : !data || data.byPriority.length === 0 ? (
                <EmptyState
                  title="No open issues."
                  description="You have no open issues assigned right now."
                />
              ) : (
                <CategoryBars
                  items={data.byPriority}
                  colorFn={priorityColor}
                  labelFn={(k) => titleCase(k)}
                  testId="by-priority-bars"
                />
              )}
            </section>
          </div>

          {/* Personal board mini-stats */}
          <section
            className="rounded-xl border border-ink-200 bg-surface p-4 shadow-card sm:p-5"
            aria-labelledby="board-stats-heading"
            data-testid="personal-board-stats"
          >
            <div className="mb-3">
              <h2
                id="board-stats-heading"
                className="text-sm font-semibold text-ink-900"
              >
                Personal board
              </h2>
              <p className="text-xs text-ink-500">
                Stats for your private kanban board.
              </p>
            </div>
            {query.isLoading ? (
              <div className="grid grid-cols-3 gap-3">
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
              </div>
            ) : data ? (
              <div className="grid grid-cols-3 gap-3">
                <StatCard
                  label="Total cards"
                  value={data.personalBoard.totalCards}
                  accent="border-t-ink-300"
                  testId="board-stat-total"
                />
                <StatCard
                  label="Promoted"
                  value={data.personalBoard.promoted}
                  accent="border-t-emerald-400"
                  testId="board-stat-promoted"
                />
                <StatCard
                  label={`Created (${days}d)`}
                  value={data.personalBoard.createdInWindow}
                  accent="border-t-signal-400"
                  testId="board-stat-created"
                />
              </div>
            ) : null}
          </section>
        </div>
      </main>
    </div>
  );
}

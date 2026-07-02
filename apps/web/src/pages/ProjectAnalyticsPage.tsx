import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useBoard } from '@/api/issues';
import { useProjectAnalytics } from '@/api/analytics';
import { AppHeader } from '@/components/AppHeader';
import { ProjectNav } from '@/components/project/ProjectNav';
import { ProjectBreadcrumb } from '@/components/project/ProjectBreadcrumb';
import { ErrorState, EmptyState } from '@/components/ui/States';
import { WindowSelector } from '@/components/analytics/WindowSelector';
import { StatCard, StatCardSkeleton } from '@/components/analytics/StatCard';
import { FlowChart } from '@/components/analytics/FlowChart';
import { CycleTimeChart } from '@/components/analytics/CycleTimeChart';
import { WorkloadBars } from '@/components/analytics/WorkloadBars';

/**
 * Ordered bucket labels exactly as returned by the API.
 * We enforce display order here in case the API returns them differently.
 */
const BUCKET_ORDER = ['<1d', '1–3d', '3–7d', '1–2w', '>2w'];

export function ProjectAnalyticsPage() {
  const { projectId = '' } = useParams();
  const [days, setDays] = useState<number>(30);

  const boardQuery = useBoard(projectId);
  const query = useProjectAnalytics(projectId, days);
  const data = query.data;

  const projectName = boardQuery.data?.project.name;

  const avgCycleDisplay =
    data?.avgCycleTimeDays == null
      ? '—'
      : `${data.avgCycleTimeDays.toFixed(1)}d`;

  // Sort buckets into canonical order; unknown buckets go last.
  const sortedBuckets = data
    ? [...data.cycleTime].sort((a, b) => {
        const ia = BUCKET_ORDER.indexOf(a.bucket);
        const ib = BUCKET_ORDER.indexOf(b.bucket);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      })
    : [];

  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader>
        <ProjectBreadcrumb primary={projectName} />
      </AppHeader>
      <ProjectNav projectId={projectId} />

      <main
        className="flex-1 overflow-y-auto bg-ink-50"
        data-testid="project-analytics"
      >
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
          {/* Page header + window selector */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-ink-900">
                Analytics
              </h1>
              <p className="text-sm text-ink-500">
                Delivery-flow metrics for this project.
              </p>
            </div>
            <WindowSelector
              days={days}
              onChange={setDays}
              testId="project-analytics-window"
            />
          </div>

          {/* Error */}
          {query.isError && !query.isLoading && (
            <ErrorState
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          )}

          {/* Stat cards */}
          <section aria-labelledby="project-stats-heading">
            <h2 id="project-stats-heading" className="sr-only">
              Summary metrics
            </h2>
            <div
              className="grid grid-cols-2 gap-3 sm:grid-cols-3"
              data-testid="project-stat-cards"
            >
              {query.isLoading ? (
                <>
                  <StatCardSkeleton />
                  <StatCardSkeleton />
                  <StatCardSkeleton />
                </>
              ) : (
                <>
                  <StatCard
                    label={`Created (${days}d)`}
                    value={data?.createdTotal ?? 0}
                    accent="border-t-ink-400"
                    testId="project-stat-created"
                  />
                  <StatCard
                    label={`Completed (${days}d)`}
                    value={data?.completedTotal ?? 0}
                    accent="border-t-brand-500"
                    testId="project-stat-completed"
                  />
                  <StatCard
                    label="Avg cycle time"
                    value={avgCycleDisplay}
                    accent="border-t-amber-400"
                    testId="project-stat-cycle-time"
                  />
                </>
              )}
            </div>
          </section>

          {/* Flow chart */}
          <section
            className="rounded-xl border border-ink-200 bg-white p-4 shadow-card sm:p-5"
            aria-labelledby="project-flow-heading"
          >
            <div className="mb-3">
              <h2
                id="project-flow-heading"
                className="text-sm font-semibold text-ink-900"
              >
                Flow
              </h2>
              <p className="text-xs text-ink-500">
                Issues created vs completed per day over the window.
              </p>
            </div>

            {query.isLoading ? (
              <div className="h-44 w-full animate-pulse rounded-lg bg-ink-100" />
            ) : !data || data.flow.every((p) => p.created === 0 && p.completed === 0) ? (
              <EmptyState
                title="No activity in this window yet."
                description="Issues need to be created or completed for flow data to appear."
              />
            ) : (
              <FlowChart series={data.flow} />
            )}
          </section>

          {/* Cycle-time distribution + workload side-by-side on wider screens */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Cycle-time distribution */}
            <section
              className="rounded-xl border border-ink-200 bg-white p-4 shadow-card sm:p-5"
              aria-labelledby="cycle-dist-heading"
            >
              <div className="mb-3">
                <h2
                  id="cycle-dist-heading"
                  className="text-sm font-semibold text-ink-900"
                >
                  Cycle-time distribution
                </h2>
                <p className="text-xs text-ink-500">
                  How long issues took from creation to done.
                </p>
              </div>

              {query.isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="h-5 animate-pulse rounded bg-ink-100"
                    />
                  ))}
                </div>
              ) : sortedBuckets.length === 0 ||
                sortedBuckets.every((b) => b.count === 0) ? (
                <EmptyState
                  title="No completed work in this window yet."
                  description="Finish some issues to see cycle-time distribution."
                />
              ) : (
                <CycleTimeChart buckets={sortedBuckets} />
              )}
            </section>

            {/* Workload by assignee */}
            <section
              className="rounded-xl border border-ink-200 bg-white p-4 shadow-card sm:p-5"
              aria-labelledby="workload-heading"
            >
              <div className="mb-3">
                <h2
                  id="workload-heading"
                  className="text-sm font-semibold text-ink-900"
                >
                  Open workload
                </h2>
                <p className="text-xs text-ink-500">
                  Open issues per team member, busiest first.
                </p>
              </div>

              {query.isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-5 animate-pulse rounded bg-ink-100"
                    />
                  ))}
                </div>
              ) : !data || data.workload.length === 0 ? (
                <EmptyState
                  title="No open issues."
                  description="There are no open issues in this project right now."
                />
              ) : (
                <WorkloadBars rows={data.workload} />
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

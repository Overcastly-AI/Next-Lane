import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { SprintState, type SprintDto } from '@next-lane/shared';
import { useBoard } from '@/api/issues';
import { useSprints } from '@/api/meta';
import { useVelocity, useBurndown, useCfd } from '@/api/reports';
import { AppHeader } from '@/components/AppHeader';
import { ProjectNav } from '@/components/project/ProjectNav';
import { Select } from '@/components/ui/Select';
import { ErrorState, LoadingState, EmptyState, Spinner } from '@/components/ui/States';
import { VelocityChart } from '@/components/reports/VelocityChart';
import { BurndownChart } from '@/components/reports/BurndownChart';
import { CumulativeFlowChart } from '@/components/reports/CumulativeFlowChart';

export function ReportsPage() {
  const { projectId = '' } = useParams();
  const boardQuery = useBoard(projectId);
  const sprintsQuery = useSprints(projectId);
  const velocityQuery = useVelocity(projectId);

  const sprints = useMemo<SprintDto[]>(
    () => sprintsQuery.data ?? [],
    [sprintsQuery.data],
  );

  // Default the burndown to the active sprint, else the most recent sprint.
  const [selectedSprintId, setSelectedSprintId] = useState<string>('');
  useEffect(() => {
    if (selectedSprintId || sprints.length === 0) return;
    const active = sprints.find((s) => s.state === SprintState.ACTIVE);
    setSelectedSprintId(active?.id ?? sprints[sprints.length - 1].id);
  }, [sprints, selectedSprintId]);

  const burndownQuery = useBurndown(projectId, selectedSprintId || undefined);

  // CFD window selector: 14, 30, or 90 days.
  const [cfdDays, setCfdDays] = useState<number>(30);
  const cfdQuery = useCfd(projectId, cfdDays);

  const projectName = boardQuery.data?.project.name;
  const velocity = velocityQuery.data ?? [];
  const burndown = burndownQuery.data;

  return (
    <Shell projectId={projectId} projectName={projectName}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Reports</h1>
          <p className="text-sm text-slate-500">
            Sprint velocity, burndown, and cumulative flow for this project.
          </p>
        </div>

        {/* Velocity */}
        <section
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5"
          aria-labelledby="velocity-heading"
        >
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2
                id="velocity-heading"
                className="text-sm font-semibold text-slate-900"
              >
                Velocity
              </h2>
              <p className="text-xs text-slate-500">
                Committed vs completed story points per sprint.
              </p>
            </div>
            {velocityQuery.isFetching && <Spinner className="h-4 w-4" />}
          </div>

          {velocityQuery.isLoading ? (
            <LoadingState label="Loading velocity…" />
          ) : velocityQuery.isError ? (
            <ErrorState
              error={velocityQuery.error}
              onRetry={() => velocityQuery.refetch()}
            />
          ) : velocity.length === 0 ? (
            <EmptyState
              title="No completed sprints yet"
              description="Start and complete a sprint to see velocity here."
            />
          ) : (
            <VelocityChart data={velocity} />
          )}
        </section>

        {/* Burndown */}
        <section
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5"
          aria-labelledby="burndown-heading"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2
                id="burndown-heading"
                className="text-sm font-semibold text-slate-900"
              >
                Burndown
              </h2>
              <p className="text-xs text-slate-500">
                Remaining story points over the sprint, vs the ideal pace.
              </p>
            </div>
            {sprints.length > 0 && (
              <div className="w-48 shrink-0">
                <label htmlFor="burndown-sprint" className="sr-only">
                  Sprint
                </label>
                <Select
                  id="burndown-sprint"
                  value={selectedSprintId}
                  onChange={(e) => setSelectedSprintId(e.target.value)}
                >
                  {sprints.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.state === SprintState.ACTIVE ? ' (active)' : ''}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          {sprintsQuery.isLoading ? (
            <LoadingState label="Loading sprints…" />
          ) : sprints.length === 0 ? (
            <EmptyState
              title="No sprints yet"
              description="Create a sprint in the Backlog to track its burndown."
            />
          ) : burndownQuery.isLoading ? (
            <LoadingState label="Loading burndown…" />
          ) : burndownQuery.isError ? (
            <ErrorState
              error={burndownQuery.error}
              onRetry={() => burndownQuery.refetch()}
            />
          ) : burndown && burndown.series.length > 0 ? (
            <BurndownChart
              series={burndown.series}
              totalCommitted={burndown.totalCommitted}
            />
          ) : (
            <EmptyState
              title="No burndown data"
              description="This sprint has no dates or story-pointed issues yet."
            />
          )}
        </section>

        {/* Cumulative Flow Diagram */}
        <section
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5"
          aria-labelledby="cfd-heading"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2
                id="cfd-heading"
                className="text-sm font-semibold text-slate-900"
              >
                Cumulative Flow
              </h2>
              <p className="text-xs text-slate-500">
                Issue counts per status category over time, stacked by area.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {cfdQuery.isFetching && <Spinner className="h-4 w-4" />}
              <div className="w-28 shrink-0">
                <label htmlFor="cfd-days" className="sr-only">
                  Time window
                </label>
                <Select
                  id="cfd-days"
                  value={String(cfdDays)}
                  onChange={(e) => setCfdDays(Number(e.target.value))}
                >
                  <option value="14">Last 14 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                </Select>
              </div>
            </div>
          </div>

          {cfdQuery.isLoading ? (
            <LoadingState label="Loading cumulative flow…" />
          ) : cfdQuery.isError ? (
            <ErrorState
              error={cfdQuery.error}
              onRetry={() => cfdQuery.refetch()}
            />
          ) : cfdQuery.data && cfdQuery.data.series.length > 0 &&
            cfdQuery.data.series.some(
              (p) => p.todo + p.inProgress + p.done > 0,
            ) ? (
            <CumulativeFlowChart series={cfdQuery.data.series} />
          ) : (
            <EmptyState
              title="No issues yet"
              description="Create issues in this project to see the cumulative flow."
            />
          )}
        </section>
      </div>
    </Shell>
  );
}

function Shell({
  children,
  projectId,
  projectName,
}: {
  children: React.ReactNode;
  projectId: string;
  projectName?: string;
}) {
  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader>
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="text-sm text-slate-400 hover:text-slate-600"
            aria-label="Back to projects"
          >
            Projects
          </Link>
          <span className="text-slate-300">/</span>
          <span className="truncate text-sm font-semibold text-slate-900">
            {projectName ?? 'Project'}
          </span>
        </div>
      </AppHeader>
      <ProjectNav projectId={projectId} />
      <main className="flex-1 overflow-y-auto bg-slate-50">{children}</main>
    </div>
  );
}

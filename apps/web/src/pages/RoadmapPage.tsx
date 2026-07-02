import { useParams, Link, useNavigate } from 'react-router-dom';
import { useBoard } from '@/api/issues';
import { useRoadmap } from '@/api/roadmap';
import { AppHeader } from '@/components/AppHeader';
import { ProjectNav } from '@/components/project/ProjectNav';
import {
  ErrorState,
  LoadingState,
  EmptyState,
  Spinner,
} from '@/components/ui/States';
import { RoadmapTimeline } from '@/components/roadmap/RoadmapTimeline';

/**
 * Stakeholder-facing roadmap: epics and sprints laid out across a shared time
 * axis. Read-only (VIEWERs can view). Clicking an epic opens it on the board via
 * the ?issue= drawer. Data is composed server-side by GET /projects/:id/roadmap.
 */
export function RoadmapPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const boardQuery = useBoard(projectId);
  const roadmapQuery = useRoadmap(projectId);

  const projectName = boardQuery.data?.project.name;
  const data = roadmapQuery.data;
  const isEmpty =
    !!data && data.epics.length === 0 && data.sprints.length === 0;

  function openEpic(epicId: string) {
    navigate(`/projects/${projectId}/board?issue=${epicId}`);
  }

  return (
    <Shell projectId={projectId} projectName={projectName}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-ink-900">Roadmap</h1>
            <p className="text-sm text-ink-500">
              Epics and sprints across time. Click an epic to open it.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data?.epicsTruncated && (
              <span
                data-testid="roadmap-truncated-hint"
                className="inline-flex items-center rounded-md bg-amber-50 border border-amber-200 px-2 py-1 text-xs font-medium text-amber-700"
                title="This roadmap has more than 500 epics. Showing the first 500."
              >
                Showing first 500 epics
              </span>
            )}
            {roadmapQuery.isFetching && <Spinner className="h-4 w-4" />}
          </div>
        </div>

        <section
          className="rounded-xl border border-ink-200 bg-white p-4 shadow-card sm:p-5"
          aria-label="Roadmap timeline"
        >
          {roadmapQuery.isLoading ? (
            <LoadingState label="Loading roadmap…" />
          ) : roadmapQuery.isError ? (
            <ErrorState
              error={roadmapQuery.error}
              onRetry={() => roadmapQuery.refetch()}
            />
          ) : isEmpty ? (
            <EmptyState
              title="No epics or sprints yet"
              description="Create an epic or sprint to see the roadmap."
            />
          ) : data ? (
            <RoadmapTimeline data={data} onOpenEpic={openEpic} />
          ) : null}
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
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <Link
            to="/"
            className="shrink-0 text-sm text-ink-400 hover:text-ink-600 transition-colors duration-[120ms]"
            aria-label="Back to projects"
          >
            Projects
          </Link>
          <span className="shrink-0 text-ink-300">/</span>
          <span className="min-w-0 truncate text-sm font-semibold text-ink-900">
            {projectName ?? 'Project'}
          </span>
        </div>
      </AppHeader>
      <ProjectNav projectId={projectId} />
      <main className="flex-1 overflow-y-auto bg-ink-50">{children}</main>
    </div>
  );
}

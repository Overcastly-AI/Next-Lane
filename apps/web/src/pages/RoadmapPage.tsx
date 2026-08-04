import { useParams, useNavigate } from 'react-router-dom';
import { useBoard } from '@/api/issues';
import { useRoadmap, useScheduleIssue } from '@/api/roadmap';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { useMyRole } from '@/api/workspaces';
import { canEdit } from '@/lib/permissions';
import { AppHeader } from '@/components/AppHeader';
import { ProjectNav } from '@/components/project/ProjectNav';
import { ProjectBreadcrumb } from '@/components/project/ProjectBreadcrumb';
import {
  ErrorState,
  LoadingState,
  EmptyState,
  Spinner,
} from '@/components/ui/States';
import { RoadmapTimeline } from '@/components/roadmap/RoadmapTimeline';

/**
 * Stakeholder-facing roadmap: a Gantt of epics, their stories, sprints and
 * release milestones on a shared time axis.
 *
 * Editable in place for anyone above VIEWER — dragging a bar writes the
 * issue's own start/due dates through `PATCH /issues/:id`. VIEWERs get the
 * identical chart with no drag affordances at all, rather than affordances
 * that fail on drop.
 *
 * Clicking an epic opens it on the board via the ?issue= drawer. Data is
 * composed server-side by GET /projects/:id/roadmap.
 */
export function RoadmapPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const boardQuery = useBoard(projectId);
  const roadmapQuery = useRoadmap(projectId);
  const toast = useToast();
  const myRole = useMyRole(boardQuery.data?.project.workspaceId);
  const editable = canEdit(myRole);
  const schedule = useScheduleIssue(projectId);

  const projectName = boardQuery.data?.project.name;
  const data = roadmapQuery.data;
  const isEmpty =
    !!data && data.epics.length === 0 && data.sprints.length === 0;

  function openEpic(epicId: string) {
    navigate(`/projects/${projectId}/board?issue=${epicId}`);
  }

  function onSchedule(input: {
    issueId: string;
    startDate: string;
    dueDate: string;
    parentEpicId?: string;
  }) {
    schedule.mutate(input, {
      onError: (err) =>
        // The chart refetches on settle either way, so a rejected write
        // snaps the bar back to the truth rather than leaving a lie on screen.
        toast.error(errorMessage(err, 'Could not reschedule that item.')),
    });
  }

  return (
    <Shell projectId={projectId} projectName={projectName}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-ink-900">Roadmap</h1>
            <p className="text-sm text-ink-500">
              Epics, stories, sprints and releases across time.{' '}
              {editable
                ? 'Drag a bar to reschedule it; expand an epic to see its stories.'
                : 'Expand an epic to see its stories.'}
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
          className="rounded-xl border border-ink-200 bg-surface p-4 shadow-card sm:p-5"
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
            <RoadmapTimeline
              data={data}
              projectId={projectId}
              onOpenEpic={openEpic}
              onSchedule={editable ? onSchedule : undefined}
              isSaving={schedule.isPending}
            />
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
        <ProjectBreadcrumb primary={projectName} />
      </AppHeader>
      <ProjectNav projectId={projectId} />
      <main className="flex-1 overflow-y-auto bg-ink-50">{children}</main>
    </div>
  );
}

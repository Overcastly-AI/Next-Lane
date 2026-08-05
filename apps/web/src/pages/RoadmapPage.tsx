import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { StatusDto } from '@next-lane/shared';
import { useUsers } from '@/api/meta';
import { IssueDetailDrawer } from '@/components/issue/IssueDetailDrawer';
import { useBoard, useCreateIssue } from '@/api/issues';
import { IssueType, Priority } from '@next-lane/shared';
import {
  useLinkEpics,
  useRoadmap,
  useScheduleIssue,
  useUnlinkEpics,
} from '@/api/roadmap';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { useMyRole } from '@/api/workspaces';
import { useBoardRealtime } from '@/api/socket';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const boardQuery = useBoard(projectId);
  const usersQuery = useUsers();
  const roadmapQuery = useRoadmap(projectId);
  const toast = useToast();
  const myRole = useMyRole(boardQuery.data?.project.workspaceId);
  const editable = canEdit(myRole);
  const schedule = useScheduleIssue(projectId);
  /*
   * Realtime. Without this the chart only ever refreshed on your own writes:
   * a teammate rescheduling an epic, or you editing the same issue in another
   * tab, left this Gantt showing yesterday's plan until a reload.
   */
  useBoardRealtime(projectId);

  const linkEpics = useLinkEpics(projectId);
  const unlinkEpics = useUnlinkEpics(projectId);
  const createIssue = useCreateIssue(projectId);
  const queryClient = useQueryClient();

  const projectName = boardQuery.data?.project.name;
  const data = roadmapQuery.data;
  const isEmpty =
    !!data && data.epics.length === 0 && data.sprints.length === 0;

  /*
   * Open the issue IN PLACE rather than navigating to the board.
   *
   * This used to jump to `/board?issue=…`, which threw you off the roadmap
   * entirely: you clicked a bar to check a date and landed on a kanban board,
   * having lost your zoom level and every epic you had expanded. Reported by
   * the founder as "why does the page change if I click into an epic?" — the
   * honest answer was that the roadmap shipped before the drawer was
   * reusable, and nobody revisited it.
   *
   * `?issue=` on this route, same as the board uses, so the URL is still
   * shareable and the back button still closes the drawer.
   */
  const openIssueId = searchParams.get('issue');

  function openEpic(epicId: string) {
    const next = new URLSearchParams(searchParams);
    next.set('issue', epicId);
    setSearchParams(next, { replace: false });
  }

  function closeIssue() {
    const next = new URLSearchParams(searchParams);
    next.delete('issue');
    setSearchParams(next, { replace: false });
  }

  const statuses = useMemo<StatusDto[]>(
    () =>
      boardQuery.data
        ? [...boardQuery.data.statuses].sort((a, b) => a.order - b.order)
        : [],
    [boardQuery.data],
  );

  function onSchedule(input: {
    issueId: string;
    startDate: string;
    dueDate: string;
    parentEpicId?: string;
    newParentEpicId?: string;
  }) {
    schedule.mutate(input, {
      onError: (err) =>
        // The chart refetches on settle either way, so a rejected write
        // snaps the bar back to the truth rather than leaving a lie on screen.
        toast.error(errorMessage(err, 'Could not reschedule that item.')),
    });
  }

  /*
   * Dependencies, drawn by dragging between two bars.
   *
   * The server owns every rule (self-link, duplicate, reverse-duplicate,
   * cross-project, MEMBER+), so the failure path here is to say what it said.
   * A silent no-op would be worse than the old "go open the epic": you would
   * have made the gesture, seen no arrow, and had nothing to explain it.
   */
  function onLink(input: { fromEpicId: string; toEpicId: string }) {
    linkEpics.mutate(input, {
      onError: (err) =>
        toast.error(errorMessage(err, 'Could not add that dependency.')),
    });
  }

  function onUnlink(input: {
    linkId: string;
    fromEpicId: string;
    toEpicId: string;
  }) {
    unlinkEpics.mutate(input, {
      onError: (err) =>
        toast.error(errorMessage(err, 'Could not remove that dependency.')),
    });
  }

  /*
   * Create an epic, or a story under one, without leaving the chart. Title
   * only — you place it by dragging, which is the whole reason to be here.
   * A new story lands undated on purpose: its epic's row then shows an empty
   * scheduling lane you can paint a window onto.
   */
  async function onCreate(input: { title: string; parentEpicId?: string }) {
    await createIssue.mutateAsync({
      projectId,
      title: input.title,
      type: input.parentEpicId ? IssueType.STORY : IssueType.EPIC,
      priority: Priority.MEDIUM,
      ...(input.parentEpicId ? { parentId: input.parentEpicId } : {}),
    });
    await queryClient.invalidateQueries({ queryKey: ['roadmap', projectId] });
    if (input.parentEpicId) {
      await queryClient.invalidateQueries({
        queryKey: ['roadmap-epic-children', projectId, input.parentEpicId],
      });
    }
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
            {/* Presenting is a mode, not a page, so the way in belongs beside
                the chart rather than in the project nav. */}
            <Link
              to={`/projects/${projectId}/roadmap/present`}
              data-testid="roadmap-present-link"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-ink-200 bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-600 shadow-xs hover:bg-ink-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 5h18v11H3z" />
                <path d="M12 16v4M8 20h8" />
              </svg>
              Present
            </Link>
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
              onCreate={editable ? onCreate : undefined}
              onLink={editable ? onLink : undefined}
              onUnlink={editable ? onUnlink : undefined}
              isSaving={schedule.isPending || linkEpics.isPending || unlinkEpics.isPending}
            />
          ) : null}
        </section>
      </div>

      {openIssueId && (
        <IssueDetailDrawer
          issueId={openIssueId}
          projectId={projectId}
          statuses={statuses}
          users={usersQuery.data ?? []}
          editable={editable}
          viewerRole={myRole ?? undefined}
          onClose={closeIssue}
          onOpenIssue={openEpic}
        />
      )}
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

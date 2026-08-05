import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useUsers } from '@/api/meta';
import { useBoard } from '@/api/issues';
import { useRoadmap } from '@/api/roadmap';
import { IssueDetailDrawer } from '@/components/issue/IssueDetailDrawer';
import { RoadmapTimeline } from '@/components/roadmap/RoadmapTimeline';
import { ErrorState, LoadingState, EmptyState } from '@/components/ui/States';
import type { StatusDto } from '@next-lane/shared';

/**
 * The roadmap, presented.
 *
 * One job: put the plan on a screen in a room and get everything else out of
 * the way. Sidebar, app header, project nav, page title and the card the chart
 * normally sits in are all gone — a card with a border and a drop shadow reads
 * as a document on a page, and full-bleed should read as one surface.
 *
 * Deliberately NOT here, all four declined when scoped: a health-summary strip,
 * a release countdown header, scaled-up type, and a pre-flight epic filter. The
 * founder presents this live with a mouse and dives into what's needed — extra
 * furniture would be something to talk around rather than something to talk
 * with. The restraint is the design.
 *
 * Read-only by construction, not by a flag: no `onSchedule`, `onCreate`,
 * `onLink` or `onUnlink` is passed, and the chart already renders every
 * mutation affordance off when they're absent. A stray click during a
 * presentation cannot change the plan.
 */
export function RoadmapPresentPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const boardQuery = useBoard(projectId);
  const usersQuery = useUsers();
  const roadmapQuery = useRoadmap(projectId);
  const openIssueId = searchParams.get('issue');

  const exit = useCallback(() => {
    navigate(`/projects/${projectId}/roadmap`);
  }, [navigate, projectId]);

  /*
   * Escape leaves — but only once there's nothing else for it to close.
   * Opening an epic to answer a question is the main thing you do while
   * presenting, and Escape closing the drawer AND dropping you out of the
   * presentation in one press would be a small disaster in front of a room.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !openIssueId) exit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exit, openIssueId]);

  /*
   * The signature, and the only thing here that isn't the chart: the exit
   * control recedes.
   *
   * You talk for thirty seconds at a time without touching the mouse, and for
   * those thirty seconds a button floating over the plan is just noise. It
   * fades out when the pointer goes still and comes straight back when it
   * moves — the video-player convention, which is conventional because it is
   * right for exactly this job.
   *
   * Never auto-hidden under `prefers-reduced-motion`, and never while it holds
   * focus: a keyboard user cannot move a pointer to bring back the control
   * they are currently on.
   */
  const [chromeVisible, setChromeVisible] = useState(true);
  const idleTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const reduced = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    )?.matches;
    if (reduced) return;
    const wake = () => {
      setChromeVisible(true);
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => {
        const bar = document.getElementById('roadmap-present-chrome');
        if (bar?.contains(document.activeElement)) return;
        setChromeVisible(false);
      }, 2500);
    };
    wake();
    window.addEventListener('pointermove', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.clearTimeout(idleTimer.current);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  function openEpic(epicId: string) {
    const next = new URLSearchParams(searchParams);
    next.set('issue', epicId);
    setSearchParams(next, { replace: true });
  }

  function closeIssue() {
    const next = new URLSearchParams(searchParams);
    next.delete('issue');
    setSearchParams(next, { replace: true });
  }

  const statuses: StatusDto[] = boardQuery.data
    ? [...boardQuery.data.statuses].sort((a, b) => a.order - b.order)
    : [];
  const data = roadmapQuery.data;
  const projectName = boardQuery.data?.project.name;
  const empty =
    data && data.epics.length === 0 && data.sprints.length === 0;

  return (
    <div
      className="flex h-[100dvh] w-full flex-col overflow-hidden bg-canvas"
      data-testid="roadmap-present"
    >
      {/*
       * The chart carries its own toolbar — zoom, weekends, Today, legend —
       * and in read-only mode that is already exactly a presenter's control
       * set, so there is no second toolbar here. This strip is identity only:
       * which project's plan is on the screen.
       */}
      <div
        id="roadmap-present-chrome"
        className={[
          'flex shrink-0 items-baseline gap-3 px-5 pt-4 pb-2 transition-opacity duration-500',
          chromeVisible ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
      >
        <h1 className="truncate text-base font-semibold text-ink-900">
          {projectName ?? 'Roadmap'}
        </h1>
        <span className="text-xs uppercase tracking-[0.14em] text-ink-400">
          Roadmap
        </span>
        <button
          type="button"
          onClick={exit}
          data-testid="roadmap-present-exit"
          className="ml-auto shrink-0 rounded-md border border-ink-200 bg-surface px-2.5 py-1 text-xs font-medium text-ink-600 shadow-xs hover:bg-ink-100 hover:text-ink-900 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-signal-400"
        >
          Stop presenting
          <kbd className="ml-2 rounded border border-ink-200 px-1 font-sans text-[10px] text-ink-400">
            Esc
          </kbd>
        </button>
      </div>

      {/*
       * The chart owns the rest of the viewport.
       *
       * It is CENTRED in the frame rather than stretched to fill it. Rows keep
       * their natural height because row geometry is what the dependency
       * overlay measures its arrow offsets from — stretching rows would bend
       * every arrow — and a five-epic plan pinned to the top of a 900px screen
       * with half the frame empty below it reads as an unfinished layout
       * rather than a composed one.
       *
       * `min-h-full` on the inner column is what makes this safe once the plan
       * is taller than the frame: the column grows to its content, so
       * `justify-center` stops applying and nothing is clipped off the top —
       * which is exactly what plain vertical centring inside a scroll
       * container gets wrong.
       */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <div className="flex min-h-full flex-col justify-center">
        {roadmapQuery.isLoading ? (
          <LoadingState label="Loading roadmap…" />
        ) : roadmapQuery.isError ? (
          <ErrorState
            error={roadmapQuery.error}
            onRetry={() => roadmapQuery.refetch()}
          />
        ) : empty ? (
          <EmptyState
            title="Nothing to present yet"
            description="This project has no epics or sprints with dates."
          />
        ) : data ? (
          <RoadmapTimeline
            data={data}
            projectId={projectId}
            onOpenEpic={openEpic}
          />
        ) : null}
        </div>
      </div>

      {openIssueId && (
        <IssueDetailDrawer
          issueId={openIssueId}
          projectId={projectId}
          statuses={statuses}
          users={usersQuery.data ?? []}
          // Read-only here too. Presenting is for showing the plan, and the
          // way to change it is to stop presenting — which is one key away.
          editable={false}
          onClose={closeIssue}
          onOpenIssue={openEpic}
        />
      )}
    </div>
  );
}

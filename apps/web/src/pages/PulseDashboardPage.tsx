/**
 * Team Pulse Dashboard — the morning-standup home view for logged-in users.
 *
 * Sections (all assembled client-side from existing hooks; zero new endpoints):
 *  1. Sprint snapshot — active sprint(s) per project: name, end-date countdown,
 *     done/total progress bar. Reuses the board's ActiveSprintBadge color logic.
 *  2. Issues awaiting you — issues assigned to the current user (from useMyWork).
 *  3. Recent activity — latest notifications as a compact feed (useNotifications).
 *  4. Projects — the existing project cards grid so users can still navigate.
 *
 * First-run: if the user has no projects the OnboardingPanel is shown instead
 * (preserving the existing onboarding flow).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Role,
  SprintState,
  StatusCategory,
  type MyWorkIssueDto,
  type NotificationDto,
  type ProjectDto,
  type SprintDto,
} from '@next-lane/shared';
import { AppHeader } from '@/components/AppHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { IssueTypeIcon } from '@/components/issue/issueMeta';
import { ProjectCard } from '@/components/project/ProjectCard';
import { OnboardingPanel } from '@/components/project/OnboardingPanel';
import { CreateProjectModal } from '@/components/project/CreateProjectModal';
import { CreateWorkspaceModal } from '@/components/workspace/CreateWorkspaceModal';
import { useWorkspaces, useCreateWorkspace, useMyRole } from '@/api/workspaces';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useProjects } from '@/api/projects';
import { useMyWork } from '@/api/me';
import { useNotifications } from '@/api/notifications';
import { useSprints } from '@/api/meta';
import { useBoard } from '@/api/issues';
import { endDateStatus } from '@/lib/sprintDates';
import { relativeTime } from '@/lib/relativeTime';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function PulseDashboardPage() {
  const navigate = useNavigate();
  const workspacesQuery = useWorkspaces();
  const createWorkspace = useCreateWorkspace();

  // Single source of truth for the active workspace — shared with the header
  // chip and persisted across reloads. No separate local selection state.
  const {
    activeWorkspace,
    setActiveWorkspaceId,
  } = useWorkspaceContext();
  const selectedWs = activeWorkspace?.id ?? null;
  const [creatingDefault, setCreatingDefault] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);

  const workspaces = workspacesQuery.data;

  // Auto-create a default workspace the very first time the user has none.
  useEffect(() => {
    if (
      workspacesQuery.isSuccess &&
      workspaces &&
      workspaces.length === 0 &&
      !creatingDefault &&
      !createWorkspace.isPending
    ) {
      setCreatingDefault(true);
      createWorkspace
        .mutateAsync({ name: 'My Workspace' })
        .catch(() => undefined)
        .finally(() => setCreatingDefault(false));
    }
  }, [workspacesQuery.isSuccess, workspaces, creatingDefault, createWorkspace]);

  // Selection seeding + healing lives in WorkspaceContext (persisted); the
  // dashboard just reflects it.

  const myRole = useMyRole(activeWorkspace?.id);
  const isAdmin = myRole === Role.ADMIN;

  const projectsQuery = useProjects(activeWorkspace?.id);
  const projects = projectsQuery.data ?? [];

  if (workspacesQuery.isLoading) {
    return (
      <Shell>
        <LoadingState label="Loading workspaces…" />
      </Shell>
    );
  }

  if (workspacesQuery.isError) {
    return (
      <Shell>
        <ErrorState
          error={workspacesQuery.error}
          onRetry={() => workspacesQuery.refetch()}
        />
      </Shell>
    );
  }

  if ((workspaces?.length ?? 0) === 0) {
    return (
      <Shell>
        <LoadingState label="Setting up your workspace…" />
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Workspace selector header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <label
            htmlFor="pulse-ws-select"
            className="block text-xs font-medium text-ink-500"
          >
            Workspace
          </label>
          <div className="flex items-center gap-2">
            <select
              id="pulse-ws-select"
              value={selectedWs ?? ''}
              onChange={(e) => setActiveWorkspaceId(e.target.value)}
              className="h-9 w-52 rounded-lg border border-ink-300 bg-surface px-2 text-sm text-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              {workspaces?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setWorkspaceModalOpen(true)}
            >
              + Workspace
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && activeWorkspace && (
            <>
              <Button
                variant="secondary"
                size="md"
                onClick={() => navigate(`/workspaces/${activeWorkspace.id}/members`)}
                data-testid="members-nav-link"
              >
                Members
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={() => navigate(`/workspaces/${activeWorkspace.id}/audit-log`)}
                data-testid="audit-log-nav-link"
              >
                Audit log
              </Button>
            </>
          )}
          <Button onClick={() => setProjectModalOpen(true)}>+ New Project</Button>
        </div>
      </div>

      {projectsQuery.isLoading && <LoadingState label="Loading projects…" />}
      {projectsQuery.isError && (
        <ErrorState
          error={projectsQuery.error}
          onRetry={() => projectsQuery.refetch()}
        />
      )}

      {/* First-run: no projects → onboarding */}
      {projectsQuery.isSuccess && projects.length === 0 && (
        <OnboardingPanel onCreate={() => setProjectModalOpen(true)} />
      )}

      {/* Pulse view: only once there are projects */}
      {projectsQuery.isSuccess && projects.length > 0 && (
        <div data-testid="pulse-dashboard" className="space-y-8">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SprintSnapshotCard projects={projects} />
            <MyIssuesCard
              onOpenIssue={(issue) =>
                navigate(`/projects/${issue.projectId}/board?issue=${issue.id}`)
              }
            />
          </div>

          <RecentActivityCard
            onOpenIssue={(n) => {
              if (n.issueId) {
                navigate(`/projects/${n.projectId}/board?issue=${n.issueId}`);
              }
            }}
          />

          <section aria-labelledby="projects-heading">
            <h2
              id="projects-heading"
              className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500"
            >
              Projects
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  onClick={() => navigate(`/projects/${p.id}/board`)}
                />
              ))}
            </div>
          </section>
        </div>
      )}

      {activeWorkspace && (
        <CreateProjectModal
          open={projectModalOpen}
          onClose={() => setProjectModalOpen(false)}
          workspaceId={activeWorkspace.id}
          onCreated={(p) => {
            setProjectModalOpen(false);
            navigate(`/projects/${p.id}/board`);
          }}
        />
      )}
      <CreateWorkspaceModal
        open={workspaceModalOpen}
        onClose={() => setWorkspaceModalOpen(false)}
        onCreated={(ws) => {
          setWorkspaceModalOpen(false);
          setActiveWorkspaceId(ws.id);
        }}
      />
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-50">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-card',
        className,
      )}
    >
      {children}
    </div>
  );
}

function CardHeader({
  title,
  count,
  action,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-ink-800">{title}</h2>
        {count !== undefined && (
          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-500">
            {count}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sprint snapshot card
// ---------------------------------------------------------------------------

/**
 * SprintSnapshotCard renders one row per project. Each row calls its own
 * useSprints + useBoard so hook counts are stable. Rows with no active sprint
 * return null. A fallback empty message is displayed when every row has loaded
 * and none reported an active sprint.
 */
function SprintSnapshotCard({ projects }: { projects: ProjectDto[] }) {
  // Track settled reports from child rows: { loaded: N, active: N }
  const [counts, setCounts] = useState({ loaded: 0, active: 0 });

  const handleLoaded = useCallback((hasActive: boolean) => {
    setCounts((c) => ({
      loaded: c.loaded + 1,
      active: c.active + (hasActive ? 1 : 0),
    }));
  }, []);

  // Reset counters when the project list changes (workspace switch).
  useEffect(() => {
    setCounts({ loaded: 0, active: 0 });
  }, [projects]);

  const allSettled = counts.loaded === projects.length;

  return (
    <Card>
      <CardHeader title="Active sprints" />
      <div data-testid="sprint-snapshot" className="divide-y divide-ink-50">
        {projects.map((p) => (
          <SprintProjectRow key={p.id} project={p} onSettled={handleLoaded} />
        ))}
        {allSettled && counts.active === 0 && (
          <div className="px-4 py-6 text-center text-sm text-ink-400">
            No active sprints — start one in a project&apos;s Backlog.
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * One sprint row for a single project. Calls `onSettled(hasActive)` once the
 * sprint list has loaded. Renders null when the project has no active sprint.
 */
function SprintProjectRow({
  project,
  onSettled,
}: {
  project: ProjectDto;
  onSettled: (hasActive: boolean) => void;
}) {
  const sprintsQuery = useSprints(project.id);
  const boardQuery = useBoard(project.id);

  const activeSprint = useMemo<SprintDto | null>(
    () =>
      (sprintsQuery.data ?? []).find((s) => s.state === SprintState.ACTIVE) ??
      null,
    [sprintsQuery.data],
  );

  const loading = sprintsQuery.isLoading || boardQuery.isLoading;

  const [signalled, setSignalled] = useState(false);
  useEffect(() => {
    if (!loading && !signalled) {
      setSignalled(true);
      onSettled(activeSprint !== null);
    }
  }, [loading, signalled, activeSprint, onSettled]);

  const { done, total } = useMemo(() => {
    if (!activeSprint || !boardQuery.data) return { done: 0, total: 0 };
    const sprintIssues = boardQuery.data.issues.filter(
      (i) => i.sprintId === activeSprint.id,
    );
    const doneCount = sprintIssues.filter(
      (i) =>
        boardQuery.data!.statuses.find((s) => s.id === i.statusId)
          ?.category === StatusCategory.DONE,
    ).length;
    return { done: doneCount, total: sprintIssues.length };
  }, [activeSprint, boardQuery.data]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 px-4 py-3" aria-busy="true">
        <div className="h-3 w-16 animate-pulse rounded bg-ink-100" />
        <div className="h-3 w-24 animate-pulse rounded bg-ink-100" />
        <div className="ml-auto h-3 w-10 animate-pulse rounded bg-ink-100" />
      </div>
    );
  }

  if (!activeSprint) return null;

  const end = endDateStatus(activeSprint.endDate);
  const toneClass =
    end?.tone === 'overdue'
      ? 'border-red-200 bg-red-50 text-red-700'
      : end?.tone === 'soon'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-green-200 bg-green-50 text-green-700';

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-ink-600">
          {project.key}
        </span>
        <span className="max-w-[180px] truncate text-sm font-medium text-ink-900">
          {activeSprint.name}
        </span>
        {end && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
              toneClass,
            )}
            title={`${activeSprint.name} · ${end.label}`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full bg-current"
              aria-hidden="true"
            />
            {end.label}
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs tabular-nums text-ink-500">
          {done}/{total}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${done} of ${total} issues done in ${activeSprint.name}`}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all',
            pct === 100 ? 'bg-green-500' : 'bg-brand-500',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Assigned to me" card
// ---------------------------------------------------------------------------

const CATEGORY_PILL: Record<StatusCategory, string> = {
  [StatusCategory.TODO]: 'bg-ink-100 text-ink-600',
  [StatusCategory.IN_PROGRESS]: 'bg-blue-100 text-blue-700',
  [StatusCategory.DONE]: 'bg-green-100 text-green-700',
};

function MyIssuesCard({
  onOpenIssue,
}: {
  onOpenIssue: (issue: MyWorkIssueDto) => void;
}) {
  const query = useMyWork();
  const assigned = query.data?.assigned ?? [];
  const preview = assigned.slice(0, 5);
  const overflow = Math.max(0, assigned.length - 5);

  return (
    <Card>
      <CardHeader
        title="Assigned to me"
        count={query.isSuccess ? assigned.length : undefined}
        action={
          <a
            href="/my-work"
            className="text-xs font-medium text-brand-600 hover:text-brand-700"
          >
            View all
          </a>
        }
      />
      <div data-testid="my-issues-section">
        {query.isLoading && (
          <div className="px-4 py-6">
            <LoadingState label="Loading your issues…" />
          </div>
        )}
        {query.isError && (
          <div className="px-4 py-4">
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          </div>
        )}
        {query.isSuccess && assigned.length === 0 && (
          <EmptyState
            title="Nothing assigned to you"
            description="Issues assigned to you across all projects appear here."
          />
        )}
        {query.isSuccess && assigned.length > 0 && (
          <>
            <ul className="divide-y divide-ink-50">
              {preview.map((issue) => (
                <li key={issue.id}>
                  <button
                    type="button"
                    onClick={() => onOpenIssue(issue)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-ink-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400"
                  >
                    <IssueTypeIcon type={issue.type} />
                    <span className="shrink-0 font-mono text-[11px] text-ink-400">
                      {issue.key}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-800">
                      {issue.title}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none',
                        CATEGORY_PILL[issue.statusCategory],
                      )}
                    >
                      {issue.statusName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {overflow > 0 && (
              <div className="border-t border-ink-100 px-4 py-2 text-center">
                <a
                  href="/my-work"
                  className="text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  +{overflow} more — view all
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Recent activity card
// ---------------------------------------------------------------------------

function RecentActivityCard({
  onOpenIssue,
}: {
  onOpenIssue: (n: NotificationDto) => void;
}) {
  const query = useNotifications();
  const items = (query.data?.items ?? []).slice(0, 8);

  return (
    <Card>
      <CardHeader title="Recent activity" />
      <div data-testid="recent-activity-section">
        {query.isLoading && (
          <div className="px-4 py-6">
            <LoadingState label="Loading activity…" />
          </div>
        )}
        {query.isError && (
          <div className="px-4 py-4">
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          </div>
        )}
        {query.isSuccess && items.length === 0 && (
          <EmptyState
            title="No recent activity"
            description="Notifications from issue assignments, comments and mentions appear here."
          />
        )}
        {query.isSuccess && items.length > 0 && (
          <ul className="grid grid-cols-1 divide-y divide-ink-50 sm:grid-cols-2">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onOpenIssue(n)}
                  disabled={!n.issueId}
                  className={cn(
                    'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                    n.issueId
                      ? 'hover:bg-ink-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400'
                      : 'cursor-default',
                    !n.read && 'bg-brand-50/50',
                  )}
                >
                  <Avatar
                    user={n.actor}
                    size="sm"
                    className="mt-0.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink-900">
                      {n.message}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-500">
                      <Badge>{n.issueKey}</Badge>
                      <span aria-hidden="true">·</span>
                      <span>{relativeTime(n.createdAt)}</span>
                    </span>
                  </span>
                  {!n.read && (
                    <span
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500"
                      aria-label="unread"
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

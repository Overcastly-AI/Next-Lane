import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  SprintState,
  StatusCategory,
  type IssueDto,
  type SprintDto,
  type StatusDto,
  type UserDto,
} from '@next-lane/shared';
import {
  useProjectIssues,
  useAssignIssueToSprint,
  useBoard,
} from '@/api/issues';
import { useSprints, useUsers } from '@/api/meta';
import {
  useCreateSprint,
  useUpdateSprint,
  useDeleteSprint,
} from '@/api/sprints';
import { AppHeader } from '@/components/AppHeader';
import { ProjectNav } from '@/components/project/ProjectNav';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { ErrorState, LoadingState, EmptyState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { IssueTypeIcon, PriorityIcon } from '@/components/issue/issueMeta';
import { IssueDetailDrawer } from '@/components/issue/IssueDetailDrawer';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

const BACKLOG = '__backlog__';

export function BacklogPage() {
  const { projectId = '' } = useParams();
  const issuesQuery = useProjectIssues(projectId);
  const sprintsQuery = useSprints(projectId);
  const boardQuery = useBoard(projectId);
  const usersQuery = useUsers();
  const toast = useToast();

  const assign = useAssignIssueToSprint(projectId);
  const updateSprint = useUpdateSprint(projectId);

  const [createOpen, setCreateOpen] = useState(false);
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const [completeTarget, setCompleteTarget] = useState<SprintDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SprintDto | null>(null);

  const issues = issuesQuery.data ?? [];
  const users = usersQuery.data ?? [];
  const board = boardQuery.data;

  // Statuses + which are DONE-category, to compute "incomplete on complete".
  const statuses = useMemo<StatusDto[]>(
    () => (board ? [...board.statuses].sort((a, b) => a.order - b.order) : []),
    [board],
  );
  const doneStatusIds = useMemo(
    () =>
      new Set(
        statuses
          .filter((s) => s.category === StatusCategory.DONE)
          .map((s) => s.id),
      ),
    [statuses],
  );
  const statusById = useMemo(() => {
    const m = new Map<string, StatusDto>();
    for (const s of statuses) m.set(s.id, s);
    return m;
  }, [statuses]);

  // Planning shows PLANNED + ACTIVE sprints (COMPLETED ones are archived).
  const planningSprints = useMemo(
    () =>
      (sprintsQuery.data ?? []).filter(
        (s) => s.state !== SprintState.COMPLETED,
      ),
    [sprintsQuery.data],
  );

  const issuesBySprint = useMemo(() => {
    const map = new Map<string, IssueDto[]>();
    map.set(BACKLOG, []);
    for (const s of planningSprints) map.set(s.id, []);
    for (const issue of issues) {
      const key = issue.sprintId ?? BACKLOG;
      const arr = map.get(key);
      // Issues in a COMPLETED sprint are not shown in the planning view.
      if (arr) arr.push(issue);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    }
    return map;
  }, [issues, planningSprints]);

  const hasActive = planningSprints.some((s) => s.state === SprintState.ACTIVE);

  function moveIssue(issue: IssueDto, sprintId: string | null) {
    if ((issue.sprintId ?? null) === sprintId) return;
    const dest =
      sprintId === null
        ? 'Backlog'
        : (planningSprints.find((s) => s.id === sprintId)?.name ?? 'sprint');
    assign.mutate(
      { id: issue.id, sprintId },
      {
        onSuccess: () => toast.success(`${issue.key} moved to ${dest}.`),
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not move that issue.')),
      },
    );
  }

  function startSprint(sprint: SprintDto) {
    updateSprint.mutate(
      { id: sprint.id, patch: { state: SprintState.ACTIVE } },
      {
        onSuccess: () =>
          toast.success(`${sprint.name} started — it's now on the board.`),
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not start that sprint.')),
      },
    );
  }

  function completeSprint(sprint: SprintDto) {
    updateSprint.mutate(
      { id: sprint.id, patch: { state: SprintState.COMPLETED } },
      {
        onSuccess: () => {
          setCompleteTarget(null);
          toast.success(
            `${sprint.name} completed. Incomplete issues returned to the backlog.`,
          );
        },
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not complete that sprint.')),
      },
    );
  }

  if (issuesQuery.isLoading || sprintsQuery.isLoading) {
    return (
      <Shell projectId={projectId} projectName={board?.project.name}>
        <LoadingState label="Loading backlog…" />
      </Shell>
    );
  }
  if (issuesQuery.isError) {
    return (
      <Shell projectId={projectId} projectName={board?.project.name}>
        <ErrorState
          error={issuesQuery.error ?? new Error('Backlog not found')}
          onRetry={() => issuesQuery.refetch()}
        />
      </Shell>
    );
  }

  const sprintOptions = planningSprints.map((s) => ({
    id: s.id,
    name: s.name,
  }));

  return (
    <Shell projectId={projectId} projectName={board?.project.name}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Backlog</h1>
            <p className="text-sm text-gray-500">
              Plan sprints and order your backlog.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>+ Create sprint</Button>
        </div>

        {planningSprints.map((sprint) => {
          const sprintIssues = issuesBySprint.get(sprint.id) ?? [];
          const incompleteCount = sprintIssues.filter(
            (i) => !doneStatusIds.has(i.statusId),
          ).length;
          return (
            <SprintSection
              key={sprint.id}
              sprint={sprint}
              issues={sprintIssues}
              users={users}
              statusById={statusById}
              sprintOptions={sprintOptions}
              onOpenIssue={setOpenIssueId}
              onMove={moveIssue}
              onStart={() => startSprint(sprint)}
              onComplete={() => setCompleteTarget(sprint)}
              onDelete={() => setDeleteTarget(sprint)}
              startDisabled={
                hasActive && sprint.state === SprintState.PLANNED
              }
              actionPending={updateSprint.isPending}
              incompleteCount={incompleteCount}
            />
          );
        })}

        <Section
          title="Backlog"
          testId="section-backlog"
          count={(issuesBySprint.get(BACKLOG) ?? []).length}
        >
          {(issuesBySprint.get(BACKLOG) ?? []).length === 0 ? (
            <EmptyState
              title="Backlog is empty"
              description="Issues with no sprint will appear here."
            />
          ) : (
            <ul className="divide-y divide-gray-100">
              {(issuesBySprint.get(BACKLOG) ?? []).map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  users={users}
                  status={statusById.get(issue.statusId)}
                  sprintOptions={sprintOptions}
                  currentSprintId={null}
                  onOpen={() => setOpenIssueId(issue.id)}
                  onMove={(sprintId) => moveIssue(issue, sprintId)}
                />
              ))}
            </ul>
          )}
        </Section>
      </div>

      {createOpen && (
        <CreateSprintModal
          projectId={projectId}
          onClose={() => setCreateOpen(false)}
        />
      )}

      <ConfirmDialog
        open={!!completeTarget}
        title={`Complete ${completeTarget?.name ?? 'sprint'}?`}
        message="Issues still not done will be returned to the backlog. This cannot be undone."
        confirmLabel="Complete sprint"
        loading={updateSprint.isPending}
        onConfirm={() => completeTarget && completeSprint(completeTarget)}
        onCancel={() => setCompleteTarget(null)}
      />

      <DeleteSprintDialog
        projectId={projectId}
        sprint={deleteTarget}
        onClose={() => setDeleteTarget(null)}
      />

      {openIssueId && (
        <IssueDetailDrawer
          issueId={openIssueId}
          projectId={projectId}
          statuses={statuses}
          users={users}
          onClose={() => setOpenIssueId(null)}
          onOpenIssue={setOpenIssueId}
        />
      )}
    </Shell>
  );
}

function SprintSection({
  sprint,
  issues,
  users,
  statusById,
  sprintOptions,
  onOpenIssue,
  onMove,
  onStart,
  onComplete,
  onDelete,
  startDisabled,
  actionPending,
  incompleteCount,
}: {
  sprint: SprintDto;
  issues: IssueDto[];
  users: UserDto[];
  statusById: Map<string, StatusDto>;
  sprintOptions: { id: string; name: string }[];
  onOpenIssue: (id: string) => void;
  onMove: (issue: IssueDto, sprintId: string | null) => void;
  onStart: () => void;
  onComplete: () => void;
  onDelete: () => void;
  startDisabled: boolean;
  actionPending: boolean;
  incompleteCount: number;
}) {
  const isActive = sprint.state === SprintState.ACTIVE;
  const points = issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
  const meta = [
    points > 0 ? `${points} pts` : null,
    issues.length > 0 ? `${incompleteCount} to do` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Section
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span>{sprint.name}</span>
          <Badge
            className={
              isActive
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-700'
            }
          >
            {isActive ? 'Active' : 'Planned'}
          </Badge>
          {sprint.goal && (
            <span className="text-xs font-normal text-gray-500">
              · {sprint.goal}
            </span>
          )}
        </span>
      }
      testId="section-sprint"
      count={issues.length}
      meta={meta || undefined}
      actions={
        <div className="flex items-center gap-2">
          {isActive ? (
            <Button
              size="sm"
              variant="secondary"
              loading={actionPending}
              onClick={onComplete}
            >
              Complete sprint
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                loading={actionPending}
                disabled={startDisabled}
                title={
                  startDisabled
                    ? 'Another sprint is already active. Complete it first.'
                    : undefined
                }
                onClick={onStart}
              >
                Start sprint
              </Button>
              <Button size="sm" variant="ghost" onClick={onDelete}>
                Delete
              </Button>
            </>
          )}
        </div>
      }
    >
      {startDisabled && (
        <p className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Another sprint is already active. Complete it before starting this
          one.
        </p>
      )}
      {issues.length === 0 ? (
        <EmptyState
          title="No issues in this sprint yet"
          description="Move issues here from the backlog below."
        />
      ) : (
        <ul className="divide-y divide-gray-100">
          {issues.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              users={users}
              status={statusById.get(issue.statusId)}
              sprintOptions={sprintOptions}
              currentSprintId={sprint.id}
              onOpen={() => onOpenIssue(issue.id)}
              onMove={(sprintId) => onMove(issue, sprintId)}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function Section({
  title,
  count,
  meta,
  actions,
  children,
  testId,
}: {
  title: React.ReactNode;
  count: number;
  meta?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className="rounded-xl border border-gray-200 bg-white shadow-card"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500">
          {count} {count === 1 ? 'issue' : 'issues'}
        </span>
        {meta && <span className="text-xs text-gray-400">{meta}</span>}
        {actions && <div className="ml-auto">{actions}</div>}
      </header>
      <div className="p-2 sm:p-3">{children}</div>
    </section>
  );
}

function IssueRow({
  issue,
  users,
  status,
  sprintOptions,
  currentSprintId,
  onOpen,
  onMove,
}: {
  issue: IssueDto;
  users: UserDto[];
  status?: StatusDto;
  sprintOptions: { id: string; name: string }[];
  currentSprintId: string | null;
  onOpen: () => void;
  onMove: (sprintId: string | null) => void;
}) {
  const assignee = users.find((u) => u.id === issue.assigneeId) ?? null;
  return (
    <li
      data-testid="backlog-issue"
      data-issue-key={issue.key}
      className="flex items-center gap-3 px-2 py-2 hover:bg-gray-50"
    >
      <IssueTypeIcon type={issue.type} className="h-4 w-4" />
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-gray-400">
            {issue.key}
          </span>
          <span className="truncate text-sm text-gray-900">{issue.title}</span>
        </span>
      </button>
      {status && (
        <Badge className="hidden sm:inline-flex">{status.name}</Badge>
      )}
      {issue.storyPoints != null && (
        <span
          title="Story points"
          className="hidden h-5 min-w-5 items-center justify-center rounded-full bg-brand-100 px-1.5 text-xs font-semibold text-brand-700 sm:inline-flex"
        >
          {issue.storyPoints}
        </span>
      )}
      <PriorityIcon
        priority={issue.priority}
        className="hidden h-4 w-4 sm:inline-flex"
      />
      <Avatar user={assignee} size="sm" />
      <MoveMenu
        currentSprintId={currentSprintId}
        sprintOptions={sprintOptions}
        onMove={onMove}
      />
    </li>
  );
}

function MoveMenu({
  currentSprintId,
  sprintOptions,
  onMove,
}: {
  currentSprintId: string | null;
  sprintOptions: { id: string; name: string }[];
  onMove: (sprintId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const targets: { id: string | null; name: string }[] = [
    ...sprintOptions
      .filter((s) => s.id !== currentSprintId)
      .map((s) => ({ id: s.id as string | null, name: s.name })),
  ];
  if (currentSprintId !== null) {
    targets.unshift({ id: null, name: 'Backlog' });
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={targets.length === 0}
        className={cn(
          'inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        Move to
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && targets.length > 0 && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-cardHover"
        >
          {targets.map((t) => (
            <button
              key={t.id ?? '__backlog__'}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onMove(t.id);
              }}
              className="block w-full truncate px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateSprintModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const create = useCreateSprint(projectId);
  const toast = useToast();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      {
        name: name.trim(),
        goal: goal.trim() || undefined,
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        endDate: endDate ? new Date(endDate).toISOString() : undefined,
      },
      {
        onSuccess: () => {
          toast.success(`Sprint "${name.trim()}" created.`);
          onClose();
        },
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not create sprint.')),
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Create sprint"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-sprint-form"
            loading={create.isPending}
          >
            Create
          </Button>
        </>
      }
    >
      <form id="create-sprint-form" onSubmit={submit} className="space-y-3">
        <Field label="Name" htmlFor="sprint-name">
          <Input
            id="sprint-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sprint 1"
            autoFocus
            required
          />
        </Field>
        <Field label="Goal" htmlFor="sprint-goal">
          <Textarea
            id="sprint-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="What should this sprint achieve?"
            rows={2}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date" htmlFor="sprint-start">
            <Input
              id="sprint-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label="End date" htmlFor="sprint-end">
            <Input
              id="sprint-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

function DeleteSprintDialog({
  projectId,
  sprint,
  onClose,
}: {
  projectId: string;
  sprint: SprintDto | null;
  onClose: () => void;
}) {
  const del = useDeleteSprint(projectId);
  const toast = useToast();
  return (
    <ConfirmDialog
      open={!!sprint}
      title={`Delete ${sprint?.name ?? 'sprint'}?`}
      message="The sprint will be removed. Its issues stay in the project and return to the backlog."
      confirmLabel="Delete sprint"
      variant="danger"
      loading={del.isPending}
      onConfirm={() => {
        if (!sprint) return;
        del.mutate(sprint.id, {
          onSuccess: () => {
            toast.success(`${sprint.name} deleted.`);
            onClose();
          },
          onError: (err) =>
            toast.error(errorMessage(err, 'Could not delete that sprint.')),
        });
      }}
      onCancel={onClose}
    />
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
    <div className="flex h-screen flex-col">
      <AppHeader>
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="text-sm text-gray-400 hover:text-gray-600"
            aria-label="Back to projects"
          >
            Projects
          </Link>
          <span className="text-gray-300">/</span>
          <span className="truncate text-sm font-semibold text-gray-900">
            {projectName ?? 'Project'}
          </span>
        </div>
      </AppHeader>
      <ProjectNav projectId={projectId} />
      <main className="flex-1 overflow-y-auto bg-gray-50">{children}</main>
    </div>
  );
}

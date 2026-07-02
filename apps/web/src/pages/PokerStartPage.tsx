import { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { SprintState, type IssueDto } from '@next-lane/shared';
import {
  usePokerSessions,
  useCreatePokerSession,
} from '@/api/poker';
import { useProjectIssues } from '@/api/issues';
import { useSprints } from '@/api/meta';
import { useBoard } from '@/api/issues';
import { useMyRole } from '@/api/workspaces';
import { canEdit } from '@/lib/permissions';
import { AppHeader } from '@/components/AppHeader';
import { ProjectNav } from '@/components/project/ProjectNav';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { IssueTypeIcon } from '@/components/issue/issueMeta';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

export function PokerStartPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();

  const boardQuery = useBoard(projectId);
  const sessionsQuery = usePokerSessions(projectId);
  const myRole = useMyRole(boardQuery.data?.project.workspaceId);
  const editable = canEdit(myRole);

  const [createOpen, setCreateOpen] = useState(false);

  const isLoading = sessionsQuery.isLoading || boardQuery.isLoading;

  if (isLoading) {
    return (
      <Shell projectId={projectId} projectName={boardQuery.data?.project.name}>
        <LoadingState label="Loading poker sessions…" />
      </Shell>
    );
  }

  if (sessionsQuery.isError) {
    return (
      <Shell projectId={projectId} projectName={boardQuery.data?.project.name}>
        <ErrorState
          error={sessionsQuery.error}
          onRetry={() => sessionsQuery.refetch()}
        />
      </Shell>
    );
  }

  const sessions = sessionsQuery.data ?? [];

  return (
    <Shell
      projectId={projectId}
      projectName={boardQuery.data?.project.name}
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 sm:p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-lg font-semibold text-ink-900">
              Planning Poker
            </h1>
            <p className="text-sm text-ink-500">
              Estimate issues collaboratively with your team.
            </p>
          </div>
          {editable && (
            <Button
              data-testid="poker-start"
              onClick={() => setCreateOpen(true)}
            >
              + New session
            </Button>
          )}
        </div>

        {/* Sessions list */}
        {sessions.length === 0 ? (
          <EmptyState
            title="No poker sessions yet"
            description={
              editable
                ? 'Start a session to estimate your backlog.'
                : 'No sessions have been created for this project.'
            }
            action={
              editable ? (
                <Button
                  data-testid="poker-start"
                  onClick={() => setCreateOpen(true)}
                >
                  + New session
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((session) => (
              <li key={session.id}>
                <Link
                  to={`/projects/${projectId}/poker/${session.id}`}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border border-ink-200 bg-white',
                    'px-4 py-3 shadow-card transition-all duration-[120ms]',
                    'hover:border-signal-300 hover:shadow-cardHover',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink-900">
                      {session.name ?? 'Untitled session'}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-400">
                      {session.items?.length ?? 0} items ·{' '}
                      {new Date(session.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge
                    className={cn(
                      session.state === 'CLOSED'
                        ? 'bg-ink-100 text-ink-500'
                        : session.state === 'REVEALED'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-signal-100 text-signal-700',
                    )}
                  >
                    {session.state}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {createOpen && (
        <CreateSessionModal
          projectId={projectId}
          onClose={() => setCreateOpen(false)}
          onCreated={(sessionId) => {
            setCreateOpen(false);
            navigate(`/projects/${projectId}/poker/${sessionId}`);
          }}
        />
      )}
    </Shell>
  );
}

// ── CreateSessionModal ────────────────────────────────────────────────────────

function CreateSessionModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (sessionId: string) => void;
}) {
  const toast = useToast();
  const createSession = useCreatePokerSession(projectId);
  const issuesQuery = useProjectIssues(projectId);
  const sprintsQuery = useSprints(projectId);

  const [name, setName] = useState('');
  const [selectedSprintId, setSelectedSprintId] = useState<string>('');
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(
    new Set(),
  );

  // Only show PLANNED + ACTIVE sprints.
  const sprints = useMemo(
    () =>
      (sprintsQuery.data ?? []).filter(
        (s) => s.state !== SprintState.COMPLETED,
      ),
    [sprintsQuery.data],
  );

  // Issues filtered by selected sprint (or all if none).
  const filteredIssues = useMemo(() => {
    const all = issuesQuery.data ?? [];
    if (!selectedSprintId) return all;
    return all.filter((i) => i.sprintId === selectedSprintId);
  }, [issuesQuery.data, selectedSprintId]);

  // When a sprint is selected, pre-select all its issues.
  function handleSprintChange(sprintId: string) {
    setSelectedSprintId(sprintId);
    if (sprintId) {
      const sprintIssueIds = new Set(
        (issuesQuery.data ?? [])
          .filter((i) => i.sprintId === sprintId)
          .map((i) => i.id),
      );
      setSelectedIssueIds(sprintIssueIds);
    } else {
      setSelectedIssueIds(new Set());
    }
  }

  function toggleIssue(id: string) {
    setSelectedIssueIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIssueIds.size === filteredIssues.length) {
      setSelectedIssueIds(new Set());
    } else {
      setSelectedIssueIds(new Set(filteredIssues.map((i) => i.id)));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedIssueIds.size === 0) {
      toast.error('Select at least one issue to estimate.');
      return;
    }
    createSession.mutate(
      {
        name: name.trim() || undefined,
        sprintId: selectedSprintId || undefined,
        issueIds: Array.from(selectedIssueIds),
      },
      {
        onSuccess: (session) => {
          toast.success('Poker session created.');
          onCreated(session.id);
        },
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not create session.')),
      },
    );
  }

  const allSelected =
    filteredIssues.length > 0 &&
    filteredIssues.every((i) => selectedIssueIds.has(i.id));

  return (
    <Modal
      open
      onClose={onClose}
      title="New planning poker session"
      size="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-poker-session-form"
            loading={createSession.isPending}
            disabled={selectedIssueIds.size === 0}
          >
            Start session
          </Button>
        </>
      }
    >
      <form
        id="create-poker-session-form"
        onSubmit={handleSubmit}
        className="flex flex-col gap-4"
      >
        <Field label="Session name" htmlFor="poker-session-name">
          <Input
            id="poker-session-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sprint 5 estimation"
            autoFocus
          />
        </Field>

        {sprints.length > 0 && (
          <Field label="Sprint (optional)" htmlFor="poker-sprint">
            <select
              id="poker-sprint"
              value={selectedSprintId}
              onChange={(e) => handleSprintChange(e.target.value)}
              className={cn(
                'w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900',
                'focus:border-signal-400 focus:outline-none focus:ring-2 focus:ring-signal-200',
              )}
            >
              <option value="">All issues</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{' '}
                  {s.state === SprintState.ACTIVE ? '(Active)' : '(Planned)'}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink-700">
              Issues to estimate{' '}
              <span className="text-ink-400">
                ({selectedIssueIds.size} selected)
              </span>
            </p>
            {filteredIssues.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs font-semibold text-signal-600 hover:text-signal-700"
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            )}
          </div>

          {issuesQuery.isLoading ? (
            <LoadingState label="Loading issues…" />
          ) : filteredIssues.length === 0 ? (
            <p className="rounded-lg border border-dashed border-ink-200 py-6 text-center text-sm text-ink-400">
              No issues found.
            </p>
          ) : (
            <ul
              className="max-h-64 overflow-y-auto rounded-lg border border-ink-200"
              aria-label="Issues to estimate"
            >
              {filteredIssues.map((issue, idx) => (
                <IssueSelectRow
                  key={issue.id}
                  issue={issue}
                  checked={selectedIssueIds.has(issue.id)}
                  hasBorder={idx < filteredIssues.length - 1}
                  onToggle={() => toggleIssue(issue.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </form>
    </Modal>
  );
}

function IssueSelectRow({
  issue,
  checked,
  hasBorder,
  onToggle,
}: {
  issue: IssueDto;
  checked: boolean;
  hasBorder: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 px-3 py-2.5',
        hasBorder && 'border-b border-ink-100',
        'hover:bg-ink-50',
      )}
    >
      <input
        type="checkbox"
        id={`issue-check-${issue.id}`}
        checked={checked}
        onChange={onToggle}
        className="h-4 w-4 rounded border-ink-300 text-signal-600 focus:ring-signal-500"
      />
      <label
        htmlFor={`issue-check-${issue.id}`}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
      >
        <IssueTypeIcon type={issue.type} className="h-4 w-4 shrink-0" />
        <span className="shrink-0 font-mono text-xs text-signal-600">
          {issue.key}
        </span>
        <span className="truncate text-sm text-ink-800">{issue.title}</span>
        {issue.storyPoints !== null && (
          <span className="ml-auto shrink-0 rounded-full bg-signal-100 px-1.5 py-0.5 font-mono text-xs font-bold text-signal-700">
            {issue.storyPoints}
          </span>
        )}
      </label>
    </li>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────

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
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to="/"
            className="shrink-0 text-sm text-ink-400 hover:text-ink-600"
            aria-label="Back to projects"
          >
            Projects
          </Link>
          <span className="shrink-0 text-ink-300">/</span>
          <span className="truncate text-sm font-semibold text-ink-900">
            {projectName ?? 'Project'}
          </span>
        </div>
      </AppHeader>
      <ProjectNav projectId={projectId} />
      <main className="flex-1 overflow-y-auto bg-ink-50">{children}</main>
    </div>
  );
}

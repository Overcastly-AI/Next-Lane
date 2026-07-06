import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  IssueType,
  Priority,
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
  useCreateIssue,
  useBulkUpdateIssues,
} from '@/api/issues';
import { useSprints, useUsers, useLabels } from '@/api/meta';
import {
  useCreateSprint,
  useUpdateSprint,
  useDeleteSprint,
} from '@/api/sprints';
import { useMyRole } from '@/api/workspaces';
import { canEdit } from '@/lib/permissions';
import { endDateStatus, formatDateRange } from '@/lib/sprintDates';
import { AppHeader } from '@/components/AppHeader';
import { ProjectBreadcrumb } from '@/components/project/ProjectBreadcrumb';
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
import {
  BulkActionBar,
  BulkSelectCheckbox,
  BulkSelectAll,
} from '@/components/issue/BulkActionBar';
import { useExportCsv } from '@/api/export';
import { ImportCsvModal } from '@/components/ImportCsvModal';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

const BACKLOG = '__backlog__';

export function BacklogPage() {
  const { projectId = '' } = useParams();
  const issuesQuery = useProjectIssues(projectId);
  const sprintsQuery = useSprints(projectId);
  const boardQuery = useBoard(projectId);
  const usersQuery = useUsers();
  const labelsQuery = useLabels(projectId);
  const toast = useToast();

  const assign = useAssignIssueToSprint(projectId);
  const updateSprint = useUpdateSprint(projectId);
  const createIssue = useCreateIssue(projectId);
  const bulkUpdate = useBulkUpdateIssues();

  const { exportCsv, isExporting } = useExportCsv({
    projectId,
    // boardQuery (declared above) — `board` is derived further down; reading it
    // here would be a temporal-dead-zone error that crashes the page.
    projectKey: boardQuery.data?.project.key,
    onError: (err) => toast.error(err.message || "Couldn't export issues."),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const [completeTarget, setCompleteTarget] = useState<SprintDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SprintDto | null>(null);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  function clearSelection() {
    setSelectedIds(new Set());
  }

  const issues = issuesQuery.data ?? [];
  const users = usersQuery.data ?? [];
  const labels = labelsQuery.data ?? [];
  const board = boardQuery.data;
  const myRole = useMyRole(board?.project.workspaceId);
  const editable = canEdit(myRole);

  function handleBulkApply(changes: Parameters<typeof bulkUpdate.mutate>[0]['changes']) {
    const ids = Array.from(selectedIds);
    bulkUpdate.mutate(
      { projectId, ids, changes },
      {
        onSuccess: (result) => {
          toast.success(`Updated ${result.updated} ${result.updated === 1 ? 'issue' : 'issues'}.`);
          if (result.failed.length > 0) {
            toast.error(
              `${result.failed.length} ${result.failed.length === 1 ? 'issue' : 'issues'} could not be updated.`,
            );
          }
          clearSelection();
        },
        onError: (err) => toast.error(errorMessage(err, 'Bulk update failed.')),
      },
    );
  }

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

  async function createInline(
    title: string,
    sprintId: string | null,
  ): Promise<void> {
    try {
      await createIssue.mutateAsync({
        projectId,
        title: title.trim(),
        type: IssueType.TASK,
        priority: Priority.MEDIUM,
        sprintId,
      });
      // GhostRow clears its own input and keeps focus for the next title.
    } catch (err) {
      toast.error(errorMessage(err, 'Could not create that issue.'));
      // Re-throw so the GhostRow keeps the typed text for a retry.
      throw err;
    }
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
            <h1 className="text-lg font-semibold text-slate-900">Backlog</h1>
            <p className="text-sm text-slate-500">
              Plan sprints and order your backlog.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Export is a read operation — available to viewers too. */}
            <Button
              variant="secondary"
              size="md"
              data-testid="export-csv"
              aria-label="Export issues as CSV"
              loading={isExporting}
              disabled={isExporting}
              onClick={exportCsv}
            >
              {!isExporting && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline strokeLinecap="round" strokeLinejoin="round" points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" />
                </svg>
              )}
              Export CSV
            </Button>
            {/* Import is a write operation — only available to editors. */}
            {editable && (
              <Button
                variant="secondary"
                size="md"
                data-testid="import-csv"
                aria-label="Import issues from CSV"
                onClick={() => setImportOpen(true)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline strokeLinecap="round" strokeLinejoin="round" points="7 14 12 9 17 14" />
                  <line x1="12" y1="9" x2="12" y2="21" strokeLinecap="round" />
                </svg>
                Import CSV
              </Button>
            )}
            {editable ? (
              <>
                <Link
                  to={`/projects/${projectId}/poker`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-ink-200 bg-surface px-3.5 text-sm font-semibold text-ink-700 shadow-xs transition-all duration-[120ms] hover:bg-ink-50 hover:border-ink-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
                >
                  ♠ Estimate / Poker
                </Link>
                <Button onClick={() => setCreateOpen(true)}>+ Create sprint</Button>
              </>
            ) : (
              <span
                data-testid="readonly-hint"
                className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500"
                title="You have view-only access to this workspace."
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                View only
              </span>
            )}
          </div>
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
              editable={editable}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onOpenIssue={setOpenIssueId}
              onMove={moveIssue}
              onCreate={(title) => createInline(title, sprint.id)}
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
          selectAll={
            (issuesBySprint.get(BACKLOG) ?? []).length > 0 ? (
              <BulkSelectAll
                total={(issuesBySprint.get(BACKLOG) ?? []).length}
                selectedCount={
                  (issuesBySprint.get(BACKLOG) ?? []).filter((i) =>
                    selectedIds.has(i.id),
                  ).length
                }
                onChange={(selectAll) => {
                  const backlogIssues = issuesBySprint.get(BACKLOG) ?? [];
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    for (const i of backlogIssues) {
                      if (selectAll) next.add(i.id);
                      else next.delete(i.id);
                    }
                    return next;
                  });
                }}
              />
            ) : undefined
          }
        >
          {(issuesBySprint.get(BACKLOG) ?? []).length === 0 ? (
            <EmptyState
              title="Backlog is empty"
              description="Issues with no sprint will appear here."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {(issuesBySprint.get(BACKLOG) ?? []).map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  users={users}
                  status={statusById.get(issue.statusId)}
                  sprintOptions={sprintOptions}
                  currentSprintId={null}
                  editable={editable}
                  selected={selectedIds.has(issue.id)}
                  onToggleSelect={(checked) => toggleSelect(issue.id, checked)}
                  onOpen={() => setOpenIssueId(issue.id)}
                  onMove={(sprintId) => moveIssue(issue, sprintId)}
                />
              ))}
            </ul>
          )}
          {editable && (
            <GhostRow
              testId="ghost-row-backlog"
              placeholder="+ Add an issue to the backlog…"
              onCreate={(title) => createInline(title, null)}
            />
          )}
        </Section>
      </div>

      {createOpen && (
        <CreateSprintModal
          projectId={projectId}
          onClose={() => setCreateOpen(false)}
        />
      )}

      {importOpen && (
        <ImportCsvModal
          projectId={projectId}
          onClose={() => setImportOpen(false)}
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
          editable={editable}
          viewerRole={myRole ?? undefined}
          onClose={() => setOpenIssueId(null)}
          onOpenIssue={setOpenIssueId}
        />
      )}

      <BulkActionBar
        selectedCount={selectedIds.size}
        statuses={statuses}
        users={users}
        labels={labels}
        sprints={planningSprints}
        showSprint
        isPending={bulkUpdate.isPending}
        onApply={handleBulkApply}
        onClear={clearSelection}
      />
    </Shell>
  );
}

function SprintSection({
  sprint,
  issues,
  users,
  statusById,
  sprintOptions,
  editable,
  selectedIds,
  onToggleSelect,
  onOpenIssue,
  onMove,
  onCreate,
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
  editable: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string, checked: boolean) => void;
  onOpenIssue: (id: string) => void;
  onMove: (issue: IssueDto, sprintId: string | null) => void;
  onCreate: (title: string) => Promise<void>;
  onStart: () => void;
  onComplete: () => void;
  onDelete: () => void;
  startDisabled: boolean;
  actionPending: boolean;
  incompleteCount: number;
}) {
  const isActive = sprint.state === SprintState.ACTIVE;
  const dateRange = formatDateRange(sprint.startDate, sprint.endDate);
  // Only warn for sprints that are running or planned — completed ones are
  // filtered out of this view anyway, but guard so past dates don't nag.
  const endStatus = endDateStatus(sprint.endDate);
  const showWarning =
    endStatus !== null && endStatus.tone !== 'ok' && isActive;
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
          {dateRange && (
            <span
              data-testid="sprint-dates"
              className="text-xs font-normal text-slate-500"
            >
              {dateRange}
            </span>
          )}
          {showWarning && endStatus && (
            <span
              data-testid="sprint-end-warning"
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-none',
                endStatus.tone === 'overdue'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-amber-100 text-amber-700',
              )}
            >
              {endStatus.label}
            </span>
          )}
          {sprint.goal && (
            <span className="text-xs font-normal text-slate-500">
              · {sprint.goal}
            </span>
          )}
        </span>
      }
      testId="section-sprint"
      count={issues.length}
      meta={meta || undefined}
      selectAll={
        issues.length > 0 ? (
          <BulkSelectAll
            total={issues.length}
            selectedCount={issues.filter((i) => selectedIds.has(i.id)).length}
            onChange={(selectAll) => {
              for (const i of issues) onToggleSelect(i.id, selectAll);
            }}
          />
        ) : undefined
      }
      actions={
        !editable ? undefined : (
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
        )
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
        <ul className="divide-y divide-slate-100">
          {issues.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              users={users}
              status={statusById.get(issue.statusId)}
              sprintOptions={sprintOptions}
              currentSprintId={sprint.id}
              editable={editable}
              selected={selectedIds.has(issue.id)}
              onToggleSelect={(checked) => onToggleSelect(issue.id, checked)}
              onOpen={() => onOpenIssue(issue.id)}
              onMove={(sprintId) => onMove(issue, sprintId)}
            />
          ))}
        </ul>
      )}
      {editable && (
        <GhostRow
          testId={`ghost-row-sprint-${sprint.id}`}
          placeholder={`+ Add an issue to ${sprint.name}…`}
          onCreate={onCreate}
        />
      )}
    </Section>
  );
}

function Section({
  title,
  count,
  meta,
  actions,
  selectAll,
  children,
  testId,
}: {
  title: React.ReactNode;
  count: number;
  meta?: string;
  actions?: React.ReactNode;
  selectAll?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className="rounded-xl border border-slate-200 bg-surface shadow-card"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        {selectAll && <div className="shrink-0">{selectAll}</div>}
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">
          {count} {count === 1 ? 'issue' : 'issues'}
        </span>
        {meta && <span className="text-xs text-slate-400">{meta}</span>}
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
  editable,
  selected,
  onToggleSelect,
  onOpen,
  onMove,
}: {
  issue: IssueDto;
  users: UserDto[];
  status?: StatusDto;
  sprintOptions: { id: string; name: string }[];
  currentSprintId: string | null;
  editable: boolean;
  selected: boolean;
  onToggleSelect: (checked: boolean) => void;
  onOpen: () => void;
  onMove: (sprintId: string | null) => void;
}) {
  const assignee = users.find((u) => u.id === issue.assigneeId) ?? null;
  return (
    <li
      data-testid="backlog-issue"
      data-issue-key={issue.key}
      className={cn(
        'flex items-center gap-3 px-2 py-2 transition-colors duration-[120ms]',
        selected ? 'bg-signal-50' : 'hover:bg-slate-50',
      )}
    >
      <BulkSelectCheckbox
        issueId={issue.id}
        checked={selected}
        onChange={onToggleSelect}
      />
      <IssueTypeIcon type={issue.type} className="h-4 w-4" />
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-slate-400">
            {issue.key}
          </span>
          <span className="truncate text-sm text-slate-900">{issue.title}</span>
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
      {editable && (
        <MoveMenu
          currentSprintId={currentSprintId}
          sprintOptions={sprintOptions}
          onMove={onMove}
        />
      )}
    </li>
  );
}

/**
 * Inline "ghost row" create: type a title, press Enter to create an issue in this
 * section (sprint or backlog) without opening the modal. The input clears and stays
 * focused for rapid entry. Errors are surfaced by the caller via toast; on error we
 * keep the typed text so nothing is lost.
 */
function GhostRow({
  placeholder,
  onCreate,
  testId,
}: {
  placeholder: string;
  onCreate: (title: string) => Promise<void>;
  testId: string;
}) {
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      await onCreate(trimmed);
      setTitle('');
    } catch {
      // Keep the text so the user can retry; the caller already toasted.
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-3 px-2 py-2">
      <span className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <input
        type="text"
        data-testid={testId}
        value={title}
        disabled={pending}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={placeholder}
        className={cn(
          'min-w-0 flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400',
          'focus:outline-none disabled:opacity-50',
        )}
      />
    </div>
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
          'inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-surface px-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50',
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
          className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-surface py-1 shadow-cardHover"
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
              className="block w-full truncate px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
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
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader>
        <ProjectBreadcrumb primary={projectName} />
      </AppHeader>
      <ProjectNav projectId={projectId} />
      <main className="flex-1 overflow-y-auto bg-slate-50">{children}</main>
    </div>
  );
}

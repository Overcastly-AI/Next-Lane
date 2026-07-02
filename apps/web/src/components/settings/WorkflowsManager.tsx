/**
 * WorkflowsManager
 *
 * Named (per-board) workflow management for a project.
 *
 * Features (ADMIN only to mutate):
 *  - List all named workflows (name, enforced badge, transition count, board count).
 *  - Create a blank workflow or seed one from a template.
 *  - Select a workflow to open its detail panel:
 *    - Toggle enforced
 *    - View toggle: "List" (classic transition list) or "Graph" (visual SVG editor)
 *    - Add / edit / delete transitions (mirrors WorkflowSection UI)
 *    - Delete the entire workflow (confirm dialog)
 *  - Members/viewers: read-only list.
 *
 * testids:
 *   workflows-manager, workflow-create, workflow-from-template,
 *   workflow-row, workflow-enforce-toggle-2, workflow-graph-toggle
 */
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  IssueType,
  ISSUE_TYPES,
  WorkflowGateType,
  WORKFLOW_GATE_TYPES,
  WORKFLOW_GATE_LABELS,
  type StatusDto,
  type WorkflowTransitionDto,
  type WorkflowGateDto,
} from '@next-lane/shared';
import {
  useWorkflows,
  useWorkflowDetail,
  useCreateWorkflow,
  useCreateWorkflowFromTemplate,
  useUpdateWorkflow,
  useDeleteWorkflow,
  useAddWorkflowTransition,
  useUpdateWorkflowTransition,
  useDeleteWorkflowTransition,
  WORKFLOW_TEMPLATES,
  type WorkflowTemplate,
} from '@/api/workflows';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { ApiError } from '@/api/client';
import { cn } from '@/lib/cn';
import { useCustomFields } from '@/api/custom-fields';
import {
  buildGateFieldOptions,
  CORE_GATE_FIELD_OPTIONS,
  type GateFieldOption,
} from '@/lib/workflowGateFields';
import { WorkflowGraph } from './WorkflowGraph';

// ---------------------------------------------------------------------------
// Constants (mirrors WorkflowSection)
// ---------------------------------------------------------------------------

const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  [IssueType.TASK]: 'Task',
  [IssueType.BUG]: 'Bug',
  [IssueType.STORY]: 'Story',
  [IssueType.EPIC]: 'Epic',
  [IssueType.SUBTASK]: 'Subtask',
};

const ANY_STATUS = '__ANY__';
const ALL_TYPES = '__ALL__';
const GATE_NEEDS_FIELD = WorkflowGateType.REQUIRE_FIELD;
const GATE_NEEDS_LINKTYPE = WorkflowGateType.REQUIRE_LINK;

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function WorkflowsManager({
  projectId,
  statuses,
  isAdmin,
}: {
  projectId: string;
  statuses: StatusDto[];
  isAdmin: boolean;
}) {
  const workflowsQuery = useWorkflows(projectId);
  const workflows = workflowsQuery.data ?? [];
  const toast = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const deleteWorkflow = useDeleteWorkflow(projectId);

  function handleDeleteConfirm() {
    if (!deleteTarget) return;
    deleteWorkflow.mutate(deleteTarget, {
      onSuccess: () => {
        toast.success('Workflow deleted.');
        setDeleteTarget(null);
        if (selectedId === deleteTarget) setSelectedId(null);
      },
      onError: (err) => {
        setDeleteTarget(null);
        toast.error(errorMessage(err, 'Could not delete the workflow.'));
      },
    });
  }

  const selectedWorkflow = workflows.find((w) => w.id === selectedId);

  return (
    <section
      id="workflows-manager"
      data-testid="workflows-manager"
      className="rounded-xl border border-ink-200 bg-surface p-4 shadow-card sm:p-5"
    >
      {/* Section header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">Named Workflows</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Define reusable workflow graphs and assign them to boards. Only
            governs boards a workflow is explicitly assigned to — everything
            else (Triage, the issue drawer, bulk edit) follows the legacy
            project-wide transitions above.
          </p>
        </div>
        {isAdmin && (
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="secondary"
              data-testid="workflow-from-template"
              onClick={() => setTemplateOpen(true)}
            >
              From template
            </Button>
            <Button
              size="sm"
              data-testid="workflow-create"
              onClick={() => setCreateOpen(true)}
            >
              New workflow
            </Button>
          </div>
        )}
      </div>

      {/* Loading / error */}
      {workflowsQuery.isLoading ? (
        <LoadingState label="Loading workflows…" />
      ) : workflowsQuery.isError ? (
        <ErrorState
          error={workflowsQuery.error ?? new Error('Could not load workflows')}
          onRetry={() => workflowsQuery.refetch()}
        />
      ) : workflows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-ink-200 py-10 text-center">
          <svg className="h-8 w-8 text-ink-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
          <p className="text-sm font-medium text-ink-600">No workflows yet</p>
          {isAdmin && (
            <p className="text-xs text-ink-400">Create one or start from a template to control which status transitions are allowed on boards.</p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {workflows.map((wf) => (
            <button
              key={wf.id}
              type="button"
              data-testid="workflow-row"
              onClick={() => setSelectedId(wf.id === selectedId ? null : wf.id)}
              className={cn(
                'group w-full rounded-lg border px-3 py-2.5 text-left transition-colors duration-[120ms]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400',
                selectedId === wf.id
                  ? 'border-signal-200 bg-signal-50 shadow-xs'
                  : 'border-ink-150 bg-ink-50 hover:border-ink-200 hover:bg-surface hover:shadow-xs',
              )}
            >
              <div className="flex items-center gap-2.5">
                <span className="min-w-0 flex-1 text-sm font-medium text-ink-800 truncate">
                  {wf.name}
                </span>
                {wf.enforced && (
                  <span className="inline-flex items-center rounded-sm bg-signal-50 px-1.5 py-0.5 text-[10px] font-semibold text-signal-700 ring-1 ring-inset ring-signal-200">
                    Enforced
                  </span>
                )}
                <span className="font-mono text-[10px] text-ink-400 tabular-nums shrink-0">
                  {wf.transitionCount ?? 0}T
                </span>
                {typeof wf.boardCount === 'number' && wf.boardCount > 0 && (
                  <span className="font-mono text-[10px] text-ink-400 tabular-nums shrink-0">
                    {wf.boardCount}B
                  </span>
                )}
                {/* Chevron */}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden="true"
                  className={cn(
                    'shrink-0 text-ink-400 transition-transform duration-[120ms]',
                    selectedId === wf.id && 'rotate-180',
                  )}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {wf.description && (
                <p className="mt-0.5 text-xs text-ink-500 truncate">{wf.description}</p>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Workflow detail panel */}
      {selectedId && selectedWorkflow && (
        <WorkflowDetailPanel
          workflowId={selectedId}
          projectId={projectId}
          statuses={statuses}
          isAdmin={isAdmin}
          onDeleteRequest={() => setDeleteTarget(selectedId)}
        />
      )}

      {/* Create modal */}
      {createOpen && (
        <CreateWorkflowModal
          projectId={projectId}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            setSelectedId(id);
          }}
        />
      )}

      {/* From-template modal */}
      {templateOpen && (
        <FromTemplateModal
          projectId={projectId}
          onClose={() => setTemplateOpen(false)}
          onCreated={(id) => {
            setTemplateOpen(false);
            setSelectedId(id);
          }}
        />
      )}

      {/* Delete workflow confirm */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete workflow"
        message={
          <>
            Delete workflow{' '}
            <span className="font-medium text-slate-900">
              {workflows.find((w) => w.id === deleteTarget)?.name ?? ''}
            </span>
            ? Any boards using this workflow will revert to no named workflow.
          </>
        }
        confirmLabel="Delete workflow"
        variant="danger"
        loading={deleteWorkflow.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Workflow detail panel (shown inline below the list row)
// ---------------------------------------------------------------------------

type ViewMode = 'list' | 'graph';

function WorkflowDetailPanel({
  workflowId,
  projectId,
  statuses,
  isAdmin,
  onDeleteRequest,
}: {
  workflowId: string;
  projectId: string;
  statuses: StatusDto[];
  isAdmin: boolean;
  onDeleteRequest: () => void;
}) {
  const detailQuery = useWorkflowDetail(workflowId);
  const updateWorkflow = useUpdateWorkflow(projectId);
  const deleteTransition = useDeleteWorkflowTransition(workflowId);
  const customFieldsQuery = useCustomFields(projectId);
  const fieldOptions = buildGateFieldOptions(customFieldsQuery.data);
  const toast = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WorkflowTransitionDto | null>(null);
  const [deleteTransTarget, setDeleteTransTarget] = useState<WorkflowTransitionDto | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const detail = detailQuery.data;
  const statusById = new Map(statuses.map((s) => [s.id, s]));

  function handleToggleEnforced() {
    if (!detail) return;
    updateWorkflow.mutate(
      { id: workflowId, enforced: !detail.enforced },
      {
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not change workflow enforcement.')),
      },
    );
  }

  function handleDeleteTransition() {
    if (!deleteTransTarget) return;
    const target = deleteTransTarget;
    deleteTransition.mutate(target.id, {
      onSuccess: () => {
        setDeleteTransTarget(null);
        toast.success('Transition deleted.');
      },
      onError: (err) => {
        setDeleteTransTarget(null);
        toast.error(errorMessage(err, 'Could not delete the transition.'));
      },
    });
  }

  const transitions: WorkflowTransitionDto[] =
    (detail as (typeof detail & { transitions?: WorkflowTransitionDto[] }) | undefined)
      ?.transitions ?? [];

  const grouped = groupTransitions(transitions);

  return (
    <div className="mt-3 rounded-xl border border-ink-200 bg-ink-50 p-4">
      {detailQuery.isLoading ? (
        <LoadingState label="Loading workflow…" />
      ) : detailQuery.isError ? (
        <ErrorState
          error={detailQuery.error ?? new Error('Could not load workflow')}
          onRetry={() => detailQuery.refetch()}
        />
      ) : detail ? (
        <>
          {/* Header */}
          <div className="mb-4 flex items-start justify-between gap-3">
            <WorkflowNameEditor
              workflowId={workflowId}
              projectId={projectId}
              name={detail.name}
              isAdmin={isAdmin}
            />
            <div className="flex shrink-0 items-center gap-2">
              {/* View toggle: List / Graph */}
              <div
                role="group"
                aria-label="Workflow view mode"
                data-testid="workflow-graph-toggle"
                className="flex rounded-lg border border-ink-200 bg-surface overflow-hidden"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={viewMode === 'list'}
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-inset',
                    viewMode === 'list'
                      ? 'bg-signal-600 text-white'
                      : 'text-ink-600 hover:bg-ink-50',
                  )}
                >
                  List
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={viewMode === 'graph'}
                  onClick={() => setViewMode('graph')}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium border-l border-ink-200 transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-inset',
                    viewMode === 'graph'
                      ? 'bg-signal-600 text-white'
                      : 'text-ink-600 hover:bg-ink-50',
                  )}
                >
                  Graph
                </button>
              </div>

              {isAdmin && viewMode === 'list' && (
                <Button
                  size="sm"
                  onClick={() => setAddOpen(true)}
                >
                  + Add transition
                </Button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  aria-label="Delete this workflow"
                  onClick={onDeleteRequest}
                  className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Enforcement toggle */}
          <EnforcementToggle
            enforced={detail.enforced}
            loading={updateWorkflow.isPending}
            isAdmin={isAdmin}
            onToggle={handleToggleEnforced}
          />

          {/* Graph view */}
          {viewMode === 'graph' && (
            <div className="mt-4">
              <WorkflowGraph
                workflowId={workflowId}
                statuses={statuses}
                transitions={transitions}
                isAdmin={isAdmin}
                onEditTransition={(t) => setEditTarget(t)}
              />
            </div>
          )}

          {/* List view — Transitions */}
          {viewMode === 'list' && (
            <div className="mt-4">
              {grouped.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-ink-200 py-8 text-center">
                  <svg className="h-6 w-6 text-ink-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                  <p className="text-xs text-ink-500">
                    {detail.enforced
                      ? 'No transitions yet. Add one to restrict which status moves are allowed.'
                      : 'No transitions — all status moves are allowed while enforcement is off.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {grouped.map((group) => (
                    <TransitionGroupView
                      key={group.fromStatusId ?? ANY_STATUS}
                      fromStatusId={group.fromStatusId}
                      fromStatusName={
                        group.fromStatusId
                          ? (statusById.get(group.fromStatusId)?.name ?? 'Unknown status')
                          : 'Any status'
                      }
                      transitions={group.transitions}
                      statusById={statusById}
                      isAdmin={isAdmin}
                      onEdit={(t) => setEditTarget(t)}
                      onDelete={(t) => setDeleteTransTarget(t)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : null}

      {/* Add transition */}
      {addOpen && (
        <WorkflowTransitionFormModal
          workflowId={workflowId}
          statuses={statuses}
          fieldOptions={fieldOptions}
          onClose={() => setAddOpen(false)}
        />
      )}

      {/* Edit transition */}
      {editTarget && (
        <WorkflowTransitionFormModal
          workflowId={workflowId}
          statuses={statuses}
          fieldOptions={fieldOptions}
          existing={editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* Delete transition confirm */}
      <ConfirmDialog
        open={deleteTransTarget !== null}
        title="Delete transition"
        message={
          <>
            Delete this transition from{' '}
            <span className="font-medium text-slate-900">
              {deleteTransTarget?.fromStatusId
                ? (statusById.get(deleteTransTarget.fromStatusId)?.name ?? 'Unknown')
                : 'Any status'}
            </span>{' '}
            to{' '}
            <span className="font-medium text-slate-900">
              {deleteTransTarget?.toStatusId
                ? (statusById.get(deleteTransTarget.toStatusId)?.name ?? 'Unknown')
                : ''}
            </span>
            ?
          </>
        }
        confirmLabel="Delete transition"
        variant="danger"
        loading={deleteTransition.isPending}
        onConfirm={handleDeleteTransition}
        onCancel={() => setDeleteTransTarget(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline workflow rename (WF-4: pencil -> input, Enter/blur saves, Escape
// cancels; per-keystroke typing supported since it's a plain controlled
// <input>, not a debounced/batched field).
// ---------------------------------------------------------------------------

function WorkflowNameEditor({
  workflowId,
  projectId,
  name,
  isAdmin,
}: {
  workflowId: string;
  projectId: string;
  name: string;
  isAdmin: boolean;
}) {
  const updateWorkflow = useUpdateWorkflow(projectId);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  // Distinguishes "blur because Escape was pressed" (cancel) from "blur
  // because the admin clicked/tabbed away" (commit) — both funnel through
  // the same onBlur handler so Enter/blur/Escape can't race each other.
  const cancelledRef = useRef(false);

  function startEditing() {
    setDraft(name);
    setEditing(true);
  }

  function commit() {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === name) {
      setDraft(name);
      return;
    }
    updateWorkflow.mutate(
      { id: workflowId, name: trimmed },
      {
        onSuccess: () => toast.success('Workflow renamed.'),
        onError: (err) => {
          const msg =
            err instanceof ApiError && err.status === 409
              ? 'A workflow with that name already exists in this project.'
              : errorMessage(err, 'Could not rename the workflow.');
          toast.error(msg);
          setDraft(name);
        },
      },
    );
  }

  function handleBlur() {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      setDraft(name);
      setEditing(false);
      return;
    }
    commit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur(); // triggers commit() via handleBlur
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelledRef.current = true;
      e.currentTarget.blur(); // triggers cancel via handleBlur
    }
  }

  if (!isAdmin) {
    return <h3 className="min-w-0 truncate text-sm font-semibold text-ink-800">{name}</h3>;
  }

  if (editing) {
    return (
      <input
        autoFocus
        aria-label="Workflow name"
        value={draft}
        maxLength={120}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="h-7 min-w-0 flex-1 rounded border border-signal-300 bg-surface px-2 text-sm font-semibold text-ink-800 focus:outline-none focus:ring-2 focus:ring-signal-200"
      />
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <h3 className="min-w-0 truncate text-sm font-semibold text-ink-800">{name}</h3>
      <button
        type="button"
        aria-label="Rename workflow"
        onClick={startEditing}
        className="shrink-0 rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enforcement toggle (same visual as WorkflowSection, distinct testid)
// ---------------------------------------------------------------------------

function EnforcementToggle({
  enforced,
  loading,
  isAdmin,
  onToggle,
}: {
  enforced: boolean;
  loading: boolean;
  isAdmin: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={cn(
      'rounded-lg border px-4 py-3 transition-colors duration-[120ms]',
      enforced ? 'border-signal-200 bg-signal-50/50' : 'border-ink-200 bg-surface',
    )}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={enforced}
          aria-label={enforced ? 'Enforcement on — click to disable' : 'Enforcement off — click to enable'}
          data-testid="workflow-enforce-toggle-2"
          disabled={!isAdmin || loading}
          onClick={onToggle}
          className={cn(
            'relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full',
            'transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-offset-1',
            enforced ? 'bg-signal-600' : 'bg-ink-300',
            (!isAdmin || loading) && 'cursor-not-allowed opacity-50',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'inline-block h-3.5 w-3.5 rounded-full bg-surface shadow transition-transform duration-200',
              enforced ? 'translate-x-4' : 'translate-x-1',
            )}
          />
        </button>
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-800">
            {enforced ? 'Enforcement on' : 'Enforcement off'}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {enforced
              ? 'Only the transitions below are allowed on boards using this workflow.'
              : 'Any status transition is permitted regardless of the list below.'}
          </p>
          {!isAdmin && (
            <p className="mt-1 text-xs text-ink-400">Only admins can change enforcement.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grouped transition rows (mirrors WorkflowSection)
// ---------------------------------------------------------------------------

interface TGroup {
  fromStatusId: string | null;
  transitions: WorkflowTransitionDto[];
}

function groupTransitions(transitions: WorkflowTransitionDto[]): TGroup[] {
  const map = new Map<string, WorkflowTransitionDto[]>();
  for (const t of transitions) {
    const key = t.fromStatusId ?? ANY_STATUS;
    const existing = map.get(key);
    if (existing) {
      existing.push(t);
    } else {
      map.set(key, [t]);
    }
  }
  const result: TGroup[] = [];
  const anyGroup = map.get(ANY_STATUS);
  if (anyGroup) result.push({ fromStatusId: null, transitions: anyGroup });
  for (const [key, group] of map) {
    if (key !== ANY_STATUS) result.push({ fromStatusId: key, transitions: group });
  }
  return result;
}

function TransitionGroupView({
  fromStatusId,
  fromStatusName,
  transitions,
  statusById,
  isAdmin,
  onEdit,
  onDelete,
}: {
  fromStatusId: string | null;
  fromStatusName: string;
  transitions: WorkflowTransitionDto[];
  statusById: Map<string, StatusDto>;
  isAdmin: boolean;
  onEdit: (t: WorkflowTransitionDto) => void;
  onDelete: (t: WorkflowTransitionDto) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-semibold',
            fromStatusId
              ? 'bg-ink-100 text-ink-700'
              : 'bg-signal-50 text-signal-700 ring-1 ring-inset ring-signal-200',
          )}
        >
          {fromStatusId ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-ink-400" aria-hidden="true" />
              {fromStatusName}
            </>
          ) : (
            <>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v20M2 12h20" />
              </svg>
              Any status
            </>
          )}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="text-ink-300">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </div>
      <ul className="divide-y divide-ink-100 rounded-lg border border-ink-150 bg-surface shadow-xs">
        {transitions.map((t) => {
          const toStatus = statusById.get(t.toStatusId);
          return (
            <li
              key={t.id}
              className="flex items-center gap-3 px-3 py-2.5"
              data-testid="workflow-transition-row"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink-800 truncate">
                  {toStatus?.name ?? t.toStatusId}
                  {t.name && (
                    <span className="ml-1.5 font-normal text-ink-500">"{t.name}"</span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-ink-400">
                  {t.issueType ? ISSUE_TYPE_LABELS[t.issueType] : 'All types'}
                  {t.gates.length > 0 && (
                    <span className="ml-1.5 inline-flex flex-wrap gap-1">
                      {t.gates.map((g, i) => (
                        <GateChip key={i} gate={g} />
                      ))}
                    </span>
                  )}
                </span>
              </span>
              {isAdmin && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <WfIconButton
                    aria-label={`Edit transition to ${toStatus?.name ?? t.toStatusId}`}
                    onClick={() => onEdit(t)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                  </WfIconButton>
                  <WfIconButton
                    aria-label={`Delete transition to ${toStatus?.name ?? t.toStatusId}`}
                    danger
                    onClick={() => onDelete(t)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" />
                    </svg>
                  </WfIconButton>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GateChip({ gate }: { gate: WorkflowGateDto }) {
  const label = WORKFLOW_GATE_LABELS[gate.type] ?? gate.type;
  const extra = gate.field ?? gate.linkType;
  // WF-3: a gate stored (pre-fix) with a blank field/linkType param is a
  // permanent no-op server-side — flag it visibly instead of implying it's
  // an active rule.
  const misconfigured =
    (gate.type === WorkflowGateType.REQUIRE_FIELD && !gate.field) ||
    (gate.type === WorkflowGateType.REQUIRE_LINK && !gate.linkType);

  if (misconfigured) {
    return (
      <span
        data-testid="workflow-gate-misconfigured"
        title="This gate has no field/link type set and will never actually block a transition."
        className="inline-flex items-center gap-0.5 rounded-sm bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
      >
        ⚠ {label} — misconfigured
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-0.5 rounded-sm bg-signal-50 px-1.5 py-0.5 text-[10px] font-medium text-signal-700 ring-1 ring-inset ring-signal-100">
      {label}
      {extra && <span className="font-normal opacity-75">: {extra}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Create workflow modal
// ---------------------------------------------------------------------------

function CreateWorkflowModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const createWorkflow = useCreateWorkflow(projectId);
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createWorkflow.mutate(
      { name: trimmed, description: description.trim() || undefined },
      {
        onSuccess: (wf) => {
          toast.success(`Workflow "${wf.name}" created.`);
          onCreated(wf.id);
        },
        onError: (err) => toast.error(errorMessage(err, 'Could not create workflow.')),
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New workflow"
      size="max-w-sm"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-workflow-form"
            loading={createWorkflow.isPending}
            disabled={!name.trim()}
          >
            Create
          </Button>
        </>
      }
    >
      <form id="create-workflow-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name" htmlFor="wfm-name">
          <Input
            id="wfm-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Engineering Workflow"
            autoFocus
            maxLength={80}
            required
          />
        </Field>
        <Field label="Description (optional)" htmlFor="wfm-desc">
          <Input
            id="wfm-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this workflow govern?"
            maxLength={200}
          />
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// From-template modal
// ---------------------------------------------------------------------------

function FromTemplateModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const createFromTemplate = useCreateWorkflowFromTemplate(projectId);
  const toast = useToast();
  const [template, setTemplate] = useState<WorkflowTemplate>('simple');
  const [name, setName] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createFromTemplate.mutate(
      { template, name: name.trim() || undefined },
      {
        onSuccess: (wf) => {
          toast.success(`Workflow "${wf.name}" created from template.`);
          onCreated(wf.id);
        },
        onError: (err) => toast.error(errorMessage(err, 'Could not create from template.')),
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Start from template"
      size="max-w-sm"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="template-workflow-form"
            loading={createFromTemplate.isPending}
          >
            Create
          </Button>
        </>
      }
    >
      <form id="template-workflow-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Template" htmlFor="wfm-tpl">
          <select
            id="wfm-tpl"
            value={template}
            onChange={(e) => setTemplate(e.target.value as WorkflowTemplate)}
            className={selectClass}
          >
            {WORKFLOW_TEMPLATES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name (optional — defaults to template name)" htmlFor="wfm-tpl-name">
          <Input
            id="wfm-tpl-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Leave blank to use the template name"
            maxLength={80}
          />
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Transition form modal for a named workflow (mirrors WorkflowSection's modal)
// ---------------------------------------------------------------------------

interface TransitionFormState {
  fromStatusId: string;
  toStatusId: string;
  issueType: string;
  name: string;
  gates: GateDraft[];
}

interface GateDraft {
  id: number;
  type: WorkflowGateType;
  field: string;
  linkType: string;
}

let gateIdSeq = 0;
function nextGateId() { return ++gateIdSeq; }

function initTransitionState(
  existing: WorkflowTransitionDto | undefined,
  statuses: StatusDto[],
): TransitionFormState {
  if (existing) {
    return {
      fromStatusId: existing.fromStatusId ?? ANY_STATUS,
      toStatusId: existing.toStatusId,
      issueType: existing.issueType ?? ALL_TYPES,
      name: existing.name ?? '',
      gates: existing.gates.map((g) => ({
        id: nextGateId(),
        type: g.type,
        field: g.field ?? '',
        linkType: g.linkType ?? '',
      })),
    };
  }
  return {
    fromStatusId: ANY_STATUS,
    toStatusId: statuses[0]?.id ?? '',
    issueType: ALL_TYPES,
    name: '',
    gates: [],
  };
}

function WorkflowTransitionFormModal({
  workflowId,
  statuses,
  fieldOptions,
  existing,
  onClose,
}: {
  workflowId: string;
  statuses: StatusDto[];
  fieldOptions: GateFieldOption[];
  existing?: WorkflowTransitionDto;
  onClose: () => void;
}) {
  const addTransition = useAddWorkflowTransition(workflowId);
  const updateTransition = useUpdateWorkflowTransition(workflowId);
  const toast = useToast();
  const [form, setForm] = useState<TransitionFormState>(() =>
    initTransitionState(existing, statuses),
  );

  const isEdit = !!existing;
  const isPending = isEdit ? updateTransition.isPending : addTransition.isPending;

  function setField<K extends keyof TransitionFormState>(key: K, value: TransitionFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function addGate() {
    setForm((prev) => ({
      ...prev,
      gates: [
        ...prev.gates,
        { id: nextGateId(), type: WorkflowGateType.REQUIRE_ASSIGNEE, field: '', linkType: '' },
      ],
    }));
  }

  function removeGate(id: number) {
    setForm((prev) => ({ ...prev, gates: prev.gates.filter((g) => g.id !== id) }));
  }

  function updateGate(id: number, patch: Partial<Omit<GateDraft, 'id'>>) {
    setForm((prev) => ({
      ...prev,
      gates: prev.gates.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    }));
  }

  function buildGateDtos(): WorkflowGateDto[] {
    return form.gates.map((g) => {
      const dto: WorkflowGateDto = { type: g.type };
      if (g.type === GATE_NEEDS_FIELD && g.field.trim()) dto.field = g.field.trim();
      if (g.type === GATE_NEEDS_LINKTYPE && g.linkType.trim()) dto.linkType = g.linkType.trim();
      return dto;
    });
  }

  // WF-3: a REQUIRE_FIELD gate with no field selected (or REQUIRE_LINK with no
  // link type) would silently no-op server-side — block Save instead of
  // letting the admin believe they configured an active rule.
  const hasIncompleteGate = form.gates.some(
    (g) =>
      (g.type === GATE_NEEDS_FIELD && !g.field.trim()) ||
      (g.type === GATE_NEEDS_LINKTYPE && !g.linkType.trim()),
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const gates = buildGateDtos();
    const fromStatusId = form.fromStatusId === ANY_STATUS ? null : form.fromStatusId;
    const issueType = form.issueType === ALL_TYPES ? null : (form.issueType as IssueType);

    if (isEdit && existing) {
      updateTransition.mutate(
        {
          id: existing.id,
          fromStatusId,
          toStatusId: form.toStatusId,
          issueType,
          name: form.name.trim() || null,
          gates,
        },
        {
          onSuccess: () => { toast.success('Transition updated.'); onClose(); },
          onError: (err) => {
            const msg = err instanceof ApiError && err.status === 409
              ? 'An identical transition already exists.'
              : errorMessage(err, 'Could not update the transition.');
            toast.error(msg);
          },
        },
      );
    } else {
      addTransition.mutate(
        {
          fromStatusId,
          toStatusId: form.toStatusId,
          issueType,
          name: form.name.trim() || undefined,
          gates,
        },
        {
          onSuccess: () => { toast.success('Transition added.'); onClose(); },
          onError: (err) => {
            const msg = err instanceof ApiError && err.status === 409
              ? 'That transition already exists.'
              : errorMessage(err, 'Could not create the transition.');
            toast.error(msg);
          },
        },
      );
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Edit transition' : 'Add transition'}
      size="max-w-lg"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            data-testid="workflow-save-transition"
            type="submit"
            form="wfm-transition-form"
            loading={isPending}
            disabled={!form.toStatusId || hasIncompleteGate}
          >
            {isEdit ? 'Save changes' : 'Add transition'}
          </Button>
        </>
      }
    >
      <form id="wfm-transition-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="From status" htmlFor="wfm-t-from">
          <select
            id="wfm-t-from"
            value={form.fromStatusId}
            onChange={(e) => setField('fromStatusId', e.target.value)}
            className={selectClass}
          >
            <option value={ANY_STATUS}>Any status</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>

        <Field label="To status" htmlFor="wfm-t-to">
          <select
            id="wfm-t-to"
            value={form.toStatusId}
            onChange={(e) => setField('toStatusId', e.target.value)}
            className={selectClass}
            required
          >
            <option value="" disabled>Select a status…</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Issue type" htmlFor="wfm-t-type">
          <select
            id="wfm-t-type"
            value={form.issueType}
            onChange={(e) => setField('issueType', e.target.value)}
            className={selectClass}
          >
            <option value={ALL_TYPES}>All types</option>
            {ISSUE_TYPES.map((t) => (
              <option key={t} value={t}>{ISSUE_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </Field>

        <Field label="Transition name (optional)" htmlFor="wfm-t-name">
          <Input
            id="wfm-t-name"
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder='e.g. "Start work"'
            maxLength={80}
          />
        </Field>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Gates
            </span>
            <button
              type="button"
              data-testid="workflow-gate-add"
              onClick={addGate}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-signal-700 hover:bg-signal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
              </svg>
              Add gate
            </button>
          </div>

          {form.gates.length === 0 ? (
            <p className="py-2 text-xs text-slate-400">
              No gates — the transition is always allowed when the rule matches.
            </p>
          ) : (
            <ul className="space-y-2">
              {form.gates.map((gate) => (
                <GateEditor
                  key={gate.id}
                  gate={gate}
                  fieldOptions={fieldOptions}
                  onChange={(patch) => updateGate(gate.id, patch)}
                  onRemove={() => removeGate(gate.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Gate editor row (mirrors WorkflowSection)
// ---------------------------------------------------------------------------

function GateEditor({
  gate,
  fieldOptions,
  onChange,
  onRemove,
}: {
  gate: GateDraft;
  fieldOptions: GateFieldOption[];
  onChange: (patch: Partial<Omit<GateDraft, 'id'>>) => void;
  onRemove: () => void;
}) {
  // WF-2: known options + (if the stored value doesn't match anything known —
  // e.g. a legacy gate saved before this fix, or a custom field that's since
  // been deleted) a fallback entry so we never silently drop the current value.
  const knownValues = new Set(fieldOptions.map((o) => o.value));
  const showUnrecognized = gate.field !== '' && !knownValues.has(gate.field);

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <select
          aria-label="Gate type"
          value={gate.type}
          onChange={(e) => onChange({ type: e.target.value as WorkflowGateType })}
          className={cn(selectClass, 'flex-1')}
        >
          {WORKFLOW_GATE_TYPES.map((t) => (
            <option key={t} value={t}>{WORKFLOW_GATE_LABELS[t]}</option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Remove gate"
          onClick={onRemove}
          className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
          </svg>
        </button>
      </div>
      {gate.type === GATE_NEEDS_FIELD && (
        <select
          aria-label="Field"
          value={gate.field}
          onChange={(e) => onChange({ field: e.target.value })}
          className={selectClass}
        >
          <option value="">Select a field…</option>
          {showUnrecognized && (
            <option value={gate.field}>{gate.field} (unrecognized)</option>
          )}
          <optgroup label="Core fields">
            {CORE_GATE_FIELD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </optgroup>
          {fieldOptions.length > CORE_GATE_FIELD_OPTIONS.length && (
            <optgroup label="Custom fields">
              {fieldOptions
                .filter((o) => !CORE_GATE_FIELD_OPTIONS.some((c) => c.value === o.value))
                .map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
            </optgroup>
          )}
        </select>
      )}
      {gate.type === GATE_NEEDS_LINKTYPE && (
        <Input
          aria-label="Link type"
          value={gate.linkType}
          onChange={(e) => onChange({ linkType: e.target.value })}
          placeholder="e.g. BLOCKS"
          maxLength={80}
        />
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const selectClass =
  'h-9 w-full appearance-none rounded border border-ink-200 bg-surface px-3 pr-8 text-sm text-ink-900 ' +
  'transition-all duration-[120ms] hover:border-ink-300 ' +
  'focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-200 ' +
  "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 fill=%22none%22 viewBox=%220 0 24 24%22 stroke=%22%238b95a8%22 stroke-width=%222%22><path stroke-linecap=%22round%22 stroke-linejoin=%22round%22 d=%22M19 9l-7 7-7-7%22/></svg>')] bg-[length:14px] bg-[right_0.5rem_center] bg-no-repeat";

function WfIconButton({
  children,
  onClick,
  disabled,
  danger,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  'aria-label': string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded p-1.5 transition-colors duration-[120ms] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400',
        disabled
          ? 'cursor-not-allowed text-ink-300'
          : danger
            ? 'text-ink-400 hover:bg-red-50 hover:text-red-600'
            : 'text-ink-400 hover:bg-ink-100 hover:text-ink-700',
      )}
    >
      {children}
    </button>
  );
}

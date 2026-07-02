/**
 * WorkflowSection
 *
 * Shown on the project Settings page. ADMIN users can:
 *   - Toggle workflow enforcement on/off
 *   - View the transition graph (from-status → to-status, type scope, gates)
 *   - Add, edit, and delete transitions
 *
 * MEMBER/VIEWER see the current enforcement state and the transition list
 * read-only (no edit controls).
 */
import { useState, type FormEvent } from 'react';
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
  useWorkflow,
  useSetWorkflowEnforced,
  useCreateWorkflowTransition,
  useUpdateWorkflowTransition,
  useDeleteWorkflowTransition,
} from '@/api/workflow';
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  [IssueType.TASK]: 'Task',
  [IssueType.BUG]: 'Bug',
  [IssueType.STORY]: 'Story',
  [IssueType.EPIC]: 'Epic',
  [IssueType.SUBTASK]: 'Subtask',
};

const ANY_STATUS = '__ANY__';
const ALL_TYPES  = '__ALL__';

// Gates that require an extra text param
const GATE_NEEDS_FIELD    = WorkflowGateType.REQUIRE_FIELD;
const GATE_NEEDS_LINKTYPE = WorkflowGateType.REQUIRE_LINK;

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function WorkflowSection({
  projectId,
  statuses,
  isAdmin,
}: {
  projectId: string;
  statuses: StatusDto[];
  isAdmin: boolean;
}) {
  const workflowQuery = useWorkflow(projectId);
  const setEnforced   = useSetWorkflowEnforced(projectId);
  const deleteTransition = useDeleteWorkflowTransition(projectId);
  const customFieldsQuery = useCustomFields(projectId);
  const fieldOptions = buildGateFieldOptions(customFieldsQuery.data);
  const toast = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WorkflowTransitionDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowTransitionDto | null>(null);

  const workflow = workflowQuery.data;

  // Build a lookup so we can show status names.
  const statusById = new Map(statuses.map((s) => [s.id, s]));

  function handleToggleEnforced() {
    if (!workflow) return;
    setEnforced.mutate(
      { enforced: !workflow.enforced },
      {
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not change workflow enforcement.')),
      },
    );
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    deleteTransition.mutate(target.id, {
      onSuccess: () => {
        setDeleteTarget(null);
        toast.success('Transition deleted.');
      },
      onError: (err) => {
        setDeleteTarget(null);
        toast.error(errorMessage(err, 'Could not delete the transition.'));
      },
    });
  }

  // Group transitions by fromStatusId
  const grouped = groupTransitions(workflow?.transitions ?? []);

  return (
    <section
      data-testid="workflow-settings"
      className="rounded-xl border border-slate-200 bg-surface p-4 shadow-card sm:p-5"
    >
      {/* Section header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Legacy project-wide transitions</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Governs every status change that happens outside a board with its
            own assigned workflow — Triage, the issue drawer, and bulk edit.
            To restrict moves on a specific board instead, use the{' '}
            <a href="#workflows-manager" className="font-medium text-signal-700 underline hover:text-signal-800">
              Named Workflows
            </a>{' '}
            manager below.
          </p>
        </div>
        {isAdmin && workflow && (
          <Button
            size="sm"
            data-testid="workflow-add-transition"
            aria-label="Add legacy workflow transition"
            onClick={() => setAddOpen(true)}
          >
            + Add transition
          </Button>
        )}
      </div>

      {/* Loading / error */}
      {workflowQuery.isLoading ? (
        <LoadingState label="Loading workflow…" />
      ) : workflowQuery.isError ? (
        <ErrorState
          error={workflowQuery.error ?? new Error('Could not load workflow')}
          onRetry={() => workflowQuery.refetch()}
        />
      ) : workflow ? (
        <>
          {/* Enforcement toggle */}
          <EnforcementToggle
            enforced={workflow.enforced}
            loading={setEnforced.isPending}
            isAdmin={isAdmin}
            onToggle={handleToggleEnforced}
          />

          {/* Transition graph */}
          <div className="mt-4">
            {grouped.length === 0 ? (
              <p className="py-3 text-sm text-slate-400">
                {workflow.enforced
                  ? 'No transitions defined. Add one to start restricting moves.'
                  : 'No transitions defined — all moves are allowed while enforcement is off.'}
              </p>
            ) : (
              <div className="space-y-4">
                {grouped.map((group) => (
                  <TransitionGroup
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
                    onDelete={(t) => setDeleteTarget(t)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}

      {/* Add modal */}
      {addOpen && (
        <TransitionFormModal
          projectId={projectId}
          statuses={statuses}
          fieldOptions={fieldOptions}
          onClose={() => setAddOpen(false)}
        />
      )}

      {/* Edit modal */}
      {editTarget && (
        <TransitionFormModal
          projectId={projectId}
          statuses={statuses}
          fieldOptions={fieldOptions}
          existing={editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete transition"
        message={
          <>
            Delete this transition from{' '}
            <span className="font-medium text-slate-900">
              {deleteTarget?.fromStatusId
                ? (statusById.get(deleteTarget.fromStatusId)?.name ?? 'Unknown')
                : 'Any status'}
            </span>{' '}
            to{' '}
            <span className="font-medium text-slate-900">
              {deleteTarget?.toStatusId
                ? (statusById.get(deleteTarget.toStatusId)?.name ?? 'Unknown')
                : ''}
            </span>
            ? Issues will no longer be able to make this move when enforcement is on.
          </>
        }
        confirmLabel="Delete transition"
        variant="danger"
        loading={deleteTransition.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Enforcement toggle
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
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
      <div className="flex items-start gap-3">
        {/* Toggle switch */}
        <button
          type="button"
          role="switch"
          aria-checked={enforced}
          aria-label={enforced ? 'Enforcement on — click to disable' : 'Enforcement off — click to enable'}
          data-testid="workflow-enforce-toggle"
          disabled={!isAdmin || loading}
          onClick={onToggle}
          className={cn(
            'relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full',
            'transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-offset-1',
            enforced ? 'bg-signal-600' : 'bg-slate-300',
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

        {/* Label + description */}
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">
            {enforced ? 'Enforcement on' : 'Enforcement off'}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {enforced
              ? 'Only transitions listed below are allowed. Illegal moves return an error.'
              : 'Any status transition is permitted regardless of the list below.'}
          </p>
          {enforced && (
            <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700 border border-amber-100">
              When you first enable enforcement, a permissive set of all-pairs transitions is seeded automatically — prune the list to your actual process.
            </p>
          )}
          {!isAdmin && (
            <p className="mt-1 text-xs text-slate-400">Only admins can change enforcement.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grouped transition rows
// ---------------------------------------------------------------------------

interface TransitionGroup {
  fromStatusId: string | null;
  transitions: WorkflowTransitionDto[];
}

function groupTransitions(transitions: WorkflowTransitionDto[]): TransitionGroup[] {
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

  // Sort: "Any status" first, then the rest.
  const result: TransitionGroup[] = [];
  const anyGroup = map.get(ANY_STATUS);
  if (anyGroup) {
    result.push({ fromStatusId: null, transitions: anyGroup });
  }
  for (const [key, group] of map) {
    if (key !== ANY_STATUS) {
      result.push({ fromStatusId: key, transitions: group });
    }
  }
  return result;
}

function TransitionGroup({
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
            'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold',
            fromStatusId
              ? 'bg-slate-100 text-slate-700'
              : 'bg-signal-50 text-signal-700 border border-signal-100',
          )}
        >
          {fromStatusId ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" aria-hidden="true" />
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="text-slate-300">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </div>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
        {transitions.map((t) => {
          const toStatus = statusById.get(t.toStatusId);
          return (
            <li
              key={t.id}
              className="flex items-center gap-3 px-3 py-2.5"
              data-testid="workflow-transition-row"
            >
              {/* To status */}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-800 truncate">
                  {toStatus?.name ?? t.toStatusId}
                  {t.name && (
                    <span className="ml-1.5 font-normal text-slate-500">"{t.name}"</span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-slate-400">
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

              {/* Admin controls */}
              {isAdmin && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <WorkflowIconButton
                    aria-label={`Edit transition to ${toStatus?.name ?? t.toStatusId}`}
                    onClick={() => onEdit(t)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                  </WorkflowIconButton>
                  <WorkflowIconButton
                    aria-label={`Delete transition to ${toStatus?.name ?? t.toStatusId}`}
                    danger
                    onClick={() => onDelete(t)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" />
                    </svg>
                  </WorkflowIconButton>
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
        className="inline-flex items-center gap-0.5 rounded-sm bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200"
      >
        ⚠ {label} — misconfigured
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-0.5 rounded-sm bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 border border-brand-100">
      {label}
      {extra && <span className="font-normal opacity-75">: {extra}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Transition form modal (create + edit)
// ---------------------------------------------------------------------------

interface TransitionFormState {
  fromStatusId: string;   // ANY_STATUS or a real id
  toStatusId: string;
  issueType: string;      // ALL_TYPES or an IssueType
  name: string;
  gates: GateDraft[];
}

interface GateDraft {
  id: number;              // local key for the list
  type: WorkflowGateType;
  field: string;
  linkType: string;
}

let gateIdSeq = 0;
function nextGateId() { return ++gateIdSeq; }

function initState(
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

function TransitionFormModal({
  projectId,
  statuses,
  fieldOptions,
  existing,
  onClose,
}: {
  projectId: string;
  statuses: StatusDto[];
  fieldOptions: GateFieldOption[];
  existing?: WorkflowTransitionDto;
  onClose: () => void;
}) {
  const createTransition = useCreateWorkflowTransition(projectId);
  const updateTransition = useUpdateWorkflowTransition(projectId);
  const toast = useToast();

  const [form, setForm] = useState<TransitionFormState>(() =>
    initState(existing, statuses),
  );

  const isEdit = !!existing;
  const isPending = isEdit ? updateTransition.isPending : createTransition.isPending;

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
      if (g.type === GATE_NEEDS_FIELD && g.field.trim())    dto.field    = g.field.trim();
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
    const issueType    = form.issueType === ALL_TYPES ? null : (form.issueType as IssueType);

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
          onSuccess: () => {
            toast.success('Transition updated.');
            onClose();
          },
          onError: (err) => {
            const msg = err instanceof ApiError && err.status === 409
              ? 'An identical transition already exists.'
              : errorMessage(err, 'Could not update the transition.');
            toast.error(msg);
          },
        },
      );
    } else {
      createTransition.mutate(
        {
          fromStatusId,
          toStatusId: form.toStatusId,
          issueType,
          name: form.name.trim() || undefined,
          gates,
        },
        {
          onSuccess: () => {
            toast.success('Transition added.');
            onClose();
          },
          onError: (err) => {
            const msg = err instanceof ApiError && err.status === 409
              ? 'That transition already exists (same from / to / type).'
              : errorMessage(err, 'Could not create the transition.');
            toast.error(msg);
          },
        },
      );
    }
  }

  const canSubmit = !!form.toStatusId && !hasIncompleteGate;

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
            form="workflow-transition-form"
            loading={isPending}
            disabled={!canSubmit}
          >
            {isEdit ? 'Save changes' : 'Add transition'}
          </Button>
        </>
      }
    >
      <form
        id="workflow-transition-form"
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        {/* From status */}
        <Field label="From status" htmlFor="wf-from">
          <select
            id="wf-from"
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

        {/* To status */}
        <Field label="To status" htmlFor="wf-to">
          <select
            id="wf-to"
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

        {/* Issue type scope */}
        <Field label="Issue type" htmlFor="wf-type">
          <select
            id="wf-type"
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

        {/* Optional name */}
        <Field label="Transition name (optional)" htmlFor="wf-name">
          <Input
            id="wf-name"
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder='e.g. "Start work"'
            maxLength={80}
          />
        </Field>

        {/* Gates */}
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
              No gates — the transition is always allowed when the from/to rule matches.
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
// Gate editor row
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
    <li className="flex flex-col gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
      <div className="flex items-center gap-2">
        {/* Gate type */}
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
        {/* Remove */}
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

      {/* Field param */}
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

      {/* Link type param */}
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

function WorkflowIconButton({
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
        'rounded p-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
        disabled
          ? 'cursor-not-allowed text-slate-300'
          : danger
            ? 'text-slate-400 hover:bg-red-50 hover:text-red-600'
            : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
      )}
    >
      {children}
    </button>
  );
}

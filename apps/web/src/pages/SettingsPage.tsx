import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Role, StatusCategory, type StatusDto } from '@next-lane/shared';
import { useProject, useUpdateProject, useArchiveProject } from '@/api/projects';
import { useStatuses, useLabels } from '@/api/meta';
import { useUpdateStatus, useDeleteStatus } from '@/api/statuses';
import { useCreateLabel, useDeleteLabel, useUpdateLabel } from '@/api/labels';
import { useMyRole, useWorkspaceMembers } from '@/api/workspaces';
import { canEdit } from '@/lib/permissions';
import { AppHeader } from '@/components/AppHeader';
import { ProjectBreadcrumb } from '@/components/project/ProjectBreadcrumb';
import { ProjectNav } from '@/components/project/ProjectNav';
import { ColumnFormModal } from '@/components/board/ColumnFormModal';
import { WebhooksSection } from '@/components/settings/WebhooksSection';
import { ShareSection } from '@/components/settings/ShareSection';
import { CustomFieldsSection } from '@/components/settings/CustomFieldsSection';
import { ComponentsSection } from '@/components/settings/ComponentsSection';
import { TemplatesManager } from '@/components/settings/TemplatesManager';
import { VersionsSection } from '@/components/settings/VersionsSection';
import { WorkflowSection } from '@/components/settings/WorkflowSection';
import { WorkflowsManager } from '@/components/settings/WorkflowsManager';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Field } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/api/client';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

const CATEGORY_LABEL: Record<StatusCategory, string> = {
  [StatusCategory.TODO]: 'To Do',
  [StatusCategory.IN_PROGRESS]: 'In Progress',
  [StatusCategory.DONE]: 'Done',
};

const CATEGORY_DOT: Record<string, string> = {
  TODO: 'bg-gray-400',
  IN_PROGRESS: 'bg-blue-500',
  DONE: 'bg-green-500',
};

/** On-brand swatches offered when creating a new label (mirrors LabelPicker). */
const SWATCHES = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#64748b',
];

/**
 * Project settings: the configuration home for a project. Owns column (status)
 * management (moved off the board), the project's label set, project details
 * (name/description, with the immutable key shown read-only), and archiving.
 * The whole page is editable by ADMIN/MEMBER and read-only for VIEWER; the
 * destructive actions (archive, delete column/label) are restricted to ADMIN.
 */
export function SettingsPage() {
  const { projectId = '' } = useParams();
  const projectQuery = useProject(projectId);
  const project = projectQuery.data;
  const myRole = useMyRole(project?.workspaceId);
  const editable = canEdit(myRole);
  const isAdmin = myRole === Role.ADMIN;

  // Workspace members for the ComponentsSection default-assignee picker.
  const membersQuery = useWorkspaceMembers(project?.workspaceId);
  const workspaceUsers = (membersQuery.data ?? []).map((m) => m.user);

  // Statuses needed by WorkflowSection (shared with ColumnsSection internally).
  const statusesQuery = useStatuses(projectId);
  const statusesForWorkflow: StatusDto[] = useMemo(
    () =>
      statusesQuery.data
        ? [...statusesQuery.data].sort((a, b) => a.order - b.order)
        : [],
    [statusesQuery.data],
  );

  if (projectQuery.isLoading) {
    return (
      <Shell projectId={projectId} projectName={undefined}>
        <LoadingState label="Loading settings…" />
      </Shell>
    );
  }
  if (projectQuery.isError || !project) {
    return (
      <Shell projectId={projectId} projectName={undefined}>
        <ErrorState
          error={projectQuery.error ?? new Error('Project not found')}
          onRetry={() => projectQuery.refetch()}
        />
      </Shell>
    );
  }

  return (
    <Shell projectId={projectId} projectName={project.name}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Settings</h1>
            <p className="text-sm text-slate-500">
              Configure columns, labels, and details for this project.
            </p>
          </div>
          {!editable && (
            <span
              data-testid="readonly-hint"
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500"
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

        <DetailsSection
          projectId={projectId}
          projectKey={project.key}
          name={project.name}
          description={project.description}
          editable={editable}
        />

        <ColumnsSection projectId={projectId} editable={editable} isAdmin={isAdmin} />

        <LabelsSection projectId={projectId} editable={editable} isAdmin={isAdmin} />

        <ComponentsSection
          projectId={projectId}
          editable={editable}
          isAdmin={isAdmin}
          users={workspaceUsers}
        />

        <TemplatesManager
          projectId={projectId}
          isAdmin={isAdmin}
          users={workspaceUsers}
        />

        <VersionsSection
          projectId={projectId}
          isAdmin={isAdmin}
        />

        <CustomFieldsSection projectId={projectId} editable={editable} isAdmin={isAdmin} />

        <WorkflowSection
          projectId={projectId}
          statuses={statusesForWorkflow}
          isAdmin={isAdmin}
        />

        <WorkflowsManager
          projectId={projectId}
          statuses={statusesForWorkflow}
          isAdmin={isAdmin}
        />

        <WebhooksSection projectId={projectId} isAdmin={isAdmin} />

        {isAdmin && <ShareSection projectId={projectId} />}

        {editable && (
          <DangerZone
            projectId={projectId}
            projectName={project.name}
            archived={project.archived}
            isAdmin={isAdmin}
          />
        )}
      </div>
    </Shell>
  );
}

/** Card wrapper used for each settings section. */
function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-slate-500">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ details */

function DetailsSection({
  projectId,
  projectKey,
  name,
  description,
  editable,
}: {
  projectId: string;
  projectKey: string;
  name: string;
  description: string | null;
  editable: boolean;
}) {
  const update = useUpdateProject(projectId);
  const toast = useToast();
  const [draftName, setDraftName] = useState(name);
  const [draftDesc, setDraftDesc] = useState(description ?? '');

  // Re-seed when the server values change (e.g. realtime / refetch).
  useEffect(() => {
    setDraftName(name);
    setDraftDesc(description ?? '');
  }, [name, description]);

  const dirty =
    draftName.trim() !== name || draftDesc.trim() !== (description ?? '');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = draftName.trim();
    if (!trimmed) return;
    update.mutate(
      { name: trimmed, description: draftDesc.trim() },
      {
        onSuccess: () => toast.success('Project details saved.'),
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not save the project.')),
      },
    );
  }

  return (
    <Section title="Project details" description="The project key cannot be changed.">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Key" htmlFor="settings-key">
          <Input id="settings-key" value={projectKey} readOnly disabled />
        </Field>
        <Field label="Name" htmlFor="settings-name">
          <Input
            id="settings-name"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            disabled={!editable}
            maxLength={80}
            required
          />
        </Field>
        <Field label="Description" htmlFor="settings-description">
          <Textarea
            id="settings-description"
            value={draftDesc}
            onChange={(e) => setDraftDesc(e.target.value)}
            disabled={!editable}
            rows={3}
            maxLength={2000}
            placeholder="What is this project about?"
          />
        </Field>
        {editable && (
          <div className="flex justify-end">
            <Button
              type="submit"
              loading={update.isPending}
              disabled={!dirty || !draftName.trim()}
            >
              Save changes
            </Button>
          </div>
        )}
      </form>
    </Section>
  );
}

/* ------------------------------------------------------------------ columns */

function ColumnsSection({
  projectId,
  editable,
  isAdmin,
}: {
  projectId: string;
  editable: boolean;
  isAdmin: boolean;
}) {
  const statusesQuery = useStatuses(projectId);
  const updateStatus = useUpdateStatus(projectId);
  const deleteStatus = useDeleteStatus(projectId);
  const toast = useToast();

  const [columnModal, setColumnModal] = useState<
    { mode: 'add' } | { mode: 'edit'; status: StatusDto } | null
  >(null);
  const [columnToDelete, setColumnToDelete] = useState<StatusDto | null>(null);

  const statuses = useMemo<StatusDto[]>(
    () =>
      statusesQuery.data
        ? [...statusesQuery.data].sort((a, b) => a.order - b.order)
        : [],
    [statusesQuery.data],
  );

  // Reorder a column by swapping its `order` with the adjacent neighbor.
  function moveColumn(status: StatusDto, direction: 'up' | 'down') {
    const index = statuses.findIndex((s) => s.id === status.id);
    const neighbor = statuses[direction === 'up' ? index - 1 : index + 1];
    if (!neighbor) return;
    const onError = (err: Error) =>
      toast.error(errorMessage(err, 'Could not move that column.'));
    updateStatus.mutate({ id: status.id, order: neighbor.order }, { onError });
    updateStatus.mutate({ id: neighbor.id, order: status.order }, { onError });
  }

  function confirmDeleteColumn() {
    if (!columnToDelete) return;
    const target = columnToDelete;
    deleteStatus.mutate(target.id, {
      onSuccess: () => toast.success(`Deleted "${target.name}".`),
      onError: (err) => {
        const blocked = err instanceof ApiError && err.status === 400;
        toast.error(
          blocked
            ? 'Move or delete its issues first.'
            : errorMessage(err, 'Could not delete the column.'),
          { title: blocked ? `Can't delete "${target.name}"` : undefined },
        );
      },
      onSettled: () => setColumnToDelete(null),
    });
  }

  return (
    <Section
      title="Columns"
      description="Columns are the statuses shown on the board, left to right."
      action={
        editable ? (
          <Button size="sm" onClick={() => setColumnModal({ mode: 'add' })}>
            + Add column
          </Button>
        ) : undefined
      }
    >
      {statuses.length === 0 ? (
        <p className="py-4 text-sm text-slate-400">No columns yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {statuses.map((status, index) => (
            <li
              key={status.id}
              className="flex items-center gap-3 py-2.5"
              data-testid="settings-column-row"
            >
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  CATEGORY_DOT[status.category] ?? 'bg-gray-400',
                )}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                {status.name}
              </span>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                {CATEGORY_LABEL[status.category]}
              </span>
              {editable && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <IconButton
                    aria-label={`Move ${status.name} up`}
                    disabled={index === 0}
                    onClick={() => moveColumn(status, 'up')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 15l-6-6-6 6" />
                    </svg>
                  </IconButton>
                  <IconButton
                    aria-label={`Move ${status.name} down`}
                    disabled={index === statuses.length - 1}
                    onClick={() => moveColumn(status, 'down')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                    </svg>
                  </IconButton>
                  <IconButton
                    aria-label={`Edit ${status.name}`}
                    onClick={() => setColumnModal({ mode: 'edit', status })}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                  </IconButton>
                  {isAdmin && (
                    <IconButton
                      aria-label={`Delete ${status.name}`}
                      danger
                      onClick={() => setColumnToDelete(status)}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" />
                      </svg>
                    </IconButton>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {columnModal && (
        <ColumnFormModal
          open
          onClose={() => setColumnModal(null)}
          projectId={projectId}
          status={columnModal.mode === 'edit' ? columnModal.status : undefined}
        />
      )}

      <ConfirmDialog
        open={columnToDelete !== null}
        title="Delete column"
        message={
          <>
            Delete the column{' '}
            <span className="font-medium text-slate-900">
              {columnToDelete?.name}
            </span>
            ? Columns that still contain issues cannot be deleted — move or delete
            its issues first.
          </>
        }
        confirmLabel="Delete column"
        variant="danger"
        loading={deleteStatus.isPending}
        onConfirm={confirmDeleteColumn}
        onCancel={() => setColumnToDelete(null)}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------- labels */

/** Inline edit form for a single existing label (name + color swatch). */
function EditLabelForm({
  label,
  projectId,
  onDone,
}: {
  label: { id: string; name: string; color: string };
  projectId: string;
  onDone: () => void;
}) {
  const updateLabel = useUpdateLabel(projectId);
  const toast = useToast();
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(
    SWATCHES.includes(label.color) ? label.color : SWATCHES[5],
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    updateLabel.mutate(
      { labelId: label.id, input: { name: trimmed, color } },
      {
        onSuccess: () => {
          toast.success('Label updated.');
          onDone();
        },
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not update the label.')),
      },
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2"
      data-testid="edit-label-form"
    >
      <div className="min-w-[10rem] flex-1">
        <Input
          autoFocus
          value={name}
          aria-label="Label name"
          onChange={(e) => setName(e.target.value)}
          placeholder="Label name"
          maxLength={50}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onDone();
            }
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pb-1">
        {SWATCHES.map((s) => (
          <button
            key={s}
            type="button"
            aria-label={`Color ${s}`}
            aria-pressed={s === color}
            onClick={() => setColor(s)}
            style={{ backgroundColor: s }}
            className={cn(
              'h-5 w-5 rounded-full transition-transform focus:outline-none',
              s === color
                ? 'ring-2 ring-slate-900 ring-offset-1'
                : 'hover:scale-110',
            )}
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5 pb-1">
        <Button variant="ghost" size="sm" type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          type="submit"
          loading={updateLabel.isPending}
          disabled={!name.trim()}
        >
          Save
        </Button>
      </div>
    </form>
  );
}

function LabelsSection({
  projectId,
  editable,
  isAdmin,
}: {
  projectId: string;
  editable: boolean;
  isAdmin: boolean;
}) {
  const labelsQuery = useLabels(projectId);
  const createLabel = useCreateLabel(projectId);
  const deleteLabel = useDeleteLabel(projectId);
  const toast = useToast();

  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[5]);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const labels = labelsQuery.data ?? [];

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createLabel.mutate(
      { name: trimmed, color },
      {
        onSuccess: () => {
          toast.success('Label created.');
          setName('');
        },
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not create the label.')),
      },
    );
  }

  return (
    <Section
      title="Labels"
      description="Labels can be attached to issues to categorize work."
    >
      {labels.length === 0 ? (
        <p className="py-2 text-sm text-slate-400">No labels yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {labels.map((label) =>
            editingId === label.id ? (
              <li key={label.id}>
                <EditLabelForm
                  label={label}
                  projectId={projectId}
                  onDone={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li
                key={label.id}
                className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                data-testid="settings-label-row"
              >
                <Badge color={label.color}>{label.name}</Badge>
                <span className="flex-1" />
                {editable && (
                  <IconButton
                    aria-label={`Edit label ${label.name}`}
                    onClick={() => setEditingId(label.id)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                  </IconButton>
                )}
                {editable && isAdmin && (
                  <IconButton
                    aria-label={`Delete label ${label.name}`}
                    danger
                    onClick={() =>
                      setPendingDelete({ id: label.id, name: label.name })
                    }
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
                    </svg>
                  </IconButton>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {editable && (
        <form
          onSubmit={submit}
          className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4"
        >
          <div className="min-w-[12rem] flex-1">
            <Field label="New label" htmlFor="settings-label-name">
              <Input
                id="settings-label-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Label name"
                maxLength={40}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pb-2">
            {SWATCHES.map((s) => (
              <button
                key={s}
                type="button"
                aria-label={`Color ${s}`}
                aria-pressed={s === color}
                onClick={() => setColor(s)}
                style={{ backgroundColor: s }}
                className={cn(
                  'h-5 w-5 rounded-full transition-transform focus:outline-none',
                  s === color
                    ? 'ring-2 ring-slate-900 ring-offset-1'
                    : 'hover:scale-110',
                )}
              />
            ))}
          </div>
          <Button
            type="submit"
            loading={createLabel.isPending}
            disabled={!name.trim()}
          >
            Add label
          </Button>
        </form>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete label"
        message={
          <>
            Delete the label{' '}
            <span className="font-medium text-slate-900">
              {pendingDelete?.name}
            </span>
            ? It will be removed from every issue in this project.
          </>
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteLabel.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteLabel.mutate(pendingDelete.id, {
            onSuccess: () => {
              setPendingDelete(null);
              toast.success('Label deleted.');
            },
            onError: (err) => {
              setPendingDelete(null);
              toast.error(errorMessage(err, 'Could not delete the label.'));
            },
          });
        }}
      />
    </Section>
  );
}

/* ---------------------------------------------------------------- danger zone */

function DangerZone({
  projectId,
  projectName,
  archived,
  isAdmin,
}: {
  projectId: string;
  projectName: string;
  archived: boolean;
  isAdmin: boolean;
}) {
  const archive = useArchiveProject(projectId);
  const toast = useToast();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  if (archived) {
    return (
      <Section title="Archived" description="This project has been archived.">
        <p className="text-sm text-slate-500">
          Archived projects are hidden from active work.
        </p>
      </Section>
    );
  }

  if (!isAdmin) return null;

  return (
    <section className="rounded-xl border border-red-200 bg-white p-4 shadow-card sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-red-700">Danger zone</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Archiving hides the project from active work. This can be undone by
            an administrator.
          </p>
        </div>
        <Button
          variant="danger"
          onClick={() => setConfirming(true)}
          className="shrink-0"
        >
          Archive project
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Archive project"
        message={
          <>
            Archive{' '}
            <span className="font-medium text-slate-900">{projectName}</span>? It
            will be hidden from the projects list.
          </>
        }
        confirmLabel="Archive project"
        variant="danger"
        loading={archive.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          archive.mutate(undefined, {
            onSuccess: () => {
              toast.success(`Archived "${projectName}".`);
              navigate('/');
            },
            onError: (err) => {
              setConfirming(false);
              toast.error(errorMessage(err, 'Could not archive the project.'));
            },
          });
        }}
      />
    </section>
  );
}

/* ----------------------------------------------------------------- primitives */

function IconButton({
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

function Shell({
  children,
  projectId,
  projectName,
}: {
  children: React.ReactNode;
  projectId: string;
  projectName: string | undefined;
}) {
  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader>
        <ProjectBreadcrumb primary={projectName} />
      </AppHeader>
      <ProjectNav projectId={projectId} />
      <main className="flex flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}

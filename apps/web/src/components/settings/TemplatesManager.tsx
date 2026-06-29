/**
 * TemplatesManager
 *
 * Settings section for project issue templates. ADMINs can create/edit/delete;
 * MEMBERs see the list read-only.
 *
 * Mirrors ComponentsSection.tsx patterns: modal CRUD, ConfirmDialog, toast,
 * errorMessage.
 */
import { useState, type FormEvent } from 'react';
import {
  IssueType,
  Priority,
  ISSUE_TYPES,
  PRIORITIES,
  type IssueTemplateDto,
  type UserDto,
} from '@next-lane/shared';
import {
  useIssueTemplates,
  useCreateIssueTemplate,
  useUpdateIssueTemplate,
  useDeleteIssueTemplate,
} from '@/api/issue-templates';
import { useComponents } from '@/api/components';
import { useLabels } from '@/api/meta';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import { Textarea } from '@/components/ui/Textarea';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge } from '@/components/ui/Badge';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { IssueTypeIcon } from '@/components/issue/issueMeta';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Issue type + priority color maps for badges
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<IssueType, string> = {
  [IssueType.TASK]: '#3b82f6',
  [IssueType.BUG]: '#ef4444',
  [IssueType.STORY]: '#22c55e',
  [IssueType.EPIC]: '#a855f7',
  [IssueType.SUBTASK]: '#6b7280',
};

const PRIORITY_COLORS: Record<Priority, string> = {
  [Priority.HIGHEST]: '#dc2626',
  [Priority.HIGH]: '#ef4444',
  [Priority.MEDIUM]: '#f59e0b',
  [Priority.LOW]: '#3b82f6',
  [Priority.LOWEST]: '#6b7280',
};

function typeName(t: IssueType): string {
  return t.charAt(0) + t.slice(1).toLowerCase();
}

function priorityName(p: Priority): string {
  return p.charAt(0) + p.slice(1).toLowerCase();
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

export function TemplatesManager({
  projectId,
  isAdmin,
  users,
}: {
  projectId: string;
  isAdmin: boolean;
  users: UserDto[];
}) {
  const templatesQuery = useIssueTemplates(projectId);
  const deleteTemplate = useDeleteIssueTemplate(projectId);
  const toast = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IssueTemplateDto | null>(null);
  const [pendingDelete, setPendingDelete] = useState<IssueTemplateDto | null>(null);

  const templates = templatesQuery.data ?? [];

  function handleDeleteConfirm() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    deleteTemplate.mutate(target.id, {
      onSuccess: () => {
        setPendingDelete(null);
        toast.success(`Deleted template "${target.name}".`);
      },
      onError: (err) => {
        setPendingDelete(null);
        toast.error(errorMessage(err, 'Could not delete the template.'));
      },
    });
  }

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5"
      data-testid="templates-manager"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Issue Templates</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Pre-fill new issues with a fixed type, priority, assignee, and
            description. Members can use templates; only admins can manage them.
          </p>
        </div>
        {isAdmin && (
          <Button
            size="sm"
            data-testid="template-add"
            onClick={() => setAddOpen(true)}
          >
            + Add template
          </Button>
        )}
      </div>

      {templatesQuery.isLoading ? (
        <LoadingState label="Loading templates…" />
      ) : templatesQuery.isError ? (
        <ErrorState
          error={templatesQuery.error ?? new Error('Could not load templates')}
          onRetry={() => templatesQuery.refetch()}
        />
      ) : templates.length === 0 ? (
        <p className="py-4 text-sm text-slate-400">No templates yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {templates.map((tpl) => (
            <li
              key={tpl.id}
              className="flex items-center gap-3 py-2.5"
              data-testid="template-row"
            >
              {/* Type icon */}
              <IssueTypeIcon type={tpl.issueType} className="h-4 w-4 shrink-0" />

              {/* Name + meta */}
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-800">
                  {tpl.name}
                </span>
                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                  <Badge color={TYPE_COLORS[tpl.issueType]}>
                    {typeName(tpl.issueType)}
                  </Badge>
                  {tpl.priority && (
                    <Badge color={PRIORITY_COLORS[tpl.priority]}>
                      {priorityName(tpl.priority)}
                    </Badge>
                  )}
                  {tpl.defaultAssignee && (
                    <span className="text-xs text-slate-400">
                      Assignee: {tpl.defaultAssignee.name}
                    </span>
                  )}
                </div>
              </div>

              {isAdmin && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <TemplateIconButton
                    aria-label={`Edit ${tpl.name}`}
                    onClick={() => setEditTarget(tpl)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                  </TemplateIconButton>
                  <TemplateIconButton
                    aria-label={`Delete ${tpl.name}`}
                    danger
                    onClick={() => setPendingDelete(tpl)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" />
                    </svg>
                  </TemplateIconButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add template modal */}
      <AddTemplateModal
        open={addOpen}
        projectId={projectId}
        users={users}
        onClose={() => setAddOpen(false)}
      />

      {/* Edit template modal */}
      {editTarget && (
        <EditTemplateModal
          template={editTarget}
          projectId={projectId}
          users={users}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* Delete confirm dialog */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete template"
        message={
          <>
            Delete the template{' '}
            <span className="font-medium text-slate-900">
              {pendingDelete?.name}
            </span>
            ? Existing issues created from it are not affected.
          </>
        }
        confirmLabel="Delete template"
        variant="danger"
        loading={deleteTemplate.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared form fields component
// ---------------------------------------------------------------------------

function TemplateFormFields({
  formId,
  name,
  issueType,
  titleTemplate,
  descriptionTemplate,
  priority,
  defaultAssigneeId,
  componentId,
  selectedLabelIds,
  users,
  components,
  labels,
  onNameChange,
  onIssueTypeChange,
  onTitleTemplateChange,
  onDescriptionTemplateChange,
  onPriorityChange,
  onDefaultAssigneeIdChange,
  onComponentIdChange,
  onLabelToggle,
  onSubmit,
}: {
  formId: string;
  name: string;
  issueType: IssueType;
  titleTemplate: string;
  descriptionTemplate: string;
  priority: string;
  defaultAssigneeId: string;
  componentId: string;
  selectedLabelIds: string[];
  users: UserDto[];
  components: { id: string; name: string }[];
  labels: { id: string; name: string; color: string }[];
  onNameChange: (v: string) => void;
  onIssueTypeChange: (v: IssueType) => void;
  onTitleTemplateChange: (v: string) => void;
  onDescriptionTemplateChange: (v: string) => void;
  onPriorityChange: (v: string) => void;
  onDefaultAssigneeIdChange: (v: string) => void;
  onComponentIdChange: (v: string) => void;
  onLabelToggle: (id: string) => void;
  onSubmit: (e: FormEvent) => void;
}) {
  return (
    <form id={formId} onSubmit={onSubmit} className="space-y-4">
      <Field label="Template name" htmlFor={`${formId}-name`}>
        <Input
          id={`${formId}-name`}
          data-testid="template-name-input"
          autoFocus
          required
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Bug report"
          maxLength={100}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Issue type" htmlFor={`${formId}-type`}>
          <select
            id={`${formId}-type`}
            value={issueType}
            onChange={(e) => onIssueTypeChange(e.target.value as IssueType)}
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400"
          >
            {ISSUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {typeName(t)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Priority (optional)" htmlFor={`${formId}-priority`}>
          <select
            id={`${formId}-priority`}
            value={priority}
            onChange={(e) => onPriorityChange(e.target.value)}
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">No default</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {priorityName(p)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Title template (optional)" htmlFor={`${formId}-title`}>
        <Input
          id={`${formId}-title`}
          value={titleTemplate}
          onChange={(e) => onTitleTemplateChange(e.target.value)}
          placeholder="Pre-fill the issue title"
          maxLength={255}
        />
      </Field>

      <Field label="Description template (optional)" htmlFor={`${formId}-desc`}>
        <Textarea
          id={`${formId}-desc`}
          rows={4}
          value={descriptionTemplate}
          onChange={(e) => onDescriptionTemplateChange(e.target.value)}
          placeholder="Pre-fill the issue description"
          maxLength={10000}
        />
      </Field>

      <Field label="Default assignee (optional)" htmlFor={`${formId}-assignee`}>
        <select
          id={`${formId}-assignee`}
          value={defaultAssigneeId}
          onChange={(e) => onDefaultAssigneeIdChange(e.target.value)}
          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <option value="">None</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </Field>

      {components.length > 0 && (
        <Field label="Component (optional)" htmlFor={`${formId}-component`}>
          <select
            id={`${formId}-component`}
            value={componentId}
            onChange={(e) => onComponentIdChange(e.target.value)}
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">None</option>
            {components.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {labels.length > 0 && (
        <fieldset>
          <legend className="mb-1.5 block text-sm font-medium text-slate-700">
            Labels (optional)
          </legend>
          <div className="flex flex-wrap gap-2">
            {labels.map((lbl) => {
              const checked = selectedLabelIds.includes(lbl.id);
              return (
                <label
                  key={lbl.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
                    checked
                      ? 'border-brand-300 bg-brand-50 text-brand-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onLabelToggle(lbl.id)}
                    className="sr-only"
                  />
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: lbl.color }}
                  />
                  {lbl.name}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Add template modal
// ---------------------------------------------------------------------------

function AddTemplateModal({
  open,
  projectId,
  users,
  onClose,
}: {
  open: boolean;
  projectId: string;
  users: UserDto[];
  onClose: () => void;
}) {
  const createTemplate = useCreateIssueTemplate(projectId);
  const componentsQuery = useComponents(projectId);
  const labelsQuery = useLabels(projectId);
  const toast = useToast();

  const [name, setName] = useState('');
  const [issueType, setIssueType] = useState<IssueType>(IssueType.TASK);
  const [titleTemplate, setTitleTemplate] = useState('');
  const [descriptionTemplate, setDescriptionTemplate] = useState('');
  const [priority, setPriority] = useState('');
  const [defaultAssigneeId, setDefaultAssigneeId] = useState('');
  const [componentId, setComponentId] = useState('');
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);

  function reset() {
    setName('');
    setIssueType(IssueType.TASK);
    setTitleTemplate('');
    setDescriptionTemplate('');
    setPriority('');
    setDefaultAssigneeId('');
    setComponentId('');
    setSelectedLabelIds([]);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function toggleLabel(id: string) {
    setSelectedLabelIds((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id],
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    createTemplate.mutate(
      {
        name: trimmedName,
        issueType,
        titleTemplate: titleTemplate.trim() || undefined,
        descriptionTemplate: descriptionTemplate.trim() || undefined,
        priority: (priority as Priority) || undefined,
        defaultAssigneeId: defaultAssigneeId || undefined,
        componentId: componentId || undefined,
        labelIds: selectedLabelIds.length > 0 ? selectedLabelIds : undefined,
      },
      {
        onSuccess: () => {
          toast.success(`Created template "${trimmedName}".`);
          handleClose();
        },
        onError: (err) => {
          const isDuplicate = err instanceof ApiError && err.status === 409;
          toast.error(
            isDuplicate
              ? `A template named "${trimmedName}" already exists.`
              : errorMessage(err, 'Could not create the template.'),
          );
        },
      },
    );
  }

  const components = componentsQuery.data ?? [];
  const labels = labelsQuery.data ?? [];

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add issue template"
      size="max-w-lg"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="add-template-form"
            data-testid="template-save"
            loading={createTemplate.isPending}
            disabled={!name.trim()}
          >
            Create template
          </Button>
        </>
      }
    >
      <TemplateFormFields
        formId="add-template-form"
        name={name}
        issueType={issueType}
        titleTemplate={titleTemplate}
        descriptionTemplate={descriptionTemplate}
        priority={priority}
        defaultAssigneeId={defaultAssigneeId}
        componentId={componentId}
        selectedLabelIds={selectedLabelIds}
        users={users}
        components={components}
        labels={labels}
        onNameChange={setName}
        onIssueTypeChange={setIssueType}
        onTitleTemplateChange={setTitleTemplate}
        onDescriptionTemplateChange={setDescriptionTemplate}
        onPriorityChange={setPriority}
        onDefaultAssigneeIdChange={setDefaultAssigneeId}
        onComponentIdChange={setComponentId}
        onLabelToggle={toggleLabel}
        onSubmit={onSubmit}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Edit template modal
// ---------------------------------------------------------------------------

function EditTemplateModal({
  template,
  projectId,
  users,
  onClose,
}: {
  template: IssueTemplateDto;
  projectId: string;
  users: UserDto[];
  onClose: () => void;
}) {
  const updateTemplate = useUpdateIssueTemplate(projectId);
  const componentsQuery = useComponents(projectId);
  const labelsQuery = useLabels(projectId);
  const toast = useToast();

  const [name, setName] = useState(template.name);
  const [issueType, setIssueType] = useState<IssueType>(template.issueType);
  const [titleTemplate, setTitleTemplate] = useState(template.titleTemplate ?? '');
  const [descriptionTemplate, setDescriptionTemplate] = useState(
    template.descriptionTemplate ?? '',
  );
  const [priority, setPriority] = useState(template.priority ?? '');
  const [defaultAssigneeId, setDefaultAssigneeId] = useState(
    template.defaultAssignee?.id ?? '',
  );
  const [componentId, setComponentId] = useState(template.componentId ?? '');
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>(
    template.labelIds,
  );

  function toggleLabel(id: string) {
    setSelectedLabelIds((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id],
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    updateTemplate.mutate(
      {
        id: template.id,
        input: {
          name: trimmedName,
          issueType,
          titleTemplate: titleTemplate.trim() || null,
          descriptionTemplate: descriptionTemplate.trim() || null,
          priority: (priority as Priority) || null,
          defaultAssigneeId: defaultAssigneeId || null,
          componentId: componentId || null,
          labelIds: selectedLabelIds,
        },
      },
      {
        onSuccess: () => {
          toast.success('Template updated.');
          onClose();
        },
        onError: (err) => {
          const isDuplicate = err instanceof ApiError && err.status === 409;
          toast.error(
            isDuplicate
              ? `A template named "${trimmedName}" already exists.`
              : errorMessage(err, 'Could not update the template.'),
          );
        },
      },
    );
  }

  const components = componentsQuery.data ?? [];
  const labels = labelsQuery.data ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit template: ${template.name}`}
      size="max-w-lg"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="edit-template-form"
            data-testid="template-save"
            loading={updateTemplate.isPending}
            disabled={!name.trim()}
          >
            Save changes
          </Button>
        </>
      }
    >
      <TemplateFormFields
        formId="edit-template-form"
        name={name}
        issueType={issueType}
        titleTemplate={titleTemplate}
        descriptionTemplate={descriptionTemplate}
        priority={priority}
        defaultAssigneeId={defaultAssigneeId}
        componentId={componentId}
        selectedLabelIds={selectedLabelIds}
        users={users}
        components={components}
        labels={labels}
        onNameChange={setName}
        onIssueTypeChange={setIssueType}
        onTitleTemplateChange={setTitleTemplate}
        onDescriptionTemplateChange={setDescriptionTemplate}
        onPriorityChange={setPriority}
        onDefaultAssigneeIdChange={setDefaultAssigneeId}
        onComponentIdChange={setComponentId}
        onLabelToggle={toggleLabel}
        onSubmit={onSubmit}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Internal icon button (mirrors ComponentsSection)
// ---------------------------------------------------------------------------

function TemplateIconButton({
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

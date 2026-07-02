/**
 * CustomFieldsSection
 *
 * Displayed on the project Settings page. Lists all custom field definitions
 * for the project, lets MEMBER+ add new fields via a modal, and lets admins
 * delete existing ones. VIEWERs see the list read-only.
 */
import { useState, type FormEvent } from 'react';
import {
  CUSTOM_FIELD_TYPES,
  ISSUE_TYPES,
  CustomFieldType,
  IssueType,
  type CustomFieldDefinitionDto,
} from '@next-lane/shared';
import {
  useCustomFields,
  useCreateCustomField,
  useUpdateCustomField,
  useDeleteCustomField,
  type CreateCustomFieldInput,
} from '@/api/custom-fields';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

// Human-readable labels for each field type.
const TYPE_LABELS: Record<CustomFieldType, string> = {
  [CustomFieldType.TEXT]: 'Text',
  [CustomFieldType.NUMBER]: 'Number',
  [CustomFieldType.SELECT]: 'Select (single)',
  [CustomFieldType.MULTI_SELECT]: 'Multi-select',
  [CustomFieldType.DATE]: 'Date',
  [CustomFieldType.CHECKBOX]: 'Checkbox',
  [CustomFieldType.URL]: 'URL',
};

// Human-readable issue type labels.
const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  [IssueType.TASK]: 'Task',
  [IssueType.BUG]: 'Bug',
  [IssueType.STORY]: 'Story',
  [IssueType.EPIC]: 'Epic',
  [IssueType.SUBTASK]: 'Subtask',
};

// Whether a field type has configurable options.
function hasOptions(type: CustomFieldType): boolean {
  return (
    type === CustomFieldType.SELECT || type === CustomFieldType.MULTI_SELECT
  );
}

export function CustomFieldsSection({
  projectId,
  editable,
  isAdmin,
}: {
  projectId: string;
  editable: boolean;
  isAdmin: boolean;
}) {
  const fieldsQuery = useCustomFields(projectId);
  const createField = useCreateCustomField(projectId);
  const deleteField = useDeleteCustomField(projectId);
  const toast = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CustomFieldDefinitionDto | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] =
    useState<CustomFieldDefinitionDto | null>(null);

  const fields = fieldsQuery.data ?? [];

  function handleDeleteConfirm() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    deleteField.mutate(target.id, {
      onSuccess: () => {
        setPendingDelete(null);
        toast.success(`Deleted "${target.name}".`);
      },
      onError: (err) => {
        setPendingDelete(null);
        toast.error(errorMessage(err, 'Could not delete the field.'));
      },
    });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-surface p-4 shadow-card sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Custom fields
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Add typed fields to issues. Fields can be scoped to specific issue
            types.
          </p>
        </div>
        {editable && (
          <Button
            size="sm"
            data-testid="custom-field-add-button"
            onClick={() => setAddOpen(true)}
          >
            + Add field
          </Button>
        )}
      </div>

      {fieldsQuery.isLoading ? (
        <LoadingState label="Loading fields…" />
      ) : fieldsQuery.isError ? (
        <ErrorState
          error={fieldsQuery.error ?? new Error('Could not load fields')}
          onRetry={() => fieldsQuery.refetch()}
        />
      ) : fields.length === 0 ? (
        <p className="py-4 text-sm text-slate-400">No custom fields yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {fields.map((field) => (
            <li
              key={field.id}
              className="flex items-center gap-3 py-2.5"
              data-testid="custom-field-row"
            >
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-800">
                  {field.name}
                </span>
                <span className="text-xs text-slate-400">
                  {TYPE_LABELS[field.type]}
                  {field.appliesToTypes.length > 0 &&
                    ` · ${field.appliesToTypes.map((t) => ISSUE_TYPE_LABELS[t]).join(', ')}`}
                  {field.required && ' · Required'}
                  {field.showOnCard && ' · On card'}
                </span>
              </div>

              {editable && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <SettingsIconButton
                    aria-label={`Edit ${field.name}`}
                    onClick={() => setEditTarget(field)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                  </SettingsIconButton>
                  {isAdmin && (
                    <SettingsIconButton
                      aria-label={`Delete ${field.name}`}
                      danger
                      onClick={() => setPendingDelete(field)}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" />
                      </svg>
                    </SettingsIconButton>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add field modal */}
      <AddCustomFieldModal
        open={addOpen}
        onCreate={createField}
        onClose={() => setAddOpen(false)}
      />

      {/* Edit field modal */}
      {editTarget && (
        <EditCustomFieldModal
          field={editTarget}
          projectId={projectId}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete custom field"
        message={
          <>
            Delete the field{' '}
            <span className="font-medium text-slate-900">
              {pendingDelete?.name}
            </span>
            ? All values stored for this field will be permanently removed from
            every issue.
          </>
        }
        confirmLabel="Delete field"
        variant="danger"
        loading={deleteField.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Add field modal
// ---------------------------------------------------------------------------

function AddCustomFieldModal({
  open,
  onCreate,
  onClose,
}: {
  open: boolean;
  onCreate: ReturnType<typeof useCreateCustomField>;
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState<CustomFieldType>(CustomFieldType.TEXT);
  const [optionsRaw, setOptionsRaw] = useState('');
  const [appliesToTypes, setAppliesToTypes] = useState<IssueType[]>([]);
  const [required, setRequired] = useState(false);
  const [showOnCard, setShowOnCard] = useState(false);

  function reset() {
    setName('');
    setType(CustomFieldType.TEXT);
    setOptionsRaw('');
    setAppliesToTypes([]);
    setRequired(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function toggleIssueType(t: IssueType) {
    setAppliesToTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }

  function parseOptions(): string[] {
    return optionsRaw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const input: CreateCustomFieldInput = {
      name: trimmedName,
      type,
      appliesToTypes: appliesToTypes.length > 0 ? appliesToTypes : undefined,
      required: required || undefined,
      showOnCard: showOnCard || undefined,
    };
    if (hasOptions(type)) {
      input.options = parseOptions();
    }

    onCreate.mutate(input, {
      onSuccess: () => {
        toast.success(`Created field "${trimmedName}".`);
        handleClose();
      },
      onError: (err) =>
        toast.error(errorMessage(err, 'Could not create field.')),
    });
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add custom field"
      size="max-w-md"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="add-custom-field-form"
            loading={onCreate.isPending}
            disabled={!name.trim()}
          >
            Create field
          </Button>
        </>
      }
    >
      <form id="add-custom-field-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Field name" htmlFor="cf-name">
          <Input
            id="cf-name"
            data-testid="custom-field-name"
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Severity"
            maxLength={80}
          />
        </Field>

        <Field label="Field type" htmlFor="cf-type">
          <select
            id="cf-type"
            data-testid="custom-field-type"
            value={type}
            onChange={(e) => setType(e.target.value as CustomFieldType)}
            className="w-full rounded-md border border-slate-200 bg-surface px-2 py-1.5 text-sm text-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400"
          >
            {CUSTOM_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>

        {hasOptions(type) && (
          <Field
            label="Options (one per line)"
            htmlFor="cf-options"
            hint="Enter each selectable option on its own line."
          >
            <textarea
              id="cf-options"
              value={optionsRaw}
              onChange={(e) => setOptionsRaw(e.target.value)}
              rows={4}
              placeholder={"Option A\nOption B\nOption C"}
              className="w-full rounded-md border border-slate-200 bg-surface px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </Field>
        )}

        <fieldset>
          <legend className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Applies to issue types
          </legend>
          <p className="mb-2 text-xs text-slate-400">
            Leave all unchecked to apply to every issue type.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {ISSUE_TYPES.map((t) => (
              <label key={t} className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={appliesToTypes.includes(t)}
                  onChange={() => toggleIssueType(t)}
                  className="h-4 w-4 rounded border-slate-300 accent-brand-500"
                />
                {ISSUE_TYPE_LABELS[t]}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-brand-500"
          />
          Required field
        </label>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={showOnCard}
            onChange={(e) => setShowOnCard(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-brand-500"
          />
          Show on board cards
        </label>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Edit field modal
// ---------------------------------------------------------------------------

function EditCustomFieldModal({
  field,
  projectId,
  onClose,
}: {
  field: CustomFieldDefinitionDto;
  projectId: string;
  onClose: () => void;
}) {
  const updateField = useUpdateCustomField(projectId);
  const toast = useToast();
  const [name, setName] = useState(field.name);
  const [optionsRaw, setOptionsRaw] = useState(field.options.join('\n'));
  const [appliesToTypes, setAppliesToTypes] = useState<IssueType[]>(
    field.appliesToTypes,
  );
  const [required, setRequired] = useState(field.required);
  const [showOnCard, setShowOnCard] = useState(field.showOnCard);

  function toggleIssueType(t: IssueType) {
    setAppliesToTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }

  function parseOptions(): string[] {
    return optionsRaw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const patch: Parameters<typeof updateField.mutate>[0]['input'] = {
      name: trimmedName,
      appliesToTypes,
      required,
      showOnCard,
    };
    if (hasOptions(field.type)) {
      patch.options = parseOptions();
    }

    updateField.mutate(
      { id: field.id, input: patch },
      {
        onSuccess: () => {
          toast.success('Field updated.');
          onClose();
        },
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not update field.')),
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit field: ${field.name}`}
      size="max-w-md"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="edit-custom-field-form"
            loading={updateField.isPending}
            disabled={!name.trim()}
          >
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-custom-field-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Field name" htmlFor="ecf-name">
          <Input
            id="ecf-name"
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
        </Field>

        {/* Type is immutable — show read-only */}
        <Field label="Field type" htmlFor="ecf-type">
          <Input
            id="ecf-type"
            value={TYPE_LABELS[field.type]}
            readOnly
            disabled
          />
        </Field>

        {hasOptions(field.type) && (
          <Field
            label="Options (one per line)"
            htmlFor="ecf-options"
            hint="Enter each selectable option on its own line."
          >
            <textarea
              id="ecf-options"
              value={optionsRaw}
              onChange={(e) => setOptionsRaw(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-slate-200 bg-surface px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </Field>
        )}

        <fieldset>
          <legend className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Applies to issue types
          </legend>
          <p className="mb-2 text-xs text-slate-400">
            Leave all unchecked to apply to every issue type.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {ISSUE_TYPES.map((t) => (
              <label key={t} className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={appliesToTypes.includes(t)}
                  onChange={() => toggleIssueType(t)}
                  className="h-4 w-4 rounded border-slate-300 accent-brand-500"
                />
                {ISSUE_TYPE_LABELS[t]}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-brand-500"
          />
          Required field
        </label>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={showOnCard}
            onChange={(e) => setShowOnCard(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-brand-500"
          />
          Show on board cards
        </label>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Internal icon button (mirrors the one in SettingsPage)
// ---------------------------------------------------------------------------

function SettingsIconButton({
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

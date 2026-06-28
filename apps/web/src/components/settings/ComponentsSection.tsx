/**
 * ComponentsSection
 *
 * Displayed on the project Settings page. Lists all components for the project,
 * lets ADMINs create/edit/delete them. MEMBER/VIEWER see the list read-only.
 *
 * Mirrors CustomFieldsSection.tsx and LabelsSection in SettingsPage.tsx.
 */
import { useState, type FormEvent } from 'react';
import type { ComponentDto, UserDto } from '@next-lane/shared';
import {
  useComponents,
  useCreateComponent,
  useUpdateComponent,
  useDeleteComponent,
} from '@/api/components';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

export function ComponentsSection({
  projectId,
  isAdmin,
  users,
}: {
  projectId: string;
  /** Not currently used — kept for API parity with sibling sections. */
  editable?: boolean;
  isAdmin: boolean;
  /** Workspace co-members for the default-assignee picker. */
  users: UserDto[];
}) {
  const componentsQuery = useComponents(projectId);
  const createComponent = useCreateComponent(projectId);
  const deleteComponent = useDeleteComponent(projectId);
  const toast = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ComponentDto | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ComponentDto | null>(null);

  const components = componentsQuery.data ?? [];

  function handleDeleteConfirm() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    deleteComponent.mutate(target.id, {
      onSuccess: () => {
        setPendingDelete(null);
        toast.success(`Deleted "${target.name}".`);
      },
      onError: (err) => {
        setPendingDelete(null);
        toast.error(errorMessage(err, 'Could not delete the component.'));
      },
    });
  }

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5"
      data-testid="components-section"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Components</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Group issues by functional area. Optionally assign a default
            assignee to each component.
          </p>
        </div>
        {isAdmin && (
          <Button
            size="sm"
            data-testid="component-add"
            onClick={() => setAddOpen(true)}
          >
            + Add component
          </Button>
        )}
      </div>

      {componentsQuery.isLoading ? (
        <LoadingState label="Loading components…" />
      ) : componentsQuery.isError ? (
        <ErrorState
          error={componentsQuery.error ?? new Error('Could not load components')}
          onRetry={() => componentsQuery.refetch()}
        />
      ) : components.length === 0 ? (
        <p className="py-4 text-sm text-slate-400">No components yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {components.map((component) => (
            <li
              key={component.id}
              className="flex items-center gap-3 py-2.5"
              data-testid="component-row"
            >
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-800">
                  {component.name}
                </span>
                {(component.description || component.defaultAssignee) && (
                  <span className="text-xs text-slate-400">
                    {component.description}
                    {component.description && component.defaultAssignee && ' · '}
                    {component.defaultAssignee && (
                      <>Default: {component.defaultAssignee.name}</>
                    )}
                  </span>
                )}
              </div>

              {isAdmin && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <ComponentIconButton
                    aria-label={`Edit ${component.name}`}
                    onClick={() => setEditTarget(component)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                  </ComponentIconButton>
                  <ComponentIconButton
                    aria-label={`Delete ${component.name}`}
                    danger
                    onClick={() => setPendingDelete(component)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" />
                    </svg>
                  </ComponentIconButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add component modal */}
      <AddComponentModal
        open={addOpen}
        users={users}
        onCreate={createComponent}
        onClose={() => setAddOpen(false)}
      />

      {/* Edit component modal */}
      {editTarget && (
        <EditComponentModal
          component={editTarget}
          projectId={projectId}
          users={users}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* Delete confirm dialog */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete component"
        message={
          <>
            Delete the component{' '}
            <span className="font-medium text-slate-900">
              {pendingDelete?.name}
            </span>
            ? Issues assigned to this component will have their component
            cleared.
          </>
        }
        confirmLabel="Delete component"
        variant="danger"
        loading={deleteComponent.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Add component modal
// ---------------------------------------------------------------------------

function AddComponentModal({
  open,
  users,
  onCreate,
  onClose,
}: {
  open: boolean;
  users: UserDto[];
  onCreate: ReturnType<typeof useCreateComponent>;
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [defaultAssigneeId, setDefaultAssigneeId] = useState('');

  function reset() {
    setName('');
    setDescription('');
    setDefaultAssigneeId('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    onCreate.mutate(
      {
        name: trimmedName,
        description: description.trim() || undefined,
        defaultAssigneeId: defaultAssigneeId || undefined,
      },
      {
        onSuccess: () => {
          toast.success(`Created component "${trimmedName}".`);
          handleClose();
        },
        onError: (err) => {
          const isDuplicate =
            err instanceof ApiError && err.status === 409;
          toast.error(
            isDuplicate
              ? `A component named "${trimmedName}" already exists.`
              : errorMessage(err, 'Could not create the component.'),
          );
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add component"
      size="max-w-md"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="add-component-form"
            data-testid="component-save"
            loading={onCreate.isPending}
            disabled={!name.trim()}
          >
            Create component
          </Button>
        </>
      }
    >
      <form id="add-component-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" htmlFor="comp-name">
          <Input
            id="comp-name"
            data-testid="component-name-input"
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Authentication"
            maxLength={100}
          />
        </Field>

        <Field label="Description" htmlFor="comp-desc">
          <Input
            id="comp-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional short description"
            maxLength={255}
          />
        </Field>

        <Field label="Default assignee" htmlFor="comp-assignee">
          <select
            id="comp-assignee"
            value={defaultAssigneeId}
            onChange={(e) => setDefaultAssigneeId(e.target.value)}
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
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Edit component modal
// ---------------------------------------------------------------------------

function EditComponentModal({
  component,
  projectId,
  users,
  onClose,
}: {
  component: ComponentDto;
  projectId: string;
  users: UserDto[];
  onClose: () => void;
}) {
  const updateComponent = useUpdateComponent(projectId);
  const toast = useToast();
  const [name, setName] = useState(component.name);
  const [description, setDescription] = useState(component.description ?? '');
  const [defaultAssigneeId, setDefaultAssigneeId] = useState(
    component.defaultAssignee?.id ?? '',
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    updateComponent.mutate(
      {
        id: component.id,
        input: {
          name: trimmedName,
          description: description.trim() || null,
          defaultAssigneeId: defaultAssigneeId || null,
        },
      },
      {
        onSuccess: () => {
          toast.success('Component updated.');
          onClose();
        },
        onError: (err) => {
          const isDuplicate =
            err instanceof ApiError && err.status === 409;
          toast.error(
            isDuplicate
              ? `A component named "${trimmedName}" already exists.`
              : errorMessage(err, 'Could not update the component.'),
          );
        },
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit component: ${component.name}`}
      size="max-w-md"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="edit-component-form"
            data-testid="component-save"
            loading={updateComponent.isPending}
            disabled={!name.trim()}
          >
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-component-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" htmlFor="ecomp-name">
          <Input
            id="ecomp-name"
            data-testid="component-name-input"
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
        </Field>

        <Field label="Description" htmlFor="ecomp-desc">
          <Input
            id="ecomp-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional short description"
            maxLength={255}
          />
        </Field>

        <Field label="Default assignee" htmlFor="ecomp-assignee">
          <select
            id="ecomp-assignee"
            value={defaultAssigneeId}
            onChange={(e) => setDefaultAssigneeId(e.target.value)}
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
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Internal icon button (mirrors SettingsPage IconButton / CustomFieldsSection SettingsIconButton)
// ---------------------------------------------------------------------------

function ComponentIconButton({
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

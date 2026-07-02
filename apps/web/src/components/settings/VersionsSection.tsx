/**
 * VersionsSection
 *
 * Displayed on the project Settings page. Lists all versions/releases for the
 * project, lets ADMINs create/edit/delete them and perform state transitions
 * (Release, Archive). MEMBER/VIEWER see the list read-only.
 *
 * Mirrors ComponentsSection.tsx.
 */
import { useState, type FormEvent } from 'react';
import {
  VersionState,
  VERSION_STATE_LABELS,
  type VersionDto,
} from '@next-lane/shared';
import {
  useVersions,
  useCreateVersion,
  useUpdateVersion,
  useDeleteVersion,
} from '@/api/versions';
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

// ---------------------------------------------------------------------------
// State badge
// ---------------------------------------------------------------------------

function VersionStateBadge({ state }: { state: VersionState }) {
  const label = VERSION_STATE_LABELS[state];

  const cls =
    state === VersionState.RELEASED
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : state === VersionState.ARCHIVED
        ? 'bg-ink-100 text-ink-500 ring-ink-200'
        : 'bg-ink-50 text-ink-600 ring-ink-200';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-semibold leading-none tracking-wide ring-1 ring-inset',
        cls,
      )}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Public section component
// ---------------------------------------------------------------------------

export function VersionsSection({
  projectId,
  isAdmin,
}: {
  projectId: string;
  isAdmin: boolean;
}) {
  const versionsQuery = useVersions(projectId);
  const createVersion = useCreateVersion(projectId);
  const updateVersion = useUpdateVersion(projectId);
  const deleteVersion = useDeleteVersion(projectId);
  const toast = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<VersionDto | null>(null);
  const [pendingDelete, setPendingDelete] = useState<VersionDto | null>(null);

  const versions = versionsQuery.data ?? [];

  function handleStateTransition(
    version: VersionDto,
    newState: VersionState,
  ) {
    updateVersion.mutate(
      { id: version.id, input: { state: newState } },
      {
        onSuccess: () => {
          toast.success(
            newState === VersionState.RELEASED
              ? `Released "${version.name}".`
              : `Archived "${version.name}".`,
          );
        },
        onError: (err) => {
          toast.error(errorMessage(err, 'Could not update the version state.'));
        },
      },
    );
  }

  function handleDeleteConfirm() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    deleteVersion.mutate(target.id, {
      onSuccess: () => {
        setPendingDelete(null);
        toast.success(`Deleted "${target.name}".`);
      },
      onError: (err) => {
        setPendingDelete(null);
        toast.error(errorMessage(err, 'Could not delete the version.'));
      },
    });
  }

  return (
    <section
      className="rounded-xl border border-ink-200 bg-surface p-4 shadow-card sm:p-5"
      data-testid="versions-section"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">
            Versions / Releases
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Track planned and shipped releases. Assign issues to target versions.
          </p>
        </div>
        {isAdmin && (
          <Button
            size="sm"
            data-testid="version-add"
            onClick={() => setAddOpen(true)}
          >
            Add version
          </Button>
        )}
      </div>

      {versionsQuery.isLoading ? (
        <LoadingState label="Loading versions…" />
      ) : versionsQuery.isError ? (
        <ErrorState
          error={
            versionsQuery.error ?? new Error('Could not load versions')
          }
          onRetry={() => versionsQuery.refetch()}
        />
      ) : versions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-ink-200 py-10 text-center">
          <svg className="h-8 w-8 text-ink-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 13.5l3 3m0 0l3-3m-3 3v-6m1.06-4.19l-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
          </svg>
          <p className="text-sm font-medium text-ink-600">No versions yet</p>
          {isAdmin && (
            <p className="text-xs text-ink-400">Add a version to track milestones and planned releases for your project.</p>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-ink-100">
          {versions.map((version) => (
            <li
              key={version.id}
              className="flex flex-wrap items-center gap-2 py-2.5 sm:flex-nowrap"
              data-testid="version-row"
            >
              {/* Name + description */}
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink-800">
                  {version.name}
                </span>
                {version.description && (
                  <span className="text-xs text-ink-400">
                    {version.description}
                  </span>
                )}
              </div>

              {/* Metadata chips */}
              <div className="flex shrink-0 items-center gap-2">
                <VersionStateBadge state={version.state} />

                {typeof version.issueCount === 'number' && (
                  <span className="font-mono text-[10px] text-ink-400">
                    {version.issueCount}i
                  </span>
                )}

                {version.releaseDate && (
                  <span className="text-xs text-ink-400">
                    {new Date(version.releaseDate).toLocaleDateString(
                      undefined,
                      { year: 'numeric', month: 'short', day: 'numeric' },
                    )}
                  </span>
                )}
              </div>

              {/* Admin action buttons */}
              {isAdmin && (
                <div className="flex shrink-0 items-center gap-0.5">
                  {/* Release action — only for UNRELEASED */}
                  {version.state === VersionState.UNRELEASED && (
                    <VersionIconButton
                      aria-label={`Release ${version.name}`}
                      data-testid="version-release"
                      onClick={() =>
                        handleStateTransition(version, VersionState.RELEASED)
                      }
                    >
                      {/* Rocket / checkmark icon */}
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </VersionIconButton>
                  )}

                  {/* Archive action — for UNRELEASED and RELEASED */}
                  {version.state !== VersionState.ARCHIVED && (
                    <VersionIconButton
                      aria-label={`Archive ${version.name}`}
                      onClick={() =>
                        handleStateTransition(version, VersionState.ARCHIVED)
                      }
                    >
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8"
                        />
                      </svg>
                    </VersionIconButton>
                  )}

                  {/* Edit */}
                  <VersionIconButton
                    aria-label={`Edit ${version.name}`}
                    onClick={() => setEditTarget(version)}
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"
                      />
                    </svg>
                  </VersionIconButton>

                  {/* Delete */}
                  <VersionIconButton
                    aria-label={`Delete ${version.name}`}
                    danger
                    onClick={() => setPendingDelete(version)}
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6"
                      />
                    </svg>
                  </VersionIconButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add version modal */}
      <AddVersionModal
        open={addOpen}
        onCreate={createVersion}
        onClose={() => setAddOpen(false)}
      />

      {/* Edit version modal */}
      {editTarget && (
        <EditVersionModal
          version={editTarget}
          projectId={projectId}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* Delete confirm dialog */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete version"
        message={
          <>
            Delete the version{' '}
            <span className="font-medium text-slate-900">
              {pendingDelete?.name}
            </span>
            ? Issues targeting this version will have it removed.
          </>
        }
        confirmLabel="Delete version"
        variant="danger"
        loading={deleteVersion.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Add version modal
// ---------------------------------------------------------------------------

function AddVersionModal({
  open,
  onCreate,
  onClose,
}: {
  open: boolean;
  onCreate: ReturnType<typeof useCreateVersion>;
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [releaseDate, setReleaseDate] = useState('');

  function reset() {
    setName('');
    setDescription('');
    setReleaseDate('');
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
        releaseDate: releaseDate || undefined,
      },
      {
        onSuccess: () => {
          toast.success(`Created version "${trimmedName}".`);
          handleClose();
        },
        onError: (err) => {
          const isDuplicate = err instanceof ApiError && err.status === 409;
          toast.error(
            isDuplicate
              ? `A version named "${trimmedName}" already exists.`
              : errorMessage(err, 'Could not create the version.'),
          );
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add version"
      size="max-w-md"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="add-version-form"
            data-testid="version-save"
            loading={onCreate.isPending}
            disabled={!name.trim()}
          >
            Create version
          </Button>
        </>
      }
    >
      <form id="add-version-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" htmlFor="ver-name">
          <Input
            id="ver-name"
            data-testid="version-name-input"
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. v1.2.0"
            maxLength={100}
          />
        </Field>

        <Field label="Description" htmlFor="ver-desc">
          <Input
            id="ver-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            maxLength={255}
          />
        </Field>

        <Field label="Release date" htmlFor="ver-date">
          <input
            id="ver-date"
            type="date"
            aria-label="Release date"
            value={releaseDate}
            onChange={(e) => setReleaseDate(e.target.value)}
            className="rounded border border-ink-200 bg-surface px-2 py-1.5 text-sm text-ink-800 transition-colors duration-[120ms] hover:border-ink-300 focus:border-signal-400 focus:outline-none focus:ring-2 focus:ring-signal-200"
          />
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Edit version modal
// ---------------------------------------------------------------------------

function EditVersionModal({
  version,
  projectId,
  onClose,
}: {
  version: VersionDto;
  projectId: string;
  onClose: () => void;
}) {
  const updateVersion = useUpdateVersion(projectId);
  const toast = useToast();
  const [name, setName] = useState(version.name);
  const [description, setDescription] = useState(version.description ?? '');
  const [releaseDate, setReleaseDate] = useState(
    version.releaseDate ? version.releaseDate.slice(0, 10) : '',
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    updateVersion.mutate(
      {
        id: version.id,
        input: {
          name: trimmedName,
          description: description.trim() || null,
          releaseDate: releaseDate || null,
        },
      },
      {
        onSuccess: () => {
          toast.success('Version updated.');
          onClose();
        },
        onError: (err) => {
          const isDuplicate = err instanceof ApiError && err.status === 409;
          toast.error(
            isDuplicate
              ? `A version named "${trimmedName}" already exists.`
              : errorMessage(err, 'Could not update the version.'),
          );
        },
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit version: ${version.name}`}
      size="max-w-md"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="edit-version-form"
            data-testid="version-save"
            loading={updateVersion.isPending}
            disabled={!name.trim()}
          >
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-version-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" htmlFor="ever-name">
          <Input
            id="ever-name"
            data-testid="version-name-input"
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
        </Field>

        <Field label="Description" htmlFor="ever-desc">
          <Input
            id="ever-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            maxLength={255}
          />
        </Field>

        <Field label="Release date" htmlFor="ever-date">
          <input
            id="ever-date"
            type="date"
            aria-label="Release date"
            value={releaseDate}
            onChange={(e) => setReleaseDate(e.target.value)}
            className="rounded border border-ink-200 bg-surface px-2 py-1.5 text-sm text-ink-800 transition-colors duration-[120ms] hover:border-ink-300 focus:border-signal-400 focus:outline-none focus:ring-2 focus:ring-signal-200"
          />
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Internal icon button (mirrors ComponentIconButton)
// ---------------------------------------------------------------------------

function VersionIconButton({
  children,
  onClick,
  disabled,
  danger,
  'aria-label': ariaLabel,
  'data-testid': dataTestId,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  'aria-label': string;
  'data-testid'?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      data-testid={dataTestId}
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

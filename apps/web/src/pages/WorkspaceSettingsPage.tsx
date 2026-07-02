/**
 * Workspace General settings — rename + danger zone (delete workspace).
 *
 * Admin-gated: non-admins see a read-only note.
 *
 * Route: /workspaces/:workspaceId/settings
 */
import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Role } from '@next-lane/shared';
import { AppHeader } from '@/components/AppHeader';
import { WorkspaceSettingsNav } from '@/components/WorkspaceSettingsNav';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import {
  useWorkspaces,
  useMyRole,
  useUpdateWorkspaceBranding,
  useDeleteWorkspace,
} from '@/api/workspaces';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { errorMessage } from '@/lib/errorMessage';

// ── Delete dialog (type-to-confirm) ──────────────────────────────────────────

function DeleteWorkspaceDialog({
  workspaceName,
  onConfirm,
  onCancel,
  loading,
}: {
  workspaceName: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [typed, setTyped] = useState('');
  const matches = typed === workspaceName;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-ws-dialog-title"
      data-testid="delete-workspace-dialog"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-ink-200 bg-white p-6 shadow-xl">
        <h2
          id="delete-ws-dialog-title"
          className="mb-2 text-base font-semibold text-ink-900"
        >
          Delete workspace
        </h2>
        <p className="mb-4 text-sm text-ink-600">
          This permanently deletes{' '}
          <span className="font-semibold text-ink-900">{workspaceName}</span>{' '}
          and all its projects, boards, and issues. This action cannot be undone.
        </p>
        <Field
          label={
            <>
              Type{' '}
              <span className="font-mono font-semibold text-ink-900">
                {workspaceName}
              </span>{' '}
              to confirm:
            </>
          }
          htmlFor="delete-ws-confirm-input"
        >
          <Input
            id="delete-ws-confirm-input"
            data-testid="delete-workspace-confirm-input"
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={workspaceName}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={!matches || loading}
            loading={loading}
            data-testid="delete-workspace-confirm-button"
          >
            Delete workspace
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function WorkspaceSettingsPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const myRole = useMyRole(workspaceId);
  const isAdmin = myRole === Role.ADMIN;

  const workspacesQuery = useWorkspaces();
  const workspace = workspacesQuery.data?.find((w) => w.id === workspaceId);
  const workspaceName = workspace?.name;

  const { workspaces, setActiveWorkspaceId } = useWorkspaceContext();

  // ── Rename ────────────────────────────────────────────────────────────────

  const [nameValue, setNameValue] = useState('');
  useEffect(() => {
    if (workspaceName !== undefined) setNameValue(workspaceName);
  }, [workspaceName]);

  const updateBranding = useUpdateWorkspaceBranding(workspaceId);

  function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nameValue.trim();
    if (!trimmed) return;
    updateBranding.mutate(
      { name: trimmed },
      {
        onSuccess: () => toast.success('Workspace name updated.'),
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not update workspace name.')),
      },
    );
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const deleteWorkspace = useDeleteWorkspace(workspaceId);

  function handleDelete() {
    deleteWorkspace.mutate(undefined, {
      onSuccess: () => {
        setShowDeleteDialog(false);
        // Switch to another workspace if this was the active one.
        const remaining = workspaces.filter((w) => w.id !== workspaceId);
        if (remaining.length > 0) {
          setActiveWorkspaceId(remaining[0].id);
        }
        toast.success('Workspace deleted.');
        navigate('/');
      },
      onError: (err) => {
        setShowDeleteDialog(false);
        toast.error(errorMessage(err, 'Could not delete workspace.'));
      },
    });
  }

  // ── Loading / error guards ────────────────────────────────────────────────

  if (myRole === null && workspacesQuery.isLoading) {
    return (
      <Shell workspaceName={workspaceName} workspaceId={workspaceId}>
        <LoadingState label="Loading…" />
      </Shell>
    );
  }

  if (myRole === null && workspacesQuery.isError) {
    return (
      <Shell workspaceName={workspaceName} workspaceId={workspaceId}>
        <ErrorState
          error={workspacesQuery.error}
          onRetry={() => void workspacesQuery.refetch()}
        />
      </Shell>
    );
  }

  // ── Non-admin read-only view ──────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <Shell workspaceName={workspaceName} workspaceId={workspaceId}>
        <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
          <div className="mb-5">
            <h1 className="text-lg font-semibold text-ink-900">
              General settings
            </h1>
          </div>
          <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
            <p className="text-sm text-ink-500">
              Workspace name:{' '}
              <span className="font-semibold text-ink-900">
                {workspaceName ?? '—'}
              </span>
            </p>
            <p className="mt-3 text-xs text-ink-400">
              Only workspace administrators can change settings.
            </p>
          </section>
        </div>
      </Shell>
    );
  }

  // ── Admin view ────────────────────────────────────────────────────────────

  return (
    <Shell workspaceName={workspaceName} workspaceId={workspaceId}>
      <div
        className="mx-auto w-full max-w-3xl p-4 sm:p-6"
        data-testid="workspace-settings-page"
      >
        <div className="mb-5">
          <h1 className="text-lg font-semibold text-ink-900">
            General settings
          </h1>
          <p className="mt-0.5 text-sm text-ink-500">
            Rename the workspace or manage dangerous operations.
          </p>
        </div>

        <div className="space-y-5">
          {/* Name section */}
          <section
            className="rounded-xl border border-ink-200 bg-white p-5 shadow-card"
            aria-labelledby="ws-name-heading"
          >
            <h2
              id="ws-name-heading"
              className="mb-1 text-sm font-semibold text-ink-900"
            >
              Workspace name
            </h2>
            <p className="mb-4 text-sm text-ink-500">
              This name appears in the header and across all projects.
            </p>
            <form onSubmit={handleSaveName} className="flex items-end gap-3">
              <div className="min-w-0 flex-1">
                <Field label="Name" htmlFor="workspace-name-input">
                  <Input
                    id="workspace-name-input"
                    data-testid="workspace-name-input"
                    type="text"
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    placeholder="My workspace"
                    required
                    maxLength={80}
                  />
                </Field>
              </div>
              <Button
                type="submit"
                loading={updateBranding.isPending}
                disabled={
                  !nameValue.trim() ||
                  nameValue.trim() === workspaceName ||
                  updateBranding.isPending
                }
                data-testid="workspace-name-save"
              >
                Save
              </Button>
            </form>
          </section>

          {/* Danger zone */}
          <section
            className="rounded-xl border border-red-200 bg-white p-5"
            aria-labelledby="danger-zone-heading"
            data-testid="workspace-danger-zone"
          >
            <h2
              id="danger-zone-heading"
              className="mb-1 text-sm font-semibold text-red-700"
            >
              Danger zone
            </h2>
            <p className="mb-4 text-sm text-ink-500">
              Destructive actions that cannot be undone.
            </p>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-ink-900">
                  Delete this workspace
                </p>
                <p className="text-xs text-ink-500">
                  Permanently deletes all projects, boards, and issues. There is
                  no way to recover this data.
                </p>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setShowDeleteDialog(true)}
                data-testid="delete-workspace-button"
              >
                Delete workspace
              </Button>
            </div>
          </section>
        </div>
      </div>

      {showDeleteDialog && workspaceName && (
        <DeleteWorkspaceDialog
          workspaceName={workspaceName}
          loading={deleteWorkspace.isPending}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteDialog(false)}
        />
      )}
    </Shell>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────

function Shell({
  children,
  workspaceName,
  workspaceId,
}: {
  children: React.ReactNode;
  workspaceName: string | undefined;
  workspaceId: string;
}) {
  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader>
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <Link
            to="/"
            className="shrink-0 text-sm text-ink-400 hover:text-ink-600"
            aria-label="Back to dashboard"
          >
            Dashboard
          </Link>
          <span className="shrink-0 text-ink-300">/</span>
          <span className="min-w-0 truncate text-sm text-ink-500">
            {workspaceName ?? 'Workspace'}
          </span>
          <span className="shrink-0 text-ink-300">/</span>
          <span className="shrink-0 text-sm font-semibold text-ink-900">
            Settings
          </span>
        </div>
      </AppHeader>
      <WorkspaceSettingsNav workspaceId={workspaceId} />
      <main className="flex flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}

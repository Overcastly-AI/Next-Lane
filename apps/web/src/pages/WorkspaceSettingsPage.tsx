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
import { PageTemplatesSection } from '@/components/settings/PageTemplatesSection';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import {
  useWorkspaces,
  useWorkspaceMembers,
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
      <div className="relative z-10 w-full max-w-md rounded-xl border border-ink-200 bg-surface p-6 shadow-xl">
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
  // `myRole` is derived from the membership list, so it reads `null` while that
  // query is in flight — indistinguishable from "not a member". Hold the
  // loading state until it settles, or an admin sees the non-admin view flash.
  const membersQuery = useWorkspaceMembers(workspaceId);

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

  if (myRole === null && (workspacesQuery.isLoading || membersQuery.isLoading)) {
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

  // ── Workspace you cannot see ──────────────────────────────────────────────

  /*
   * The list loaded successfully and this workspace is not in it: it was
   * deleted, or you were removed, or the id is simply wrong.
   *
   * Without this guard the component fell through to the non-admin read-only
   * view and rendered a "General settings" page reading `Workspace name: —`,
   * which tells a reader the workspace exists and they merely lack admin
   * rights. Both halves of that are wrong, and for a workspace they were never
   * a member of it is also a small framing leak.
   *
   * Keyed on the workspaces list rather than on `myRole`: the role comes from
   * the membership query, which reads `null` while in flight, so a `myRole`
   * test would show this to an admin mid-load.
   *
   * Found via a test that had been passing for the wrong reason: it asserted
   * the heading was absent after deleting a workspace, and that only held
   * while the role query was still in flight. Under parallel load the query
   * settled inside the timeout, the fall-through view rendered, and the
   * assertion failed — reproduced 2 runs in 6. The test was right; the page
   * was wrong.
   */
  if (workspacesQuery.isSuccess && workspace === undefined) {
    return (
      <Shell workspaceName={workspaceName} workspaceId={workspaceId}>
        <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
          <EmptyState
            title="Workspace not available"
            description="It may have been deleted, or you may no longer be a member. Pick another workspace to carry on."
            action={
              <Link
                to="/"
                className="inline-flex items-center rounded-md bg-signal-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-signal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-300 focus-visible:ring-offset-2"
              >
                Go to home
              </Link>
            }
          />
        </div>
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
          <section className="rounded-xl border border-ink-200 bg-surface p-5 shadow-card">
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
            className="rounded-xl border border-ink-200 bg-surface p-5 shadow-card"
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

          {/* Workspace-wide doc templates: offered when creating a page
              anywhere in this workspace, including inside any project.
              Project-local templates are managed in project settings. */}
          <section
            className="rounded-xl border border-ink-200 bg-surface p-5 shadow-card"
            aria-label="Doc templates"
          >
            <PageTemplatesSection
              scope={{ kind: 'workspace', id: workspaceId }}
              canManage={isAdmin}
            />
          </section>

          {/* Danger zone */}
          <section
            className="rounded-xl border border-red-200 bg-surface p-5"
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

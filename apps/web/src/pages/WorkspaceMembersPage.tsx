/**
 * Workspace Members — ADMIN-accessible management surface.
 *
 * Renders the full member list for a workspace. ADMIN users see a "Remove"
 * button on every member row other than themselves; a ConfirmDialog guards the
 * destructive action. Non-admin members can view the list but have no mutation
 * affordances (Remove buttons are hidden entirely for MEMBER/VIEWER).
 *
 * Server errors (e.g. "cannot remove the last admin") are surfaced via toast so
 * the user understands why the action was rejected.
 *
 * Route: /workspaces/:workspaceId/members
 */
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Role } from '@next-lane/shared';
import type { MembershipDto } from '@next-lane/shared';
import { AppHeader } from '@/components/AppHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import {
  useWorkspaces,
  useWorkspaceMembers,
  useMyRole,
  useRemoveMember,
} from '@/api/workspaces';
import { useAuth } from '@/auth/AuthContext';
import { errorMessage } from '@/lib/errorMessage';

// ── Role badge styling ────────────────────────────────────────────────────────

const ROLE_CLASSES: Record<Role, string> = {
  [Role.ADMIN]: 'bg-purple-100 text-purple-700',
  [Role.MEMBER]: 'bg-blue-100 text-blue-700',
  [Role.VIEWER]: 'bg-gray-100 text-gray-600',
};

// ── Member row ────────────────────────────────────────────────────────────────

function MemberRow({
  membership,
  isMe,
  isAdmin,
  onRemove,
}: {
  membership: MembershipDto;
  isMe: boolean;
  isAdmin: boolean;
  onRemove: (m: MembershipDto) => void;
}) {
  const roleClass = ROLE_CLASSES[membership.role] ?? 'bg-gray-100 text-gray-600';

  return (
    <li
      className="flex items-center gap-3 py-3"
      data-testid="member-row"
    >
      <Avatar user={membership.user} size="md" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">
          {membership.user.name}
          {isMe && (
            <span className="ml-1.5 text-xs font-normal text-gray-400">
              (you)
            </span>
          )}
        </p>
        <p className="truncate text-xs text-gray-500">{membership.user.email}</p>
      </div>
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${roleClass}`}
        data-testid="member-role-badge"
      >
        {membership.role}
      </span>
      {/* Remove affordance — ADMINs only, hidden for self */}
      {isAdmin && !isMe && (
        <Button
          variant="danger"
          size="sm"
          onClick={() => onRemove(membership)}
          data-testid="remove-member-button"
          aria-label={`Remove ${membership.user.name} from workspace`}
        >
          Remove
        </Button>
      )}
    </li>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function WorkspaceMembersPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const { user } = useAuth();
  const toast = useToast();

  const myRole = useMyRole(workspaceId);
  const isAdmin = myRole === Role.ADMIN;

  const workspacesQuery = useWorkspaces();
  const workspaceName = useMemo(
    () => workspacesQuery.data?.find((w) => w.id === workspaceId)?.name,
    [workspacesQuery.data, workspaceId],
  );

  const membersQuery = useWorkspaceMembers(workspaceId);
  const removeMember = useRemoveMember(workspaceId);

  const [pendingRemove, setPendingRemove] = useState<MembershipDto | null>(null);

  // Sort: ADMIN first, then MEMBER, then VIEWER; alpha within each group.
  const ROLE_ORDER: Record<Role, number> = {
    [Role.ADMIN]: 0,
    [Role.MEMBER]: 1,
    [Role.VIEWER]: 2,
  };

  const members = useMemo(() => {
    if (!membersQuery.data) return [];
    return [...membersQuery.data].sort((a, b) => {
      const roleDiff = (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9);
      if (roleDiff !== 0) return roleDiff;
      return a.user.name.localeCompare(b.user.name);
    });
  }, [membersQuery.data]);

  function confirmRemove() {
    if (!pendingRemove) return;
    const target = pendingRemove;
    removeMember.mutate(target.id, {
      onSuccess: () => {
        toast.success(`Removed ${target.user.name} from the workspace.`);
        setPendingRemove(null);
      },
      onError: (err) => {
        setPendingRemove(null);
        toast.error(errorMessage(err, 'Could not remove that member.'));
      },
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Shell workspaceName={workspaceName} workspaceId={workspaceId}>
      <div
        className="mx-auto w-full max-w-3xl p-4 sm:p-6"
        data-testid="workspace-members-page"
      >
        <div className="mb-5">
          <h1 className="text-lg font-semibold text-gray-900">Members</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Everyone with access to this workspace.
          </p>
        </div>

        {membersQuery.isLoading ? (
          <LoadingState label="Loading members…" />
        ) : membersQuery.isError ? (
          <ErrorState
            error={membersQuery.error}
            onRetry={() => void membersQuery.refetch()}
          />
        ) : (
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-card sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                {members.length}{' '}
                {members.length === 1 ? 'member' : 'members'}
              </h2>
              {!isAdmin && myRole !== null && (
                <span className="text-xs text-gray-400">
                  Removal is restricted to workspace administrators.
                </span>
              )}
            </div>
            {members.length === 0 ? (
              <p className="py-4 text-sm text-gray-400">No members yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {members.map((m) => (
                  <MemberRow
                    key={m.id}
                    membership={m}
                    isMe={m.user.id === user?.id}
                    isAdmin={isAdmin}
                    onRemove={(membership) => setPendingRemove(membership)}
                  />
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Badge legend */}
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
              ADMIN
            </span>
            Full control — can manage members and settings.
          </span>
          <span className="flex items-center gap-1.5">
            <Badge>MEMBER</Badge>
            Can create and edit issues.
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              VIEWER
            </span>
            Read-only access.
          </span>
        </div>
      </div>

      <ConfirmDialog
        open={pendingRemove !== null}
        title="Remove member"
        message={
          <>
            Remove{' '}
            <span className="font-medium text-gray-900">
              {pendingRemove?.user.name}
            </span>{' '}
            ({pendingRemove?.user.email}) from this workspace? They will lose all
            access immediately.
          </>
        }
        confirmLabel="Remove member"
        variant="danger"
        loading={removeMember.isPending}
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemove(null)}
      />
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
            className="shrink-0 text-sm text-gray-400 hover:text-gray-600"
            aria-label="Back to dashboard"
          >
            Dashboard
          </Link>
          <span className="shrink-0 text-gray-300">/</span>
          <span className="min-w-0 truncate text-sm text-gray-500">
            {workspaceName ?? 'Workspace'}
          </span>
          <span className="shrink-0 text-gray-300">/</span>
          <span className="shrink-0 text-sm font-semibold text-gray-900">
            Members
          </span>
        </div>
      </AppHeader>
      {/* Workspace sub-nav */}
      <nav
        className="flex items-center gap-1 border-b border-gray-100 bg-white px-4 py-1"
        aria-label="Workspace navigation"
      >
        <Link
          to={`/workspaces/${workspaceId}/members`}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-brand-700 bg-brand-50"
          aria-current="page"
        >
          Members
        </Link>
        <Link
          to={`/workspaces/${workspaceId}/audit-log`}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        >
          Audit log
        </Link>
      </nav>
      <main className="flex flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}

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
import { Link, NavLink, useParams } from 'react-router-dom';
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
  [Role.VIEWER]: 'bg-slate-100 text-slate-600',
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
  const roleClass = ROLE_CLASSES[membership.role] ?? 'bg-slate-100 text-slate-600';

  return (
    <li
      className="flex items-center gap-3 py-3"
      data-testid="member-row"
    >
      <Avatar user={membership.user} size="md" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">
          {membership.user.name}
          {isMe && (
            <span className="ml-1.5 text-xs font-normal text-slate-400">
              (you)
            </span>
          )}
        </p>
        <p className="truncate text-xs text-slate-500">{membership.user.email}</p>
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
          <h1 className="text-lg font-semibold text-slate-900">Members</h1>
          <p className="mt-0.5 text-sm text-slate-500">
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
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                {members.length}{' '}
                {members.length === 1 ? 'member' : 'members'}
              </h2>
              {!isAdmin && myRole !== null && (
                <span className="text-xs text-slate-400">
                  Removal is restricted to workspace administrators.
                </span>
              )}
            </div>
            {members.length === 0 ? (
              <p className="py-4 text-sm text-slate-400">No members yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
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
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500">
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
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
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
            <span className="font-medium text-slate-900">
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
            Members
          </span>
        </div>
      </AppHeader>
      {/* Workspace sub-nav */}
      <nav
        className="flex items-center gap-1 border-b border-ink-100 bg-white px-4 py-1"
        aria-label="Workspace navigation"
      >
        <NavLink
          to={`/workspaces/${workspaceId}/members`}
          className={({ isActive }) =>
            `rounded-md px-3 py-1.5 text-sm font-medium ${
              isActive
                ? 'bg-signal-50 text-signal-700'
                : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
            }`
          }
          aria-current="page"
        >
          Members
        </NavLink>
        <NavLink
          to={`/workspaces/${workspaceId}/audit-log`}
          className={({ isActive }) =>
            `rounded-md px-3 py-1.5 text-sm font-medium ${
              isActive
                ? 'bg-signal-50 text-signal-700'
                : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
            }`
          }
        >
          Audit log
        </NavLink>
        <NavLink
          to={`/workspaces/${workspaceId}/branding`}
          className={({ isActive }) =>
            `rounded-md px-3 py-1.5 text-sm font-medium ${
              isActive
                ? 'bg-signal-50 text-signal-700'
                : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
            }`
          }
        >
          Branding
        </NavLink>
      </nav>
      <main className="flex flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}

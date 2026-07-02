/**
 * Workspace Members — ADMIN-accessible management surface.
 *
 * Renders the full member list for a workspace. ADMIN users see:
 *  - An "Invite member" form (email + role select).
 *  - A per-row role dropdown for changing an existing member's role.
 *  - A "Remove" button for removing members (other than themselves).
 *
 * Non-admin members can view the list but have no mutation affordances.
 *
 * Route: /workspaces/:workspaceId/members
 */
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Role } from '@next-lane/shared';
import type { MembershipDto } from '@next-lane/shared';
import { AppHeader } from '@/components/AppHeader';
import { WorkspaceSettingsNav } from '@/components/WorkspaceSettingsNav';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Field } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import {
  useWorkspaces,
  useWorkspaceMembers,
  useMyRole,
  useRemoveMember,
  useAddMember,
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
  onRoleChange,
  roleChangePending,
}: {
  membership: MembershipDto;
  isMe: boolean;
  isAdmin: boolean;
  onRemove: (m: MembershipDto) => void;
  onRoleChange: (m: MembershipDto, role: Role) => void;
  roleChangePending: boolean;
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

      {/* Role: dropdown for admin (not self), badge for everyone else */}
      {isAdmin && !isMe ? (
        <Select
          value={membership.role}
          onChange={(e) => onRoleChange(membership, e.target.value as Role)}
          disabled={roleChangePending}
          aria-label={`Role for ${membership.user.name}`}
          data-testid="member-role-select"
          className="w-28 shrink-0 text-xs"
        >
          <option value={Role.ADMIN}>ADMIN</option>
          <option value={Role.MEMBER}>MEMBER</option>
          <option value={Role.VIEWER}>VIEWER</option>
        </Select>
      ) : (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${roleClass}`}
          data-testid="member-role-badge"
        >
          {membership.role}
        </span>
      )}

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

// ── Invite form (admin-only) ──────────────────────────────────────────────────

function InviteForm({ workspaceId }: { workspaceId: string }) {
  const toast = useToast();
  const addMember = useAddMember(workspaceId);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(Role.MEMBER);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    addMember.mutate(
      { email: trimmed, role },
      {
        onSuccess: () => {
          toast.success(`Invited ${trimmed} as ${role}.`);
          setEmail('');
          setRole(Role.MEMBER);
        },
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not invite member.')),
      },
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-5 rounded-xl border border-ink-200 bg-white p-4 shadow-card sm:p-5"
      data-testid="invite-member-form"
      aria-label="Invite a new member"
    >
      <h2 className="mb-3 text-sm font-semibold text-ink-900">
        Invite member
      </h2>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1" style={{ minWidth: '180px' }}>
          <Field label="Email address" htmlFor="invite-email">
            <Input
              id="invite-email"
              data-testid="invite-email-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              required
              autoComplete="off"
            />
          </Field>
        </div>
        <div className="w-36 shrink-0">
          <Field label="Role" htmlFor="invite-role">
            <Select
              id="invite-role"
              data-testid="invite-role-select"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value={Role.MEMBER}>Member</option>
              <option value={Role.ADMIN}>Admin</option>
              <option value={Role.VIEWER}>Viewer</option>
            </Select>
          </Field>
        </div>
        <Button
          type="submit"
          loading={addMember.isPending}
          disabled={!email.trim() || addMember.isPending}
          data-testid="invite-member-submit"
        >
          Invite
        </Button>
      </div>
    </form>
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
  const addMember = useAddMember(workspaceId);

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

  function handleRoleChange(membership: MembershipDto, newRole: Role) {
    if (newRole === membership.role) return;
    addMember.mutate(
      { email: membership.user.email, role: newRole },
      {
        onSuccess: () =>
          toast.success(
            `Changed ${membership.user.name}'s role to ${newRole}.`,
          ),
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not change role.')),
      },
    );
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

        {/* Invite form — admin only */}
        {isAdmin && <InviteForm workspaceId={workspaceId} />}

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
                    onRoleChange={handleRoleChange}
                    roleChangePending={addMember.isPending}
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
      <WorkspaceSettingsNav workspaceId={workspaceId} />
      <main className="flex flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}

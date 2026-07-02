/**
 * MembersSection
 *
 * Displayed on the project Settings page. Lists every EFFECTIVE member of
 * the project (i.e. every member of the project's workspace, annotated with
 * their effective role for THIS project) and, for viewers who are
 * themselves an effective project ADMIN, lets them set or clear a
 * project-scoped role override — distinct from (and layered over) their
 * workspace-wide role, managed on the separate Workspace Members page.
 *
 * Read-only for anyone who is not an effective project ADMIN: the list is
 * always visible (mirrors the read-access rule on `GET /projects/:id/members`
 * — any workspace member may list), but no controls render. Mirrors
 * ComponentsSection.tsx / WorkspaceMembersPage.tsx's row + modal-free
 * inline-control conventions.
 */
import { useMemo, useState } from 'react';
import { Role, type ProjectMemberDto } from '@next-lane/shared';
import {
  useProjectMembers,
  useSetProjectRoleOverride,
  useClearProjectRoleOverride,
} from '@/api/projectMembers';
import { useAuth } from '@/auth/AuthContext';
import { Avatar } from '@/components/ui/Avatar';
import { Select } from '@/components/ui/Select';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

const ROLE_ORDER: Record<Role, number> = {
  [Role.ADMIN]: 0,
  [Role.MEMBER]: 1,
  [Role.VIEWER]: 2,
};

const ROLE_BADGE_CLASSES: Record<Role, string> = {
  [Role.ADMIN]: 'bg-signal-100 text-signal-700',
  [Role.MEMBER]: 'bg-blue-100 text-blue-700',
  [Role.VIEWER]: 'bg-ink-100 text-ink-600',
};

function RoleBadge({ role }: { role: Role }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        ROLE_BADGE_CLASSES[role],
      )}
    >
      {role}
    </span>
  );
}

export function MembersSection({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const membersQuery = useProjectMembers(projectId);
  const setOverride = useSetProjectRoleOverride(projectId);
  const clearOverride = useClearProjectRoleOverride(projectId);

  const [pendingRevert, setPendingRevert] = useState<ProjectMemberDto | null>(null);

  const members = useMemo(() => {
    if (!membersQuery.data) return [];
    return [...membersQuery.data].sort((a, b) => {
      const roleDiff =
        (ROLE_ORDER[a.effectiveRole] ?? 9) - (ROLE_ORDER[b.effectiveRole] ?? 9);
      if (roleDiff !== 0) return roleDiff;
      return a.user.name.localeCompare(b.user.name);
    });
  }, [membersQuery.data]);

  // The viewer's own effective role on THIS project governs whether they get
  // controls — distinct from (and possibly elevated/restricted relative to)
  // their workspace-wide role. Undefined while the list is still loading.
  const self = members.find((m) => m.userId === user?.id);
  const isProjectAdmin = self?.effectiveRole === Role.ADMIN;

  function handleRoleChange(member: ProjectMemberDto, nextRole: Role) {
    if (nextRole === member.effectiveRole) return;
    setOverride.mutate(
      { userId: member.userId, role: nextRole },
      {
        onSuccess: () =>
          toast.success(`Set ${member.user.name}'s role for this project to ${nextRole}.`),
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not set that role override.')),
      },
    );
  }

  function confirmRevert() {
    if (!pendingRevert) return;
    const target = pendingRevert;
    clearOverride.mutate(target.userId, {
      onSuccess: () => {
        setPendingRevert(null);
        toast.success(`Reverted ${target.user.name} to their workspace role.`);
      },
      onError: (err) => {
        setPendingRevert(null);
        toast.error(errorMessage(err, 'Could not revert that role override.'));
      },
    });
  }

  return (
    <section
      className="rounded-xl border border-ink-200 bg-surface p-4 shadow-card sm:p-5"
      data-testid="members-section"
    >
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-ink-900">Members</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          Workspace members with access to this project.
          {isProjectAdmin
            ? ' Set a role override to grant more or less access than their workspace role — scoped to this project only.'
            : ' Only project administrators can change project-level access.'}
        </p>
      </div>

      {membersQuery.isLoading ? (
        <LoadingState label="Loading members…" />
      ) : membersQuery.isError ? (
        <ErrorState
          error={membersQuery.error ?? new Error('Could not load members')}
          onRetry={() => membersQuery.refetch()}
        />
      ) : members.length <= 1 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-ink-200 py-10 text-center">
          <svg className="h-8 w-8 text-ink-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a4 4 0 10-4-4" />
          </svg>
          <p className="text-sm font-medium text-ink-600">No other members</p>
          <p className="max-w-xs text-xs text-ink-400">
            You&apos;re the only member of this project&apos;s workspace. Invite
            teammates to the workspace to manage project-level roles here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-ink-100" data-testid="project-member-list">
          {members.map((member) => {
            const isMe = member.userId === user?.id;
            const isWorkspaceAdmin = member.workspaceRole === Role.ADMIN;
            const canEditRow = isProjectAdmin && !isMe && !isWorkspaceAdmin;

            return (
              <li
                key={member.userId}
                className="flex flex-col gap-2.5 py-3 sm:flex-row sm:items-center sm:gap-3"
                data-testid="project-member-row"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar user={member.user} size="md" className="shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">
                      {member.user.name}
                      {isMe && (
                        <span className="ml-1.5 text-xs font-normal text-ink-400">
                          (you)
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-ink-500">{member.user.email}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:shrink-0">
                  <span
                    className="flex items-center gap-1 text-xs text-ink-400"
                    title="This member's role in the project's workspace."
                  >
                    WS
                    <RoleBadge role={member.workspaceRole} />
                  </span>

                  {isProjectAdmin && isWorkspaceAdmin ? (
                    <span
                      title="Workspace admins always have full access to every project."
                      className="inline-flex items-center gap-1.5"
                    >
                      <Select
                        aria-label={`Role for ${member.user.name} on this project`}
                        value={Role.ADMIN}
                        disabled
                        data-testid="project-member-role-select"
                        className="w-28 text-xs"
                      >
                        <option value={Role.ADMIN}>ADMIN</option>
                      </Select>
                    </span>
                  ) : canEditRow ? (
                    <Select
                      aria-label={`Role for ${member.user.name} on this project`}
                      value={member.effectiveRole}
                      onChange={(e) =>
                        handleRoleChange(member, e.target.value as Role)
                      }
                      disabled={setOverride.isPending}
                      data-testid="project-member-role-select"
                      className="w-28 text-xs"
                    >
                      <option value={Role.ADMIN}>ADMIN</option>
                      <option value={Role.MEMBER}>MEMBER</option>
                      <option value={Role.VIEWER}>VIEWER</option>
                    </Select>
                  ) : (
                    <RoleBadge role={member.effectiveRole} />
                  )}

                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                      member.isOverride
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-ink-50 text-ink-400',
                    )}
                    data-testid={
                      member.isOverride
                        ? 'project-member-override-badge'
                        : 'project-member-inherited-badge'
                    }
                    title={
                      member.isOverride
                        ? 'This role is overridden for this project only.'
                        : 'This role is inherited from the workspace.'
                    }
                  >
                    {member.isOverride ? 'Override' : 'Inherited'}
                  </span>

                  {canEditRow && member.isOverride && (
                    <button
                      type="button"
                      onClick={() => setPendingRevert(member)}
                      data-testid="project-member-revert"
                      aria-label={`Revert ${member.user.name} to their inherited workspace role`}
                      className="rounded px-2 py-1 text-xs font-medium text-ink-500 underline decoration-dotted underline-offset-2 transition-colors duration-[120ms] hover:bg-ink-100 hover:text-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
                    >
                      Revert to inherited
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pendingRevert !== null}
        title="Revert to inherited role"
        message={
          <>
            Revert{' '}
            <span className="font-medium text-ink-900">
              {pendingRevert?.user.name}
            </span>{' '}
            back to their workspace role (
            <span className="font-medium text-ink-900">
              {pendingRevert?.workspaceRole}
            </span>
            ) for this project? Their project-scoped override will be removed.
          </>
        }
        confirmLabel="Revert to inherited"
        variant="primary"
        loading={clearOverride.isPending}
        onConfirm={confirmRevert}
        onCancel={() => setPendingRevert(null)}
      />
    </section>
  );
}

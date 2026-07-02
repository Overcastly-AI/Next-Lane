import { ForbiddenException } from '@nestjs/common';
import { Role } from '@next-lane/shared';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Role ordering for authorization checks: ADMIN > MEMBER > VIEWER.
 * A higher rank satisfies any requirement at or below it.
 */
const ROLE_RANK: Record<Role, number> = {
  [Role.ADMIN]: 3,
  [Role.MEMBER]: 2,
  [Role.VIEWER]: 1,
};

function hasRole(role: Role, minRole: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

/**
 * Ensure `userId` is a member of `workspaceId`. Returns the workspace, throws
 * ForbiddenException otherwise.
 */
export async function assertWorkspaceMember(
  prisma: PrismaService,
  userId: string,
  workspaceId: string,
) {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    include: { workspace: true },
  });
  if (!membership) {
    throw new ForbiddenException('Not a member of this workspace');
  }
  return membership.workspace;
}

/**
 * Ensure `userId` is a member of `workspaceId` with at least `minRole`
 * (ADMIN > MEMBER > VIEWER). Returns the workspace, throws ForbiddenException
 * if not a member or the role is insufficient.
 */
export async function assertWorkspaceRole(
  prisma: PrismaService,
  userId: string,
  workspaceId: string,
  minRole: Role,
) {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    include: { workspace: true },
  });
  if (!membership) {
    throw new ForbiddenException('Not a member of this workspace');
  }
  if (!hasRole(membership.role as Role, minRole)) {
    throw new ForbiddenException(
      `Requires ${minRole} role in this workspace`,
    );
  }
  return membership.workspace;
}

/**
 * Ensure `userId` is a member of the workspace owning `projectId`. Returns the
 * project (with its workspace), throws ForbiddenException otherwise.
 */
export async function assertProjectMember(
  prisma: PrismaService,
  userId: string,
  projectId: string,
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { workspace: true },
  });
  if (!project) {
    throw new ForbiddenException('Not a member of this project');
  }
  const membership = await prisma.membership.findUnique({
    where: {
      userId_workspaceId: { userId, workspaceId: project.workspaceId },
    },
  });
  if (!membership) {
    throw new ForbiddenException('Not a member of this project');
  }
  return project;
}

/**
 * Ensure `userId` is this instance's designated instance-level admin —
 * distinct from workspace-level `Membership.role: ADMIN`, which is scoped to
 * a single workspace and not conservative enough for instance-wide secrets
 * (e.g. the SSO/OIDC configuration screen). Throws ForbiddenException
 * otherwise. See `User.isInstanceAdmin` in schema.prisma for how this flag
 * is assigned (first user on a fresh install / backfilled oldest user on an
 * existing install).
 */
export async function assertInstanceAdmin(
  prisma: PrismaService,
  userId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isInstanceAdmin: true },
  });
  if (!user?.isInstanceAdmin) {
    throw new ForbiddenException('Requires instance-admin access');
  }
}

/**
 * Result of resolving a user's *effective* role on a project — see
 * {@link getEffectiveProjectRole}.
 */
export interface EffectiveProjectRole {
  /** The role that actually applies for this project. */
  role: Role;
  /**
   * True when `role` came from a `ProjectMembership` override row rather
   * than being inherited from the workspace-wide `Membership.role`.
   */
  isOverride: boolean;
}

/**
 * Resolve a user's *effective* role on a project — the single source of
 * truth every project-scoped authorization check routes through (via
 * {@link assertProjectRole} below).
 *
 * Resolution rule:
 *   1. The user MUST have a workspace `Membership` row for the project's
 *      workspace at all — a stray `ProjectMembership` row never grants
 *      access on its own (tenant isolation). Returns `null` when absent.
 *   2. Workspace ADMINs always retain full access — any `ProjectMembership`
 *      override row for a workspace ADMIN is ignored here (belt-and-braces:
 *      the write path also refuses to create one, but resolution stays safe
 *      even for a row that predates a promotion to ADMIN).
 *   3. Otherwise, an existing `ProjectMembership` row's `role` WINS over the
 *      workspace role — this can both ELEVATE (MEMBER -> project ADMIN) and
 *      RESTRICT (MEMBER -> project VIEWER) access, scoped to this project only.
 *   4. Absent an override, the workspace `Membership.role` applies unchanged.
 */
export async function getEffectiveProjectRole(
  prisma: PrismaService,
  userId: string,
  workspaceId: string,
  projectId: string,
): Promise<EffectiveProjectRole | null> {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!membership) {
    return null;
  }
  const workspaceRole = membership.role as Role;
  if (workspaceRole === Role.ADMIN) {
    // Workspace admins always have full access; ignore any override row.
    return { role: Role.ADMIN, isOverride: false };
  }

  const override = await prisma.projectMembership.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
  if (override) {
    return { role: override.role as Role, isOverride: true };
  }

  return { role: workspaceRole, isOverride: false };
}

/**
 * Ensure `userId` has at least `minRole` on `projectId` — the EFFECTIVE
 * project role (a `ProjectMembership` override, when present, wins over the
 * workspace-wide `Membership.role`; see {@link getEffectiveProjectRole}).
 * Returns the project (with its workspace), throws ForbiddenException if not
 * a member of the owning workspace or the effective role is insufficient.
 *
 * This is the single chokepoint every project-scoped write/read-role check in
 * the codebase calls — updating its resolution here automatically applies
 * per-project role overrides everywhere without touching each call site.
 */
export async function assertProjectRole(
  prisma: PrismaService,
  userId: string,
  projectId: string,
  minRole: Role,
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { workspace: true },
  });
  if (!project) {
    throw new ForbiddenException('Not a member of this project');
  }
  const effective = await getEffectiveProjectRole(
    prisma,
    userId,
    project.workspaceId,
    projectId,
  );
  if (!effective) {
    throw new ForbiddenException('Not a member of this project');
  }
  if (!hasRole(effective.role, minRole)) {
    throw new ForbiddenException(`Requires ${minRole} role in this project`);
  }
  return project;
}

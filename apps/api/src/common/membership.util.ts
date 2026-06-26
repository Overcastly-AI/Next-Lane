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
 * Ensure `userId` is a member of the workspace owning `projectId` with at least
 * `minRole` (ADMIN > MEMBER > VIEWER). Returns the project (with its
 * workspace), throws ForbiddenException if not a member or role insufficient.
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
  const membership = await prisma.membership.findUnique({
    where: {
      userId_workspaceId: { userId, workspaceId: project.workspaceId },
    },
  });
  if (!membership) {
    throw new ForbiddenException('Not a member of this project');
  }
  if (!hasRole(membership.role as Role, minRole)) {
    throw new ForbiddenException(`Requires ${minRole} role in this project`);
  }
  return project;
}

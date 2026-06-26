import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

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

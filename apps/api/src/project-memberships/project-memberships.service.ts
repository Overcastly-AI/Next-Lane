import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import { toUserDto } from '../auth/auth.service';
import { SetProjectRoleOverrideDto } from './dto/set-project-role-override.dto';
import { Role } from '@next-lane/shared';
import type { ProjectMemberDto } from '@next-lane/shared';
import { AuditService } from '../audit/audit.service';

type MembershipRow = {
  userId: string;
  role: Role;
  user: {
    id: string;
    email: string;
    name: string;
    avatarColor: string;
    emailNotifications: boolean;
    createdAt: Date;
  };
};

function toDto(
  membership: MembershipRow,
  overrideRole: Role | undefined,
): ProjectMemberDto {
  // Mirrors getEffectiveProjectRole: workspace ADMINs always resolve to
  // ADMIN, unmarked, regardless of any stray override row.
  const isAdmin = membership.role === Role.ADMIN;
  const effectiveRole = !isAdmin && overrideRole ? overrideRole : membership.role;
  return {
    userId: membership.userId,
    user: toUserDto(membership.user),
    workspaceRole: membership.role,
    effectiveRole,
    isOverride: !isAdmin && overrideRole !== undefined,
  };
}

@Injectable()
export class ProjectMembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * GET /projects/:id/members — list the project's EFFECTIVE members: every
   * member of the project's workspace, annotated with their effective role
   * and whether it comes from a per-project override. Any workspace member
   * (read access) may list this.
   */
  async listMembers(userId: string, projectId: string): Promise<ProjectMemberDto[]> {
    const project = await assertProjectMember(this.prisma, userId, projectId);

    const [memberships, overrides] = await Promise.all([
      this.prisma.membership.findMany({
        where: { workspaceId: project.workspaceId },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.projectMembership.findMany({ where: { projectId } }),
    ]);

    const overrideByUserId = new Map(overrides.map((o) => [o.userId, o.role as Role]));

    return memberships.map((m) =>
      toDto(
        { userId: m.userId, role: m.role as Role, user: m.user },
        overrideByUserId.get(m.userId),
      ),
    );
  }

  /**
   * PUT /projects/:id/members/:userId/role — set (create or replace) a
   * project-scoped role override for `targetUserId`. Requires the caller to
   * have EFFECTIVE project ADMIN (a project-level override can grant this,
   * not just workspace ADMIN — see `assertProjectRole`).
   *
   * Refuses (400) to set an override for a workspace ADMIN: admins always
   * retain full access, so an override on them would be meaningless (or, if
   * ever honored, a dangerous accidental lockout) — see
   * `getEffectiveProjectRole` for the matching read-side guard.
   */
  async setOverride(
    userId: string,
    projectId: string,
    targetUserId: string,
    dto: SetProjectRoleOverrideDto,
    ip?: string | null,
  ): Promise<ProjectMemberDto> {
    const project = await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);

    const targetMembership = await this.prisma.membership.findUnique({
      where: {
        userId_workspaceId: { userId: targetUserId, workspaceId: project.workspaceId },
      },
      include: { user: true },
    });
    if (!targetMembership) {
      throw new NotFoundException('User is not a member of this project’s workspace');
    }
    if (targetMembership.role === Role.ADMIN) {
      throw new BadRequestException(
        'Cannot set a project role override for a workspace admin — admins always have full access to every project.',
      );
    }

    await this.prisma.projectMembership.upsert({
      where: { projectId_userId: { projectId, userId: targetUserId } },
      create: { projectId, userId: targetUserId, role: dto.role },
      update: { role: dto.role },
    });

    this.audit.record({
      workspaceId: project.workspaceId,
      actorId: userId,
      action: 'project_membership.override_set',
      targetType: 'ProjectMembership',
      targetId: `${projectId}:${targetUserId}`,
      metadata: {
        projectId,
        targetUserId,
        targetEmail: targetMembership.user.email,
        role: dto.role,
      },
      ip,
    });

    return toDto(
      {
        userId: targetMembership.userId,
        role: targetMembership.role as Role,
        user: targetMembership.user,
      },
      dto.role,
    );
  }

  /**
   * DELETE /projects/:id/members/:userId/role — clear a project-scoped role
   * override, reverting `targetUserId` back to inheriting their workspace
   * role on this project. Requires EFFECTIVE project ADMIN. 404 if no
   * override exists for that user.
   */
  async clearOverride(
    userId: string,
    projectId: string,
    targetUserId: string,
    ip?: string | null,
  ): Promise<ProjectMemberDto> {
    const project = await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);

    const existing = await this.prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId: targetUserId } },
    });
    if (!existing) {
      throw new NotFoundException('No project role override exists for this user');
    }

    const targetMembership = await this.prisma.membership.findUnique({
      where: {
        userId_workspaceId: { userId: targetUserId, workspaceId: project.workspaceId },
      },
      include: { user: true },
    });
    if (!targetMembership) {
      throw new NotFoundException('User is not a member of this project’s workspace');
    }

    await this.prisma.projectMembership.delete({ where: { id: existing.id } });

    this.audit.record({
      workspaceId: project.workspaceId,
      actorId: userId,
      action: 'project_membership.override_clear',
      targetType: 'ProjectMembership',
      targetId: `${projectId}:${targetUserId}`,
      metadata: {
        projectId,
        targetUserId,
        targetEmail: targetMembership.user.email,
        previousRole: existing.role,
      },
      ip,
    });

    return toDto(
      {
        userId: targetMembership.userId,
        role: targetMembership.role as Role,
        user: targetMembership.user,
      },
      undefined,
    );
  }
}

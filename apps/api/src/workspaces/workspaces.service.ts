import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertWorkspaceMember,
  assertWorkspaceRole,
} from '../common/membership.util';
import { toUserDto } from '../auth/auth.service';
import { CreateWorkspaceDto, AddMemberDto } from './dto/workspace.dto';
import { Role } from '@next-lane/shared';
import type { WorkspaceDto, MembershipDto } from '@next-lane/shared';
import { AuditService } from '../audit/audit.service';

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
};

function toWorkspaceDto(w: WorkspaceRow): WorkspaceDto {
  return {
    id: w.id,
    name: w.name,
    slug: w.slug,
    createdAt: w.createdAt.toISOString(),
  };
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(userId: string): Promise<WorkspaceDto[]> {
    const workspaces = await this.prisma.workspace.findMany({
      where: { memberships: { some: { userId } } },
      orderBy: { createdAt: 'asc' },
    });
    return workspaces.map(toWorkspaceDto);
  }

  async create(userId: string, dto: CreateWorkspaceDto): Promise<WorkspaceDto> {
    const slug = await this.uniqueSlug(dto.slug ?? slugify(dto.name));
    const workspace = await this.prisma.workspace.create({
      data: {
        name: dto.name,
        slug,
        memberships: {
          create: { userId, role: Role.ADMIN },
        },
      },
    });
    return toWorkspaceDto(workspace);
  }

  async findOne(userId: string, id: string): Promise<WorkspaceDto> {
    const workspace = await assertWorkspaceMember(this.prisma, userId, id);
    return toWorkspaceDto(workspace);
  }

  async members(userId: string, id: string): Promise<MembershipDto[]> {
    await assertWorkspaceMember(this.prisma, userId, id);
    const memberships = await this.prisma.membership.findMany({
      where: { workspaceId: id },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      id: m.id,
      role: m.role as Role,
      user: toUserDto(m.user),
    }));
  }

  async addMember(
    userId: string,
    id: string,
    dto: AddMemberDto,
    ip?: string | null,
  ): Promise<MembershipDto> {
    await assertWorkspaceRole(this.prisma, userId, id, Role.ADMIN);
    const target = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!target) throw new NotFoundException('User not found');

    // Check if it's a new membership or a role change (for audit action label).
    const existing = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: target.id, workspaceId: id } },
    });
    const action = existing ? 'membership.role_change' : 'membership.add';
    const prevRole = existing?.role ?? null;

    const membership = await this.prisma.membership.upsert({
      where: {
        userId_workspaceId: { userId: target.id, workspaceId: id },
      },
      update: { role: dto.role ?? Role.MEMBER },
      create: {
        userId: target.id,
        workspaceId: id,
        role: dto.role ?? Role.MEMBER,
      },
      include: { user: true },
    });

    this.audit.record({
      workspaceId: id,
      actorId: userId,
      action,
      targetType: 'Membership',
      targetId: membership.id,
      metadata: {
        targetEmail: target.email,
        role: membership.role,
        ...(prevRole ? { previousRole: prevRole } : {}),
      },
      ip,
    });

    return {
      id: membership.id,
      role: membership.role as Role,
      user: toUserDto(membership.user),
    };
  }

  async removeMember(
    userId: string,
    workspaceId: string,
    membershipId: string,
    ip?: string | null,
  ): Promise<{ id: string }> {
    await assertWorkspaceRole(this.prisma, userId, workspaceId, Role.ADMIN);
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
      include: { user: true },
    });
    if (!membership || membership.workspaceId !== workspaceId) {
      throw new NotFoundException('Membership not found');
    }

    await this.prisma.membership.delete({ where: { id: membershipId } });

    this.audit.record({
      workspaceId,
      actorId: userId,
      action: 'membership.remove',
      targetType: 'Membership',
      targetId: membershipId,
      metadata: {
        targetEmail: membership.user.email,
        role: membership.role,
      },
      ip,
    });

    return { id: membershipId };
  }

  private async uniqueSlug(base: string): Promise<string> {
    const root = base || 'workspace';
    let candidate = root;
    let n = 1;
    while (
      await this.prisma.workspace.findUnique({ where: { slug: candidate } })
    ) {
      candidate = `${root}-${n++}`;
    }
    return candidate;
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

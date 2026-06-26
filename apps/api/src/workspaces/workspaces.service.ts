import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertWorkspaceMember } from '../common/membership.util';
import { toUserDto } from '../auth/auth.service';
import { CreateWorkspaceDto, AddMemberDto } from './dto/workspace.dto';
import { Role } from '@next-lane/shared';
import type { WorkspaceDto, MembershipDto } from '@next-lane/shared';

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
  constructor(private readonly prisma: PrismaService) {}

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
  ): Promise<MembershipDto> {
    await assertWorkspaceMember(this.prisma, userId, id);
    const target = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!target) throw new NotFoundException('User not found');

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
    return {
      id: membership.id,
      role: membership.role as Role,
      user: toUserDto(membership.user),
    };
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

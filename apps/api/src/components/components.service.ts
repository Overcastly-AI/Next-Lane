import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
  assertWorkspaceMember,
} from '../common/membership.util';
import { Role } from '@next-lane/shared';
import { toUserDto } from '../auth/auth.service';
import { CreateComponentDto, UpdateComponentDto } from './dto/component.dto';
import type { ComponentDto } from '@next-lane/shared';

/**
 * Minimal shape of a User row as returned by Prisma when included with component.
 */
type UserRow = {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  emailNotifications: boolean;
  createdAt: Date;
};

type ComponentRow = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  defaultAssigneeId: string | null;
  defaultAssignee: UserRow | null;
  createdAt: Date;
};

function toComponentDto(c: ComponentRow): ComponentDto {
  return {
    id: c.id,
    projectId: c.projectId,
    name: c.name,
    description: c.description,
    defaultAssignee: c.defaultAssignee ? toUserDto(c.defaultAssignee) : null,
    createdAt: c.createdAt.toISOString(),
  };
}

const componentInclude = {
  defaultAssignee: true,
} as const;

@Injectable()
export class ComponentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate that a defaultAssigneeId (when provided and non-null) is a member
   * of the project's workspace. Returns silently on null/undefined.
   */
  private async assertDefaultAssigneeInWorkspace(
    workspaceId: string,
    defaultAssigneeId: string | null | undefined,
  ): Promise<void> {
    if (defaultAssigneeId == null) return;
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: defaultAssigneeId, workspaceId } },
    });
    if (!membership) {
      throw new BadRequestException(
        'defaultAssigneeId is not a member of this workspace',
      );
    }
  }

  async findAll(userId: string, projectId: string): Promise<ComponentDto[]> {
    await assertProjectMember(this.prisma, userId, projectId);
    const components = await this.prisma.component.findMany({
      where: { projectId },
      include: componentInclude,
      orderBy: { name: 'asc' },
    });
    return components.map(toComponentDto);
  }

  async create(
    userId: string,
    projectId: string,
    dto: CreateComponentDto,
  ): Promise<ComponentDto> {
    const project = await assertProjectRole(
      this.prisma,
      userId,
      projectId,
      Role.ADMIN,
    );
    await this.assertDefaultAssigneeInWorkspace(
      project.workspaceId,
      dto.defaultAssigneeId,
    );

    try {
      const component = await this.prisma.component.create({
        data: {
          projectId,
          name: dto.name,
          description: dto.description,
          defaultAssigneeId: dto.defaultAssigneeId ?? null,
        },
        include: componentInclude,
      });
      return toComponentDto(component);
    } catch (err: unknown) {
      // P2002 = unique constraint violation (projectId, name)
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException(
          `A component named "${dto.name}" already exists in this project`,
        );
      }
      throw err;
    }
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateComponentDto,
  ): Promise<ComponentDto> {
    const existing = await this.prisma.component.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Component not found');

    const project = await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.ADMIN,
    );
    await this.assertDefaultAssigneeInWorkspace(
      project.workspaceId,
      dto.defaultAssigneeId,
    );

    try {
      const component = await this.prisma.component.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.defaultAssigneeId !== undefined
            ? { defaultAssigneeId: dto.defaultAssigneeId }
            : {}),
        },
        include: componentInclude,
      });
      return toComponentDto(component);
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException(
          `A component named "${dto.name}" already exists in this project`,
        );
      }
      throw err;
    }
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.prisma.component.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Component not found');
    await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.ADMIN,
    );
    await this.prisma.component.delete({ where: { id } });
  }
}

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
} from '../common/membership.util';
import { CreateStatusDto, UpdateStatusDto } from './dto/status.dto';
import { StatusCategory, Role } from '@next-lane/shared';
import type { StatusDto } from '@next-lane/shared';

type StatusRow = {
  id: string;
  name: string;
  category: string;
  order: number;
  wipLimit?: number | null;
  projectId: string;
};

export function toStatusDto(s: StatusRow): StatusDto {
  return {
    id: s.id,
    name: s.name,
    category: s.category as StatusCategory,
    order: s.order,
    wipLimit: s.wipLimit ?? null,
    projectId: s.projectId,
  };
}

@Injectable()
export class StatusesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string, projectId: string): Promise<StatusDto[]> {
    await assertProjectMember(this.prisma, userId, projectId);
    const statuses = await this.prisma.status.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });
    return statuses.map(toStatusDto);
  }

  /**
   * Case-insensitive same-project duplicate-name guard, mirroring the
   * Label/Component/Version pattern (SETTINGS-3). `Status` intentionally has
   * NO `@@unique([projectId, name])` DB constraint — existing self-hosted
   * installs may already have duplicate column names from before this check
   * existed, and a hard migration-time unique constraint would fail to apply
   * for them. This is a service-level check only.
   */
  private async assertNoDuplicateName(
    projectId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const dup = await this.prisma.status.findFirst({
      where: {
        projectId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (dup) {
      throw new ConflictException(
        `A column named "${name}" already exists in this project`,
      );
    }
  }

  async create(
    userId: string,
    projectId: string,
    dto: CreateStatusDto,
  ): Promise<StatusDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.MEMBER);
    await this.assertNoDuplicateName(projectId, dto.name);
    let order = dto.order;
    if (order === undefined) {
      const last = await this.prisma.status.findFirst({
        where: { projectId },
        orderBy: { order: 'desc' },
      });
      order = (last?.order ?? -1) + 1;
    }
    const status = await this.prisma.status.create({
      data: {
        projectId,
        name: dto.name,
        category: dto.category,
        order,
        wipLimit: dto.wipLimit ?? null,
      },
    });
    return toStatusDto(status);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateStatusDto,
  ): Promise<StatusDto> {
    const existing = await this.prisma.status.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Status not found');
    await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.MEMBER,
    );

    if (dto.name !== undefined) {
      await this.assertNoDuplicateName(existing.projectId, dto.name, id);
    }

    const status = await this.prisma.status.update({
      where: { id },
      data: {
        name: dto.name,
        category: dto.category,
        order: dto.order,
        ...(dto.wipLimit !== undefined ? { wipLimit: dto.wipLimit } : {}),
      },
    });
    return toStatusDto(status);
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    const existing = await this.prisma.status.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Status not found');
    await assertProjectRole(this.prisma, userId, existing.projectId, Role.ADMIN);

    const count = await this.prisma.issue.count({ where: { statusId: id } });
    if (count > 0) {
      throw new BadRequestException(
        'Cannot delete a status that still has issues',
      );
    }
    await this.prisma.status.delete({ where: { id } });
    return { id };
  }
}

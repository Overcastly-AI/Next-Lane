import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertProjectMember } from '../common/membership.util';
import { CreateStatusDto, UpdateStatusDto } from './dto/status.dto';
import { StatusCategory } from '@next-lane/shared';
import type { StatusDto } from '@next-lane/shared';

type StatusRow = {
  id: string;
  name: string;
  category: string;
  order: number;
  projectId: string;
};

export function toStatusDto(s: StatusRow): StatusDto {
  return {
    id: s.id,
    name: s.name,
    category: s.category as StatusCategory,
    order: s.order,
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

  async create(
    userId: string,
    projectId: string,
    dto: CreateStatusDto,
  ): Promise<StatusDto> {
    await assertProjectMember(this.prisma, userId, projectId);
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
    await assertProjectMember(this.prisma, userId, existing.projectId);

    const status = await this.prisma.status.update({
      where: { id },
      data: {
        name: dto.name,
        category: dto.category,
        order: dto.order,
      },
    });
    return toStatusDto(status);
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    const existing = await this.prisma.status.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Status not found');
    await assertProjectMember(this.prisma, userId, existing.projectId);

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

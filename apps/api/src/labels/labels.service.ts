import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import { Role } from '@next-lane/shared';
import { CreateLabelDto, UpdateLabelDto } from './dto/label.dto';
import type { LabelDto } from '@next-lane/shared';

type LabelRow = {
  id: string;
  name: string;
  color: string;
  projectId: string;
};

function toLabelDto(l: LabelRow): LabelDto {
  return { id: l.id, name: l.name, color: l.color, projectId: l.projectId };
}

@Injectable()
export class LabelsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string, projectId: string): Promise<LabelDto[]> {
    await assertProjectMember(this.prisma, userId, projectId);
    const labels = await this.prisma.label.findMany({
      where: { projectId },
      orderBy: { name: 'asc' },
    });
    return labels.map(toLabelDto);
  }

  async create(
    userId: string,
    projectId: string,
    dto: CreateLabelDto,
  ): Promise<LabelDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.MEMBER);
    const label = await this.prisma.label.create({
      data: { projectId, name: dto.name, color: dto.color },
    });
    return toLabelDto(label);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateLabelDto,
  ): Promise<LabelDto> {
    const existing = await this.prisma.label.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Label not found');
    // ADMIN or MEMBER may edit; VIEWER is rejected.
    await assertProjectRole(this.prisma, userId, existing.projectId, Role.MEMBER);
    const label = await this.prisma.label.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
      },
    });
    return toLabelDto(label);
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    const existing = await this.prisma.label.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Label not found');
    await assertProjectRole(this.prisma, userId, existing.projectId, Role.ADMIN);
    await this.prisma.label.delete({ where: { id } });
    return { id };
  }

  async addToIssue(
    userId: string,
    issueId: string,
    labelId: string,
  ): Promise<LabelDto[]> {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { id: true, projectId: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    await assertProjectRole(this.prisma, userId, issue.projectId, Role.MEMBER);

    const label = await this.prisma.label.findUnique({
      where: { id: labelId },
    });
    if (!label || label.projectId !== issue.projectId) {
      throw new NotFoundException('Label not found');
    }

    await this.prisma.issueLabel.upsert({
      where: { issueId_labelId: { issueId, labelId } },
      update: {},
      create: { issueId, labelId },
    });
    return this.issueLabels(issueId);
  }

  async removeFromIssue(
    userId: string,
    issueId: string,
    labelId: string,
  ): Promise<LabelDto[]> {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { id: true, projectId: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    await assertProjectRole(this.prisma, userId, issue.projectId, Role.MEMBER);

    await this.prisma.issueLabel.deleteMany({ where: { issueId, labelId } });
    return this.issueLabels(issueId);
  }

  private async issueLabels(issueId: string): Promise<LabelDto[]> {
    const rows = await this.prisma.issueLabel.findMany({
      where: { issueId },
      include: { label: true },
    });
    return rows.map((r) => toLabelDto(r.label));
  }
}

import {
  ConflictException,
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

/** True for a Prisma unique-constraint violation (P2002). */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'P2002'
  );
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
    try {
      const label = await this.prisma.label.create({
        data: { projectId, name: dto.name, color: dto.color },
      });
      return toLabelDto(label);
    } catch (err: unknown) {
      // P2002 = unique constraint violation (projectId, name). Mirrors the
      // friendly Components/Versions/Templates pattern (SETTINGS-4) instead
      // of letting the generic AllExceptionsFilter fallback message leak
      // through ("A record with this value already exists.").
      if (isUniqueConstraintError(err)) {
        throw new ConflictException(
          `A label named "${dto.name}" already exists in this project`,
        );
      }
      throw err;
    }
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
    try {
      const label = await this.prisma.label.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
        },
      });
      return toLabelDto(label);
    } catch (err: unknown) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException(
          `A label named "${dto.name}" already exists in this project`,
        );
      }
      throw err;
    }
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

    // Log activity only on a NEW attach (repeat attach stays a silent no-op)
    // — label changes previously left zero trace in the activity feed and
    // agent-context staleness (MCP-QA pass 2, top finding). Mirrors
    // IssuesService.attachLabel's bulk-path behavior.
    const already = await this.prisma.issueLabel.findUnique({
      where: { issueId_labelId: { issueId, labelId } },
      select: { issueId: true },
    });
    if (!already) {
      await this.prisma.issueLabel.upsert({
        where: { issueId_labelId: { issueId, labelId } },
        update: {},
        create: { issueId, labelId },
      });
      await this.prisma.activityLog.create({
        data: { issueId, actorId: userId, field: 'label', from: null, to: labelId },
      });
    }
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

    const { count } = await this.prisma.issueLabel.deleteMany({
      where: { issueId, labelId },
    });
    // Only a real detach is activity; removing an unattached label is a no-op.
    if (count > 0) {
      await this.prisma.activityLog.create({
        data: { issueId, actorId: userId, field: 'label', from: labelId, to: null },
      });
    }
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

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
import { CreateSprintDto, UpdateSprintDto } from './dto/sprint.dto';
import { SprintState, StatusCategory, Role } from '@next-lane/shared';
import type { SprintDto } from '@next-lane/shared';

type SprintRow = {
  id: string;
  name: string;
  goal: string | null;
  state: string;
  startDate: Date | null;
  endDate: Date | null;
  projectId: string;
};

function toSprintDto(s: SprintRow): SprintDto {
  return {
    id: s.id,
    name: s.name,
    goal: s.goal,
    state: s.state as SprintState,
    startDate: s.startDate ? s.startDate.toISOString() : null,
    endDate: s.endDate ? s.endDate.toISOString() : null,
    projectId: s.projectId,
  };
}

@Injectable()
export class SprintsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string, projectId: string): Promise<SprintDto[]> {
    await assertProjectMember(this.prisma, userId, projectId);
    const sprints = await this.prisma.sprint.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    return sprints.map(toSprintDto);
  }

  async create(
    userId: string,
    projectId: string,
    dto: CreateSprintDto,
  ): Promise<SprintDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.MEMBER);
    const sprint = await this.prisma.sprint.create({
      data: {
        projectId,
        name: dto.name,
        goal: dto.goal,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
    return toSprintDto(sprint);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateSprintDto,
  ): Promise<SprintDto> {
    const existing = await this.prisma.sprint.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sprint not found');
    await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.MEMBER,
    );

    const startingSprint =
      dto.state === SprintState.ACTIVE &&
      existing.state !== SprintState.ACTIVE;
    const completingSprint =
      dto.state === SprintState.COMPLETED &&
      existing.state !== SprintState.COMPLETED;

    // Only one ACTIVE sprint per project: reject the start if another is live.
    if (startingSprint) {
      await this.assertNoOtherActiveSprint(existing.projectId, id);
    }

    const sprint = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.sprint.update({
        where: { id },
        data: {
          name: dto.name,
          goal: dto.goal,
          state: dto.state,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        },
      });

      // On completion, return incomplete issues (not in a DONE-category status)
      // to the backlog so the next sprint can be planned with them.
      if (completingSprint) {
        const doneStatusIds = await tx.status.findMany({
          where: {
            projectId: existing.projectId,
            category: StatusCategory.DONE,
          },
          select: { id: true },
        });
        const doneIds = doneStatusIds.map((s) => s.id);
        await tx.issue.updateMany({
          where: {
            sprintId: id,
            statusId: { notIn: doneIds.length > 0 ? doneIds : ['__none__'] },
          },
          data: { sprintId: null },
        });
      }

      return updated;
    });

    return toSprintDto(sprint);
  }

  /**
   * Reject starting a sprint when another sprint in the same project is already
   * ACTIVE. Keeps the "one active sprint at a time" invariant the board relies
   * on (the board shows issues in the active sprint or the backlog).
   */
  private async assertNoOtherActiveSprint(
    projectId: string,
    excludeId: string,
  ): Promise<void> {
    const active = await this.prisma.sprint.findFirst({
      where: {
        projectId,
        state: SprintState.ACTIVE,
        id: { not: excludeId },
      },
      select: { name: true },
    });
    if (active) {
      throw new BadRequestException(
        `"${active.name}" is already active. Complete it before starting another sprint.`,
      );
    }
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    const existing = await this.prisma.sprint.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sprint not found');
    await assertProjectRole(this.prisma, userId, existing.projectId, Role.ADMIN);
    await this.prisma.sprint.delete({ where: { id } });
    return { id };
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import { CreateSprintDto, UpdateSprintDto } from './dto/sprint.dto';
import {
  SprintState,
  StatusCategory,
  Role,
  SocketEvents,
  WebhookEventTypes,
} from '@next-lane/shared';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly webhooks: WebhooksService,
  ) {}

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

    let sprint: SprintRow;
    try {
      sprint = await this.prisma.$transaction(async (tx) => {
        // Only one ACTIVE sprint per project. Check-then-write atomically inside
        // the transaction so two concurrent starts can't both pass; a partial
        // unique index (sprint_one_active_per_project) is the hard backstop.
        if (startingSprint) {
          await this.assertNoOtherActiveSprint(tx, existing.projectId, id);
        }

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

        // On completion, return incomplete issues (not in a DONE-category
        // status) to the backlog so the next sprint can be planned with them.
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
    } catch (err) {
      // Backstop for the start TOCTOU race: if a concurrent transaction won the
      // partial unique index (sprint_one_active_per_project), Prisma raises a
      // unique-constraint violation. Map it to the same "already active" message.
      if (
        startingSprint &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Another sprint is already active. Complete it before starting another sprint.',
        );
      }
      throw err;
    }

    const dtoOut = toSprintDto(sprint);

    // Notify the project room on lifecycle transitions so other tabs refresh
    // their board/backlog instead of showing stale sprint state.
    if (startingSprint || completingSprint) {
      this.realtime.emitToProject(
        existing.projectId,
        SocketEvents.SprintUpdated,
        dtoOut,
      );
      this.webhooks.dispatch(
        existing.projectId,
        startingSprint
          ? WebhookEventTypes.SprintStarted
          : WebhookEventTypes.SprintCompleted,
        dtoOut,
      );
    }

    return dtoOut;
  }

  /**
   * Reject starting a sprint when another sprint in the same project is already
   * ACTIVE. Keeps the "one active sprint at a time" invariant the board relies
   * on (the board shows issues in the active sprint or the backlog). Runs on the
   * transaction client so the check-then-write is atomic with the state update.
   */
  private async assertNoOtherActiveSprint(
    tx: Prisma.TransactionClient,
    projectId: string,
    excludeId: string,
  ): Promise<void> {
    const active = await tx.sprint.findFirst({
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

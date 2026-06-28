import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IssuesService } from '../issues/issues.service';
import { assertProjectMember } from '../common/membership.util';
import { rankAfter, rankBetween } from '@next-lane/shared';
import type { PersonalColumnDto, PersonalCardDto, IssueDto } from '@next-lane/shared';
import { CreatePersonalColumnDto } from './dto/create-personal-column.dto';
import { UpdatePersonalColumnDto } from './dto/update-personal-column.dto';
import { CreatePersonalCardDto } from './dto/create-personal-card.dto';
import { UpdatePersonalCardDto } from './dto/update-personal-card.dto';
import { PromotePersonalCardDto } from './dto/promote-personal-card.dto';
import { IssueType } from '@next-lane/shared';

// ── Mappers ──────────────────────────────────────────────────────────────────

function toCardDto(card: {
  id: string;
  columnId: string;
  title: string;
  notes: string | null;
  rank: string;
  promotedIssueId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PersonalCardDto {
  return {
    id: card.id,
    columnId: card.columnId,
    title: card.title,
    notes: card.notes,
    rank: card.rank,
    promotedIssueId: card.promotedIssueId,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

function toColumnDto(
  col: {
    id: string;
    name: string;
    order: number;
    createdAt: Date;
    updatedAt: Date;
  },
  cards?: PersonalCardDto[],
): PersonalColumnDto {
  const dto: PersonalColumnDto = {
    id: col.id,
    name: col.name,
    order: col.order,
    createdAt: col.createdAt.toISOString(),
    updatedAt: col.updatedAt.toISOString(),
  };
  if (cards !== undefined) {
    dto.cards = cards;
  }
  return dto;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_COLUMNS: Array<{ name: string; order: number }> = [
  { name: 'To Do', order: 0 },
  { name: 'Doing', order: 1 },
  { name: 'Done', order: 2 },
];

@Injectable()
export class PersonalBoardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: IssuesService,
  ) {}

  // ── Ownership helpers ─────────────────────────────────────────────────────

  /**
   * Load a column that belongs to `userId`. Throws 404 when it either does not
   * exist or belongs to a different user (ownership enforcement without leaking
   * existence through a different error shape).
   */
  private async getOwnedColumn(userId: string, columnId: string) {
    const col = await this.prisma.personalColumn.findUnique({
      where: { id: columnId },
    });
    if (!col || col.userId !== userId) {
      throw new NotFoundException('Personal column not found');
    }
    return col;
  }

  /**
   * Load a card that belongs to `userId`. Throws 404 when it either does not
   * exist or belongs to a different user.
   */
  private async getOwnedCard(userId: string, cardId: string) {
    const card = await this.prisma.personalCard.findUnique({
      where: { id: cardId },
    });
    if (!card || card.userId !== userId) {
      throw new NotFoundException('Personal card not found');
    }
    return card;
  }

  // ── Board ─────────────────────────────────────────────────────────────────

  /**
   * Return the caller's full board (columns + cards), creating the three
   * default columns on first access if none exist.
   */
  async getBoard(userId: string): Promise<PersonalColumnDto[]> {
    const existingCount = await this.prisma.personalColumn.count({
      where: { userId },
    });

    if (existingCount === 0) {
      // Lazy-init: create three default columns in a transaction.
      await this.prisma.$transaction(async (tx) => {
        for (const col of DEFAULT_COLUMNS) {
          await tx.personalColumn.create({
            data: { userId, name: col.name, order: col.order },
          });
        }
      });
    }

    const columns = await this.prisma.personalColumn.findMany({
      where: { userId },
      orderBy: { order: 'asc' },
      include: {
        cards: {
          orderBy: { rank: 'asc' },
        },
      },
    });

    return columns.map((col) =>
      toColumnDto(col, col.cards.map(toCardDto)),
    );
  }

  // ── Columns ───────────────────────────────────────────────────────────────

  async createColumn(
    userId: string,
    dto: CreatePersonalColumnDto,
  ): Promise<PersonalColumnDto> {
    const last = await this.prisma.personalColumn.findFirst({
      where: { userId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const order = (last?.order ?? -1) + 1;

    const col = await this.prisma.personalColumn.create({
      data: { userId, name: dto.name, order },
    });
    return toColumnDto(col);
  }

  async updateColumn(
    userId: string,
    columnId: string,
    dto: UpdatePersonalColumnDto,
  ): Promise<PersonalColumnDto> {
    await this.getOwnedColumn(userId, columnId);

    const col = await this.prisma.personalColumn.update({
      where: { id: columnId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
      },
    });
    return toColumnDto(col);
  }

  async deleteColumn(
    userId: string,
    columnId: string,
  ): Promise<{ id: string }> {
    await this.getOwnedColumn(userId, columnId);
    await this.prisma.personalColumn.delete({ where: { id: columnId } });
    return { id: columnId };
  }

  // ── Cards ─────────────────────────────────────────────────────────────────

  async createCard(
    userId: string,
    dto: CreatePersonalCardDto,
  ): Promise<PersonalCardDto> {
    // Verify the target column belongs to the caller.
    await this.getOwnedColumn(userId, dto.columnId);

    // Place the new card at the end of the column.
    const last = await this.prisma.personalCard.findFirst({
      where: { columnId: dto.columnId },
      orderBy: { rank: 'desc' },
      select: { rank: true },
    });
    const rank = rankAfter(last?.rank ?? null);

    const card = await this.prisma.personalCard.create({
      data: {
        userId,
        columnId: dto.columnId,
        title: dto.title,
        notes: dto.notes,
        rank,
      },
    });
    return toCardDto(card);
  }

  async updateCard(
    userId: string,
    cardId: string,
    dto: UpdatePersonalCardDto,
  ): Promise<PersonalCardDto> {
    const existing = await this.getOwnedCard(userId, cardId);

    // When columnId is provided, verify the target column is owned by the caller.
    const targetColumnId = dto.columnId ?? existing.columnId;
    if (dto.columnId !== undefined && dto.columnId !== existing.columnId) {
      await this.getOwnedColumn(userId, dto.columnId);
    }

    let newRank: string | undefined;

    // Recompute rank when the card is being moved (column change or explicit
    // neighbor references).
    const isMoving =
      dto.columnId !== undefined ||
      dto.beforeId !== undefined ||
      dto.afterId !== undefined;

    if (isMoving) {
      let beforeRank: string | null = null;
      let afterRank: string | null = null;

      if (dto.beforeId) {
        const before = await this.prisma.personalCard.findUnique({
          where: { id: dto.beforeId },
          select: { rank: true, userId: true, columnId: true },
        });
        // Validate the neighbor belongs to the caller and the target column.
        if (
          !before ||
          before.userId !== userId ||
          before.columnId !== targetColumnId
        ) {
          throw new NotFoundException(
            'beforeId card not found in the target column',
          );
        }
        beforeRank = before.rank;
      }

      if (dto.afterId) {
        const after = await this.prisma.personalCard.findUnique({
          where: { id: dto.afterId },
          select: { rank: true, userId: true, columnId: true },
        });
        // Validate the neighbor belongs to the caller and the target column.
        if (
          !after ||
          after.userId !== userId ||
          after.columnId !== targetColumnId
        ) {
          throw new NotFoundException(
            'afterId card not found in the target column',
          );
        }
        afterRank = after.rank;
      }

      if (dto.beforeId === undefined && dto.afterId === undefined) {
        // Column change only, no explicit neighbors: place at end of target column.
        const last = await this.prisma.personalCard.findFirst({
          where: { columnId: targetColumnId, id: { not: cardId } },
          orderBy: { rank: 'desc' },
          select: { rank: true },
        });
        newRank = rankAfter(last?.rank ?? null);
      } else {
        newRank = rankBetween(beforeRank, afterRank);
      }
    }

    const card = await this.prisma.personalCard.update({
      where: { id: cardId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.columnId !== undefined ? { columnId: dto.columnId } : {}),
        ...(newRank !== undefined ? { rank: newRank } : {}),
      },
    });
    return toCardDto(card);
  }

  async deleteCard(userId: string, cardId: string): Promise<{ id: string }> {
    await this.getOwnedCard(userId, cardId);
    await this.prisma.personalCard.delete({ where: { id: cardId } });
    return { id: cardId };
  }

  // ── Promote ───────────────────────────────────────────────────────────────

  /**
   * Promote a personal card to a real tracked issue in `projectId`.
   *
   * Authorization:
   * - The card must belong to the caller (ownership).
   * - The caller must be a project MEMBER+ (enforced via assertProjectMember
   *   which is how IssuesService.create checks membership internally via
   *   assertProjectRole(MEMBER)).
   *
   * On success:
   * - A new Issue is created with type TASK and the card's title/notes as
   *   description (delegated to IssuesService.create which handles status
   *   defaulting and rank assignment).
   * - The card's `promotedIssueId` is set to the new issue's id.
   * - Returns { card, issue }.
   */
  async promoteCard(
    userId: string,
    cardId: string,
    dto: PromotePersonalCardDto,
  ): Promise<{ card: PersonalCardDto; issue: IssueDto }> {
    const card = await this.getOwnedCard(userId, cardId);

    // Enforce project membership (MEMBER+) — same requirement as issue creation.
    // assertProjectMember checks workspace membership; IssuesService.create
    // additionally calls assertProjectRole(MEMBER), so we let it do the full
    // check. We call assertProjectMember here first so we get a clear 403
    // before attempting issue creation.
    await assertProjectMember(this.prisma, userId, dto.projectId);

    const issue = await this.issues.create(userId, {
      projectId: dto.projectId,
      type: IssueType.TASK,
      title: card.title,
      description: card.notes ?? undefined,
    });

    const updated = await this.prisma.personalCard.update({
      where: { id: cardId },
      data: { promotedIssueId: issue.id },
    });

    return { card: toCardDto(updated), issue };
  }
}

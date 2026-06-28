import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import {
  POKER_DECK,
  PokerState,
  Role,
} from '@next-lane/shared';
import type {
  PokerSessionDto,
  PokerItemDto,
  PokerVoteDto,
} from '@next-lane/shared';
import type {
  CreatePokerSessionDto,
  UpdatePokerSessionDto,
  AddPokerItemDto,
  CastVoteDto,
  CommitEstimateDto,
} from './dto/poker.dto';

// ── Realtime event name constants ────────────────────────────────────────────

export const PokerEvents = {
  VoteCast: 'poker.vote.cast',
  ItemRevealed: 'poker.item.revealed',
  SessionUpdated: 'poker.session.updated',
  ItemAdded: 'poker.item.added',
  ItemRemoved: 'poker.item.removed',
  EstimateCommitted: 'poker.estimate.committed',
} as const;

/** Room name for a specific poker session. */
export function pokerRoom(sessionId: string): string {
  return `poker:${sessionId}`;
}

// ── DB row types ─────────────────────────────────────────────────────────────

type VoteRow = {
  id: string;
  itemId: string;
  userId: string;
  value: string;
  createdAt: Date;
  updatedAt: Date;
};

type ItemRow = {
  id: string;
  sessionId: string;
  issueId: string;
  order: number;
  revealed: boolean;
  finalEstimate: number | null;
  createdAt: Date;
  votes?: VoteRow[];
};

type SessionRow = {
  id: string;
  projectId: string;
  sprintId: string | null;
  name: string | null;
  state: string;
  activeItemId: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  items?: ItemRow[];
};

// ── Mappers ───────────────────────────────────────────────────────────────────

/** Map a vote row to DTO, optionally masking the value for other users. */
function toVoteDto(v: VoteRow, callerId: string, revealed: boolean): PokerVoteDto {
  const masked = !revealed && v.userId !== callerId;
  return {
    id: v.id,
    itemId: v.itemId,
    userId: v.userId,
    value: masked ? '' : v.value,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

/** Map an item row to DTO with optional vote masking. */
function toItemDto(
  item: ItemRow,
  callerId: string,
  includeVotes: boolean,
): PokerItemDto {
  const dto: PokerItemDto = {
    id: item.id,
    sessionId: item.sessionId,
    issueId: item.issueId,
    order: item.order,
    revealed: item.revealed,
    finalEstimate: item.finalEstimate,
    createdAt: item.createdAt.toISOString(),
  };
  if (includeVotes && item.votes) {
    dto.votes = item.votes.map((v) => toVoteDto(v, callerId, item.revealed));
  }
  return dto;
}

/** Map a session row to DTO with optional items. */
function toSessionDto(
  session: SessionRow,
  callerId: string,
  includeItems: boolean,
): PokerSessionDto {
  const dto: PokerSessionDto = {
    id: session.id,
    projectId: session.projectId,
    sprintId: session.sprintId,
    name: session.name,
    state: session.state as PokerState,
    activeItemId: session.activeItemId,
    createdById: session.createdById,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
  if (includeItems && session.items) {
    dto.items = session.items.map((item) => toItemDto(item, callerId, true));
  }
  return dto;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class PokerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  // ── Sessions ────────────────────────────────────────────────────────────────

  async createSession(
    userId: string,
    projectId: string,
    dto: CreatePokerSessionDto,
  ): Promise<PokerSessionDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.MEMBER);

    // Validate that all issues belong to the project
    if (dto.issueIds.length > 0) {
      const issues = await this.prisma.issue.findMany({
        where: { id: { in: dto.issueIds }, projectId },
        select: { id: true },
      });
      if (issues.length !== dto.issueIds.length) {
        throw new BadRequestException(
          'One or more issueIds do not belong to this project',
        );
      }
    }

    // Validate sprintId belongs to the project when provided
    if (dto.sprintId) {
      const sprint = await this.prisma.sprint.findUnique({
        where: { id: dto.sprintId },
        select: { id: true, projectId: true },
      });
      if (!sprint || sprint.projectId !== projectId) {
        throw new BadRequestException('sprintId does not belong to this project');
      }
    }

    // Create session + items in a transaction
    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.pokerSession.create({
        data: {
          projectId,
          sprintId: dto.sprintId,
          name: dto.name,
          state: PokerState.VOTING,
          createdById: userId,
        },
      });

      // Create PokerItems in array order
      const itemCreations = dto.issueIds.map((issueId, index) =>
        tx.pokerItem.create({
          data: {
            sessionId: created.id,
            issueId,
            order: index,
          },
        }),
      );
      const items = await Promise.all(itemCreations);

      // Set activeItemId to the first item
      const firstItem = items[0];
      const updated = await tx.pokerSession.update({
        where: { id: created.id },
        data: { activeItemId: firstItem?.id ?? null },
        include: {
          items: {
            include: { votes: true },
            orderBy: { order: 'asc' },
          },
        },
      });

      return updated;
    });

    return toSessionDto(session as SessionRow, userId, true);
  }

  async listSessions(
    userId: string,
    projectId: string,
  ): Promise<PokerSessionDto[]> {
    await assertProjectMember(this.prisma, userId, projectId);
    const sessions = await this.prisma.pokerSession.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map((s) => toSessionDto(s as SessionRow, userId, false));
  }

  async getSession(userId: string, sessionId: string): Promise<PokerSessionDto> {
    const session = await this.prisma.pokerSession.findUnique({
      where: { id: sessionId },
      include: {
        items: {
          include: { votes: true },
          orderBy: { order: 'asc' },
        },
      },
    });
    if (!session) {
      throw new NotFoundException('Poker session not found');
    }
    // Verify membership
    await assertProjectMember(this.prisma, userId, session.projectId);
    return toSessionDto(session as SessionRow, userId, true);
  }

  async updateSession(
    userId: string,
    sessionId: string,
    dto: UpdatePokerSessionDto,
  ): Promise<PokerSessionDto> {
    const existing = await this.prisma.pokerSession.findUnique({
      where: { id: sessionId },
      include: { items: { select: { id: true }, orderBy: { order: 'asc' } } },
    });
    if (!existing) {
      throw new NotFoundException('Poker session not found');
    }
    await assertProjectRole(this.prisma, userId, existing.projectId, Role.MEMBER);

    // Validate state transitions
    if (dto.state !== undefined) {
      this.validateStateTransition(existing.state as PokerState, dto.state);
    }

    // Validate activeItemId belongs to this session
    if (dto.activeItemId !== undefined && dto.activeItemId !== null) {
      const itemIds = existing.items.map((i) => i.id);
      if (!itemIds.includes(dto.activeItemId)) {
        throw new BadRequestException(
          'activeItemId does not belong to this session',
        );
      }
    }

    const updated = await this.prisma.pokerSession.update({
      where: { id: sessionId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.state !== undefined ? { state: dto.state } : {}),
        ...(dto.activeItemId !== undefined
          ? { activeItemId: dto.activeItemId }
          : {}),
      },
      include: {
        items: {
          include: { votes: true },
          orderBy: { order: 'asc' },
        },
      },
    });

    const sessionDto = toSessionDto(updated as SessionRow, userId, true);

    // Broadcast session update to all participants in the poker room
    this.realtime.emitToProject(
      existing.projectId,
      PokerEvents.SessionUpdated,
      sessionDto,
    );

    return sessionDto;
  }

  private validateStateTransition(current: PokerState, next: PokerState): void {
    const transitions: Record<PokerState, PokerState[]> = {
      [PokerState.VOTING]: [PokerState.REVEALED, PokerState.CLOSED],
      [PokerState.REVEALED]: [PokerState.CLOSED, PokerState.VOTING],
      [PokerState.CLOSED]: [],
    };
    if (current === next) return; // no-op is fine
    if (!transitions[current].includes(next)) {
      throw new BadRequestException(
        `Cannot transition session state from ${current} to ${next}`,
      );
    }
  }

  // ── Items ────────────────────────────────────────────────────────────────────

  async addItem(
    userId: string,
    sessionId: string,
    dto: AddPokerItemDto,
  ): Promise<PokerItemDto> {
    const session = await this.prisma.pokerSession.findUnique({
      where: { id: sessionId },
      include: { items: { select: { id: true, order: true } } },
    });
    if (!session) {
      throw new NotFoundException('Poker session not found');
    }
    if (session.state === PokerState.CLOSED) {
      throw new BadRequestException('Cannot add items to a closed session');
    }
    await assertProjectRole(this.prisma, userId, session.projectId, Role.MEMBER);

    // Validate the issue belongs to the project
    const issue = await this.prisma.issue.findUnique({
      where: { id: dto.issueId },
      select: { id: true, projectId: true },
    });
    if (!issue || issue.projectId !== session.projectId) {
      throw new BadRequestException('Issue does not belong to this project');
    }

    const maxOrder = session.items.reduce(
      (max, i) => Math.max(max, i.order),
      -1,
    );
    const item = await this.prisma.pokerItem.create({
      data: {
        sessionId,
        issueId: dto.issueId,
        order: maxOrder + 1,
      },
      include: { votes: true },
    });

    const itemDto = toItemDto(item as ItemRow, userId, true);

    this.realtime.emitToProject(session.projectId, PokerEvents.ItemAdded, {
      sessionId,
      item: itemDto,
    });

    return itemDto;
  }

  async removeItem(userId: string, itemId: string): Promise<{ id: string }> {
    const item = await this.prisma.pokerItem.findUnique({
      where: { id: itemId },
      include: { session: { select: { id: true, projectId: true, state: true } } },
    });
    if (!item) {
      throw new NotFoundException('Poker item not found');
    }
    if (item.session.state === PokerState.CLOSED) {
      throw new BadRequestException('Cannot remove items from a closed session');
    }
    await assertProjectRole(
      this.prisma,
      userId,
      item.session.projectId,
      Role.MEMBER,
    );

    await this.prisma.pokerItem.delete({ where: { id: itemId } });

    this.realtime.emitToProject(
      item.session.projectId,
      PokerEvents.ItemRemoved,
      { sessionId: item.session.id, itemId },
    );

    return { id: itemId };
  }

  // ── Votes ─────────────────────────────────────────────────────────────────────

  async castVote(
    userId: string,
    itemId: string,
    dto: CastVoteDto,
  ): Promise<PokerVoteDto> {
    // Validate value is in the deck
    if (!(POKER_DECK as readonly string[]).includes(dto.value)) {
      throw new BadRequestException(
        `Vote value "${dto.value}" is not in the allowed deck`,
      );
    }

    const item = await this.prisma.pokerItem.findUnique({
      where: { id: itemId },
      include: {
        session: {
          select: { id: true, projectId: true, state: true },
        },
      },
    });
    if (!item) {
      throw new NotFoundException('Poker item not found');
    }
    if (item.revealed) {
      throw new BadRequestException('Cannot vote on a revealed item');
    }
    if (item.session.state === PokerState.CLOSED) {
      throw new BadRequestException('Cannot vote in a closed session');
    }
    await assertProjectRole(
      this.prisma,
      userId,
      item.session.projectId,
      Role.MEMBER,
    );

    const vote = await this.prisma.pokerVote.upsert({
      where: { itemId_userId: { itemId, userId } },
      create: { itemId, userId, value: dto.value },
      update: { value: dto.value },
    });

    const voteDto = toVoteDto(vote as VoteRow, userId, false);

    // Emit vote-cast event: only expose userId (never the value pre-reveal)
    this.realtime.emitToProject(
      item.session.projectId,
      PokerEvents.VoteCast,
      {
        sessionId: item.session.id,
        itemId,
        userId,
        // Value is deliberately omitted from the realtime event to keep cards hidden
      },
    );

    return voteDto;
  }

  // ── Reveal ────────────────────────────────────────────────────────────────────

  async revealItem(userId: string, itemId: string): Promise<PokerItemDto> {
    const item = await this.prisma.pokerItem.findUnique({
      where: { id: itemId },
      include: {
        session: { select: { id: true, projectId: true, state: true } },
        votes: true,
      },
    });
    if (!item) {
      throw new NotFoundException('Poker item not found');
    }
    if (item.session.state === PokerState.CLOSED) {
      throw new BadRequestException('Cannot reveal items in a closed session');
    }
    await assertProjectRole(
      this.prisma,
      userId,
      item.session.projectId,
      Role.MEMBER,
    );

    const updated = await this.prisma.pokerItem.update({
      where: { id: itemId },
      data: { revealed: true },
      include: { votes: true },
    });

    // After reveal, all votes are visible — pass any userId, revealed=true masks nothing
    const itemDto = toItemDto(updated as ItemRow, userId, true);

    this.realtime.emitToProject(
      item.session.projectId,
      PokerEvents.ItemRevealed,
      { sessionId: item.session.id, item: itemDto },
    );

    return itemDto;
  }

  // ── Commit ────────────────────────────────────────────────────────────────────

  async commitEstimate(
    userId: string,
    itemId: string,
    dto: CommitEstimateDto,
  ): Promise<PokerItemDto> {
    const item = await this.prisma.pokerItem.findUnique({
      where: { id: itemId },
      include: {
        session: { select: { id: true, projectId: true, state: true } },
        votes: true,
      },
    });
    if (!item) {
      throw new NotFoundException('Poker item not found');
    }
    if (item.session.state === PokerState.CLOSED) {
      throw new BadRequestException('Cannot commit estimate in a closed session');
    }
    await assertProjectRole(
      this.prisma,
      userId,
      item.session.projectId,
      Role.MEMBER,
    );

    // Update item's finalEstimate AND write the story points to the issue
    const [updatedItem] = await this.prisma.$transaction([
      this.prisma.pokerItem.update({
        where: { id: itemId },
        data: { finalEstimate: dto.finalEstimate },
        include: { votes: true },
      }),
      this.prisma.issue.update({
        where: { id: item.issueId },
        data: { storyPoints: dto.finalEstimate },
      }),
    ]);

    const itemDto = toItemDto(updatedItem as ItemRow, userId, true);

    this.realtime.emitToProject(
      item.session.projectId,
      PokerEvents.EstimateCommitted,
      { sessionId: item.session.id, item: itemDto },
    );

    return itemDto;
  }

  // ── Helper for socket.io room subscriptions ───────────────────────────────────

  /**
   * Validate that the user is a member of the project that owns this session.
   * Returns the projectId so callers can join the poker room.
   */
  async validateSessionMembership(
    userId: string,
    sessionId: string,
  ): Promise<string> {
    const session = await this.prisma.pokerSession.findUnique({
      where: { id: sessionId },
      select: { projectId: true },
    });
    if (!session) {
      throw new ForbiddenException('Poker session not found');
    }
    await assertProjectMember(this.prisma, userId, session.projectId);
    return session.projectId;
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import { toProjectDto } from '../projects/projects.service';
import { toStatusDto } from '../statuses/statuses.service';
import { toIssueDto } from '../issues/issue.mapper';
import { BoardType, Role, SprintState } from '@next-lane/shared';
import type { BoardDto, BoardSummaryDto, BoardColorRule } from '@next-lane/shared';
import type { CreateBoardDto } from './dto/create-board.dto';
import type { UpdateBoardDto } from './dto/update-board.dto';

/**
 * Maximum number of issues returned in a single board response.
 * Prevents OOM on projects with thousands of issues. When the cap is hit,
 * `issuesTruncated` is set to true in the response so the UI can inform
 * the user that results are partial.
 */
export const BOARD_ISSUES_CAP = 500;

const issueInclude = {
  status: true,
  assignee: true,
  reporter: true,
  labels: { include: { label: true } },
  project: { select: { key: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.IssueInclude;

/** Prisma Board row shape (subset needed for mapping). */
interface BoardRow {
  id: string;
  projectId: string;
  name: string;
  type: string;
  isDefault: boolean;
  order: number;
  filterQuery: string | null;
  colorRules: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Coerce the raw Prisma JSON value for colorRules into a typed array.
 * Returns [] for null/undefined or unparseable values.
 */
function coerceColorRules(raw: Prisma.JsonValue): BoardColorRule[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Prisma.JsonArray).filter(
    (item): item is Prisma.JsonObject =>
      item !== null && typeof item === 'object' && !Array.isArray(item),
  ).map((item) => ({
    id: String(item['id'] ?? ''),
    query: String(item['query'] ?? ''),
    color: String(item['color'] ?? ''),
    ...(item['label'] !== undefined ? { label: String(item['label']) } : {}),
  }));
}

export function toBoardSummaryDto(board: BoardRow): BoardSummaryDto {
  return {
    id: board.id,
    projectId: board.projectId,
    name: board.name,
    type: board.type as BoardType,
    isDefault: board.isDefault,
    order: board.order,
    filterQuery: board.filterQuery,
    colorRules: coerceColorRules(board.colorRules),
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
  };
}

/**
 * Build the issue where-clause for a board based on its type:
 * - KANBAN: backlog issues (sprintId null) OR issues in an ACTIVE sprint.
 * - SCRUM: only issues in an ACTIVE sprint.
 */
function buildIssueWhere(
  projectId: string,
  boardType: string,
): Prisma.IssueWhereInput {
  const base: Prisma.IssueWhereInput = {
    projectId,
    project: { archived: false },
  };

  if (boardType === BoardType.SCRUM) {
    return { ...base, sprint: { state: SprintState.ACTIVE } };
  }

  // KANBAN (default): backlog + active sprint
  return {
    ...base,
    OR: [
      { sprintId: null },
      { sprint: { state: SprintState.ACTIVE } },
    ],
  };
}

@Injectable()
export class BoardService {
  constructor(private readonly prisma: PrismaService) {}

  // ── List boards ─────────────────────────────────────────────────────────────

  async listBoards(userId: string, projectId: string): Promise<BoardSummaryDto[]> {
    await assertProjectMember(this.prisma, userId, projectId);
    const boards = await this.prisma.board.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return boards.map(toBoardSummaryDto);
  }

  // ── Create board ─────────────────────────────────────────────────────────────

  async createBoard(
    userId: string,
    projectId: string,
    dto: CreateBoardDto,
  ): Promise<BoardSummaryDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.MEMBER);

    const last = await this.prisma.board.findFirst({
      where: { projectId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const order = (last?.order ?? -1) + 1;

    const board = await this.prisma.board.create({
      data: {
        projectId,
        name: dto.name,
        type: dto.type,
        order,
        isDefault: false,
      },
    });

    return toBoardSummaryDto(board);
  }

  // ── Get board by id ──────────────────────────────────────────────────────────

  async getBoardById(userId: string, boardId: string): Promise<BoardDto> {
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
    });
    if (!board) throw new NotFoundException('Board not found');

    const project = await assertProjectMember(this.prisma, userId, board.projectId);

    const statuses = await this.prisma.status.findMany({
      where: { projectId: board.projectId },
      orderBy: { order: 'asc' },
    });

    const where = buildIssueWhere(board.projectId, board.type);
    const rows = await this.prisma.issue.findMany({
      where,
      include: issueInclude,
      orderBy: [{ status: { order: 'asc' } }, { rank: 'asc' }],
      take: BOARD_ISSUES_CAP + 1,
    });

    const issuesTruncated = rows.length > BOARD_ISSUES_CAP;
    const issues = issuesTruncated ? rows.slice(0, BOARD_ISSUES_CAP) : rows;

    return {
      board: toBoardSummaryDto(board),
      project: toProjectDto(project),
      statuses: statuses.map(toStatusDto),
      issues: issues.map(toIssueDto),
      issuesTruncated,
    };
  }

  // ── Update board ─────────────────────────────────────────────────────────────

  async updateBoard(
    userId: string,
    boardId: string,
    dto: UpdateBoardDto,
  ): Promise<BoardSummaryDto> {
    const existing = await this.prisma.board.findUnique({
      where: { id: boardId },
    });
    if (!existing) throw new NotFoundException('Board not found');

    await assertProjectRole(this.prisma, userId, existing.projectId, Role.MEMBER);

    const data: Prisma.BoardUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.filterQuery !== undefined) data.filterQuery = dto.filterQuery ?? null;
    if (dto.colorRules !== undefined) {
      // Store as plain JSON — Prisma accepts any JsonValue
      data.colorRules = dto.colorRules as unknown as Prisma.InputJsonValue;
    }

    const board = await this.prisma.board.update({
      where: { id: boardId },
      data,
    });

    return toBoardSummaryDto(board);
  }

  // ── Delete board ─────────────────────────────────────────────────────────────

  async deleteBoard(userId: string, boardId: string): Promise<{ id: string }> {
    const existing = await this.prisma.board.findUnique({
      where: { id: boardId },
    });
    if (!existing) throw new NotFoundException('Board not found');

    await assertProjectRole(this.prisma, userId, existing.projectId, Role.MEMBER);

    if (existing.isDefault) {
      throw new BadRequestException('Cannot delete the default board');
    }

    const count = await this.prisma.board.count({
      where: { projectId: existing.projectId },
    });
    if (count <= 1) {
      throw new ConflictException(
        'Cannot delete the only board in the project',
      );
    }

    await this.prisma.board.delete({ where: { id: boardId } });
    return { id: boardId };
  }

  // ── Legacy: get default board for a project ──────────────────────────────────

  async getBoard(userId: string, projectId: string): Promise<BoardDto> {
    const project = await assertProjectMember(this.prisma, userId, projectId);

    // Find the default board; lazily create one if the project has none.
    let board = await this.prisma.board.findFirst({
      where: { projectId, isDefault: true },
    });

    if (!board) {
      // Defensive fallback: project has no boards at all — lazily create one.
      board = await this.prisma.board.create({
        data: {
          projectId,
          name: 'Main Board',
          type: BoardType.KANBAN,
          order: 0,
          isDefault: true,
        },
      });
    }

    const statuses = await this.prisma.status.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });

    // The legacy endpoint always uses the default board's type to scope issues.
    const where = buildIssueWhere(projectId, board.type);
    const rows = await this.prisma.issue.findMany({
      where,
      include: issueInclude,
      orderBy: [{ status: { order: 'asc' } }, { rank: 'asc' }],
      take: BOARD_ISSUES_CAP + 1,
    });

    const issuesTruncated = rows.length > BOARD_ISSUES_CAP;
    const issues = issuesTruncated ? rows.slice(0, BOARD_ISSUES_CAP) : rows;

    return {
      board: toBoardSummaryDto(board),
      project: toProjectDto(project),
      statuses: statuses.map(toStatusDto),
      issues: issues.map(toIssueDto),
      issuesTruncated,
    };
  }
}

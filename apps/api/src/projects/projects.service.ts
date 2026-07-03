import {
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
  assertWorkspaceMember,
  assertWorkspaceRole,
} from '../common/membership.util';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import type { ListProjectActivityQueryDto } from './dto/list-project-activity.dto';
import { StatusCategory, Role, BoardType, SocketEvents } from '@next-lane/shared';
import type { ProjectDto, PaginatedProjectActivityDto, ProjectActivityItemDto } from '@next-lane/shared';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';

type ProjectRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  leadId: string | null;
  workspaceId: string;
  archived: boolean;
  workflowEnforced?: boolean;
  createdAt: Date;
};

export function toProjectDto(p: ProjectRow): ProjectDto {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    leadId: p.leadId,
    workspaceId: p.workspaceId,
    archived: p.archived,
    workflowEnforced: p.workflowEnforced ?? false,
    createdAt: p.createdAt.toISOString(),
  };
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async findAll(userId: string, workspaceId: string): Promise<ProjectDto[]> {
    await assertWorkspaceMember(this.prisma, userId, workspaceId);
    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    return projects.map(toProjectDto);
  }

  async create(
    userId: string,
    dto: CreateProjectDto,
    ip?: string | null,
  ): Promise<ProjectDto> {
    await assertWorkspaceRole(
      this.prisma,
      userId,
      dto.workspaceId,
      Role.MEMBER,
    );
    const key = dto.key.toUpperCase();

    const existing = await this.prisma.project.findUnique({
      where: { workspaceId_key: { workspaceId: dto.workspaceId, key } },
    });
    if (existing) {
      throw new ConflictException('Project key already in use');
    }

    const project = await this.prisma.project.create({
      data: {
        workspaceId: dto.workspaceId,
        key,
        name: dto.name,
        description: dto.description,
        statuses: {
          create: [
            { name: 'To Do', category: StatusCategory.TODO, order: 0 },
            {
              name: 'In Progress',
              category: StatusCategory.IN_PROGRESS,
              order: 1,
            },
            { name: 'Done', category: StatusCategory.DONE, order: 2 },
          ],
        },
        // Every project starts with a default Kanban board so the board view
        // works immediately. (The board read paths also lazily materialise one
        // as a defensive fallback for projects created before this.)
        boards: {
          create: [
            { name: 'Main Board', type: BoardType.KANBAN, order: 0, isDefault: true },
          ],
        },
      },
    });

    this.audit.record({
      workspaceId: dto.workspaceId,
      actorId: userId,
      action: 'project.create',
      targetType: 'Project',
      targetId: project.id,
      metadata: { key: project.key, name: project.name },
      ip,
    });

    return toProjectDto(project);
  }

  async findOne(userId: string, id: string): Promise<ProjectDto> {
    const project = await assertProjectMember(this.prisma, userId, id);
    return toProjectDto(project);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectDto> {
    await assertProjectRole(this.prisma, userId, id, Role.MEMBER);
    const data: {
      key?: string;
      name?: string;
      description?: string;
    } = {};
    if (dto.key !== undefined) data.key = dto.key.toUpperCase();
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;

    const project = await this.prisma.project.update({
      where: { id },
      data,
    });
    const dtoOut = toProjectDto(project);
    // Other open tabs/boards must see the renamed/re-keyed project without a
    // manual reload — mirrors the issue.updated / sprint.updated pattern.
    this.realtime.emitToProject(
      project.id,
      SocketEvents.ProjectUpdated,
      dtoOut,
    );
    return dtoOut;
  }

  async archive(
    userId: string,
    id: string,
    ip?: string | null,
  ): Promise<ProjectDto> {
    const projectBefore = await assertProjectRole(this.prisma, userId, id, Role.ADMIN);
    const project = await this.prisma.project.update({
      where: { id },
      data: { archived: true },
    });

    this.audit.record({
      workspaceId: projectBefore.workspaceId,
      actorId: userId,
      action: 'project.archive',
      targetType: 'Project',
      targetId: id,
      metadata: { key: project.key, name: project.name },
      ip,
    });

    const dtoOut = toProjectDto(project);
    this.realtime.emitToProject(project.id, SocketEvents.ProjectUpdated, dtoOut);
    return dtoOut;
  }

  // ── Project activity feed (Agent Experience Round 2, criterion 6) ─────────

  /** Default/max page size — same bounds as the audit log / issues cursor lists. */
  private static readonly ACTIVITY_DEFAULT_LIMIT = 50;

  /**
   * Unified, chronologically-merged, cursor-paginated project activity feed:
   * issue field changes (`ActivityLog`), comments, and work logs, across
   * every issue in the project. Lets an agent ask "what changed since I last
   * looked" in one cheap call instead of polling every issue individually.
   *
   * Ascending order (oldest-of-the-page first) so a caller can walk forward
   * from `since`/a prior `nextCursor` in event order. Authorization: project
   * VIEWER+ (a read).
   *
   * Implementation: fetches up to `limit + 1` rows from each of the three
   * source tables (independently keyset-filtered the same way), then merges
   * them in memory and takes the first `limit + 1` — this is the standard
   * k-way-merge pagination technique and is correct regardless of how the
   * true next page is distributed across the three sources, because no
   * source can contribute more than its own top `limit + 1` rows to it.
   */
  async getActivity(
    userId: string,
    projectId: string,
    query: ListProjectActivityQueryDto,
  ): Promise<PaginatedProjectActivityDto> {
    await assertProjectMember(this.prisma, userId, projectId);

    const limit = Math.min(
      Math.max(query.limit ?? ProjectsService.ACTIVITY_DEFAULT_LIMIT, 1),
      200,
    );
    const since = query.since ? new Date(query.since) : null;
    const cursor = query.cursor ? decodeActivityCursor(query.cursor) : null;
    const take = limit + 1;

    const cursorWhere = cursor
      ? {
          OR: [
            { createdAt: { gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { gt: cursor.id } },
          ],
        }
      : {};
    const sinceWhere = since ? { createdAt: { gt: since } } : {};

    const [activityRows, commentRows, workLogRows] = await Promise.all([
      this.prisma.activityLog.findMany({
        where: { issue: { projectId }, ...sinceWhere, ...cursorWhere },
        include: {
          actor: { select: { id: true, name: true } },
          issue: { select: { number: true, project: { select: { key: true } } } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take,
      }),
      this.prisma.comment.findMany({
        where: { issue: { projectId }, ...sinceWhere, ...cursorWhere },
        include: {
          author: { select: { id: true, name: true } },
          issue: { select: { number: true, project: { select: { key: true } } } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take,
      }),
      this.prisma.workLog.findMany({
        where: { issue: { projectId }, ...sinceWhere, ...cursorWhere },
        include: {
          user: { select: { id: true, name: true } },
          issue: { select: { number: true, project: { select: { key: true } } } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take,
      }),
    ]);

    type MergedRow = { createdAt: Date; id: string; toDto: () => ProjectActivityItemDto };

    const issueKey = (issue: { number: number; project: { key: string } }): string =>
      `${issue.project.key}-${issue.number}`;

    const merged: MergedRow[] = [
      ...activityRows.map((r) => ({
        createdAt: r.createdAt,
        id: r.id,
        toDto: (): ProjectActivityItemDto => ({
          id: r.id,
          kind: 'ISSUE_FIELD' as const,
          issueId: r.issueId,
          issueKey: issueKey(r.issue),
          actor: r.actor ? { id: r.actor.id, name: r.actor.name } : null,
          summary:
            r.field === 'created'
              ? 'created the issue'
              : `${r.field}: ${r.from ?? '(none)'} → ${r.to ?? '(none)'}`,
          field: r.field,
          from: r.from,
          to: r.to,
          createdAt: r.createdAt.toISOString(),
        }),
      })),
      ...commentRows.map((r) => ({
        createdAt: r.createdAt,
        id: r.id,
        toDto: (): ProjectActivityItemDto => ({
          id: r.id,
          kind: 'COMMENT' as const,
          issueId: r.issueId,
          issueKey: issueKey(r.issue),
          actor: r.author ? { id: r.author.id, name: r.author.name } : null,
          summary: 'commented',
          createdAt: r.createdAt.toISOString(),
        }),
      })),
      ...workLogRows.map((r) => ({
        createdAt: r.createdAt,
        id: r.id,
        toDto: (): ProjectActivityItemDto => ({
          id: r.id,
          kind: 'WORK_LOG' as const,
          issueId: r.issueId,
          issueKey: issueKey(r.issue),
          actor: r.user ? { id: r.user.id, name: r.user.name } : null,
          summary: `logged ${r.minutes}m${r.note ? `: ${r.note}` : ''}`,
          createdAt: r.createdAt.toISOString(),
        }),
      })),
    ];

    merged.sort((a, b) => {
      const diff = a.createdAt.getTime() - b.createdAt.getTime();
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });

    const hasMore = merged.length > limit;
    const page = hasMore ? merged.slice(0, limit) : merged;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeActivityCursor(last.createdAt, last.id) : null;

    return { items: page.map((row) => row.toDto()), nextCursor };
  }
}

/**
 * Encode an opaque cursor from `(createdAt, id)` for the project-activity
 * feed. Same base64url `iso|id` scheme as `IssuesService`'s issue-list cursor
 * and `AuditService`'s audit-log cursor — kept local (not shared) since each
 * pagination surface has its own sort order/direction.
 */
function encodeActivityCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

/** Decode a cursor produced by {@link encodeActivityCursor}. `null` on malformed input. */
function decodeActivityCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = decoded.indexOf('|');
    if (sep === -1) return null;
    const createdAt = new Date(decoded.slice(0, sep));
    const id = decoded.slice(sep + 1);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

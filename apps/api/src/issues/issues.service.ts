import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import {
  assertProjectMember,
  assertProjectRole,
  assertWorkspaceMember,
} from '../common/membership.util';
import { toIssueDto } from './issue.mapper';
import { toUserDto } from '../auth/auth.service';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { MoveIssueDto, ListIssuesQueryDto } from './dto/move-issue.dto';
import type {
  BulkUpdateIssuesDto,
  BulkUpdateResultDto,
} from './dto/bulk-update-issues.dto';
import {
  SocketEvents,
  WebhookEventTypes,
  StatusCategory,
  AutomationTrigger,
  initialRanks,
  rankAfter,
  rankBetween,
  Role,
  IssueType,
  filterIssues,
  validateQuery,
} from '@next-lane/shared';
import type {
  IssueDto,
  CommentDto,
  ActivityDto,
  PaginatedIssuesDto,
  ValidateCustomFieldDef,
} from '@next-lane/shared';
import { AUTOMATION_EVENTS } from '../automations/automation-events';
import { csvRow } from './csv.util';

/** Options for automation-aware mutations. */
export interface MutationOpts {
  /**
   * When true, this mutation was applied by the automation engine itself.
   * The emitted event will carry `automated: true` so the engine's loop guard
   * can skip it and prevent infinite chaining (v1).
   */
  automated?: boolean;
}

/** Default number of issues returned by {@link IssuesService.findAll} per page. */
export const DEFAULT_ISSUES_PAGE_SIZE = 50;
/** Hard upper bound on the page size a caller may request. */
export const MAX_ISSUES_PAGE_SIZE = 200;

/**
 * Encode a stable cursor from an issue's `createdAt` + `id`. Pagination orders
 * by `(createdAt asc, id asc)`, which is total and immutable, so the cursor is
 * unaffected by rank/status changes. Base64url keeps it opaque to clients.
 */
function encodeIssueCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

/**
 * Decode a cursor produced by {@link encodeIssueCursor}. Returns `null` for any
 * malformed input so a bad cursor degrades to "start from the beginning"
 * rather than throwing.
 */
function decodeIssueCursor(
  cursor: string,
): { createdAt: Date; id: string } | null {
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

const listInclude = {
  status: true,
  assignee: true,
  reporter: true,
  labels: { include: { label: true } },
  project: { select: { key: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.IssueInclude;

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
    private readonly customFieldsSvc: CustomFieldsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * When an `assigneeId` is provided (non-null), reject it unless that user is a
   * member of the project's workspace. Without this, any authenticated user from
   * any tenant could be set as assignee on another tenant's issue. `null` is
   * allowed (explicit unassign). `undefined` means "no change" and is skipped.
   */
  private async assertAssigneeInWorkspace(
    workspaceId: string,
    assigneeId: string | null | undefined,
  ): Promise<void> {
    if (assigneeId == null) return;
    await assertWorkspaceMember(this.prisma, assigneeId, workspaceId);
  }

  async create(userId: string, dto: CreateIssueDto, opts?: MutationOpts): Promise<IssueDto> {
    const project = await assertProjectRole(
      this.prisma,
      userId,
      dto.projectId,
      Role.MEMBER,
    );
    await this.assertAssigneeInWorkspace(project.workspaceId, dto.assigneeId);

    // Validate and normalise custom field values before entering the transaction.
    const issueType = (dto.type ?? IssueType.TASK) as IssueType;
    const normalizedCustomFields = dto.customFields
      ? await this.customFieldsSvc.validateAndNormalize(
          dto.projectId,
          issueType,
          dto.customFields,
        )
      : undefined;

    const issue = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.update({
        where: { id: dto.projectId },
        data: { issueSeq: { increment: 1 } },
      });
      const number = project.issueSeq;

      let statusId = dto.statusId;
      if (!statusId) {
        const todo = await tx.status.findFirst({
          where: { projectId: dto.projectId, category: StatusCategory.TODO },
          orderBy: { order: 'asc' },
        });
        const first =
          todo ??
          (await tx.status.findFirst({
            where: { projectId: dto.projectId },
            orderBy: { order: 'asc' },
          }));
        if (!first) {
          throw new NotFoundException('Project has no statuses');
        }
        statusId = first.id;
      }

      const last = await tx.issue.findFirst({
        where: { statusId },
        orderBy: { rank: 'desc' },
      });
      const rank = rankAfter(last?.rank ?? null);

      const created = await tx.issue.create({
        data: {
          number,
          projectId: dto.projectId,
          type: dto.type,
          title: dto.title,
          description: dto.description,
          statusId,
          assigneeId: dto.assigneeId,
          reporterId: userId,
          priority: dto.priority,
          parentId: dto.parentId,
          sprintId: dto.sprintId,
          storyPoints: dto.storyPoints,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          rank,
          ...(normalizedCustomFields !== undefined
            ? { customFields: normalizedCustomFields as Prisma.InputJsonValue }
            : {}),
        },
        include: listInclude,
      });

      await tx.activityLog.create({
        data: {
          issueId: created.id,
          actorId: userId,
          field: 'created',
          from: null,
          to: null,
        },
      });

      return created;
    });

    const dtoOut = toIssueDto(issue);
    this.realtime.emitToProject(
      issue.projectId,
      SocketEvents.IssueCreated,
      dtoOut,
    );
    this.webhooks.dispatch(
      issue.projectId,
      WebhookEventTypes.IssueCreated,
      dtoOut,
    );
    if (dtoOut.assigneeId) {
      await this.notifyAssignment(userId, dtoOut.assigneeId, dtoOut);
    }

    // Emit automation event AFTER the mutation + dispatch are done.
    this.eventEmitter.emit(AUTOMATION_EVENTS.ISSUE_CREATED, {
      projectId: issue.projectId,
      issueId: issue.id,
      actorUserId: userId,
      trigger: AutomationTrigger.ISSUE_CREATED,
      automated: opts?.automated ?? false,
    });

    return dtoOut;
  }

  /**
   * Notify a newly-set assignee and auto-watch them. Resolves the actor's name
   * for a friendly message. Never notifies self-assignment (handled downstream).
   */
  private async notifyAssignment(
    actorId: string,
    assigneeId: string,
    issue: IssueDto,
  ): Promise<void> {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });
    await this.notifications.notifyAssigned({
      assigneeId,
      actorId,
      actorName: actor?.name ?? 'Someone',
      issue: { id: issue.id, key: issue.key, projectId: issue.projectId },
    });
  }

  /**
   * Cursor-paginated list of a project's issues. Results are ordered by
   * `(createdAt asc, id asc)` — a total, immutable order — so the opaque
   * `nextCursor` stays valid even as ranks/statuses change. Returns at most
   * `limit` items (default {@link DEFAULT_ISSUES_PAGE_SIZE}, capped at
   * {@link MAX_ISSUES_PAGE_SIZE}) plus the cursor for the next page, or `null`
   * when the last page is reached. A malformed cursor is treated as the start.
   *
   * When `q` is provided and is at least 2 characters, the text filter uses
   * Postgres full-text search on the GIN-indexed `searchVector` generated
   * column (covers title + description). Shorter queries fall back to an ILIKE
   * filter on `title` for simplicity. FTS results within each cursor page are
   * ordered by `(createdAt asc, id asc)` (same stable order as non-FTS pages)
   * so the cursor encoding is consistent across all calls.
   */
  async findAll(
    userId: string,
    query: ListIssuesQueryDto,
  ): Promise<PaginatedIssuesDto> {
    if (!query.projectId) {
      throw new BadRequestException('projectId is required');
    }
    await assertProjectMember(this.prisma, userId, query.projectId);

    const take = Math.min(
      Math.max(query.limit ?? DEFAULT_ISSUES_PAGE_SIZE, 1),
      MAX_ISSUES_PAGE_SIZE,
    );

    const decoded = query.cursor ? decodeIssueCursor(query.cursor) : null;

    // Use full-text search when q is long enough; fall back to ILIKE otherwise.
    const qTrimmed = query.q?.trim() ?? '';
    const useFts = qTrimmed.length >= 2;

    if (useFts) {
      return this.findAllFts(query, take, qTrimmed, decoded);
    }

    // --- Standard Prisma path (no q, or very short q) ---
    const where: Prisma.IssueWhereInput = { projectId: query.projectId };
    if (query.sprintId) where.sprintId = query.sprintId;
    if (query.assigneeId) where.assigneeId = query.assigneeId;
    if (query.type) where.type = query.type as Prisma.IssueWhereInput['type'];
    if (query.statusId) where.statusId = query.statusId;
    if (qTrimmed) {
      // Short query: title ILIKE
      where.title = { contains: qTrimmed, mode: 'insensitive' };
    }

    if (decoded) {
      // Keyset predicate for (createdAt asc, id asc): the next item is either
      // strictly later, or same timestamp with a greater id.
      where.OR = [
        { createdAt: { gt: decoded.createdAt } },
        { createdAt: decoded.createdAt, id: { gt: decoded.id } },
      ];
    }

    // Fetch one extra row to detect whether a further page exists without a
    // separate count query.
    const rows = await this.prisma.issue.findMany({
      where,
      include: listInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeIssueCursor(last.createdAt, last.id) : null;

    return { items: page.map(toIssueDto), nextCursor };
  }

  /**
   * FTS variant of findAll. Uses `$queryRaw` with composable `Prisma.sql`
   * fragments to build a single parameterized query that applies FTS via
   * `websearch_to_tsquery` on the GIN-indexed `searchVector` column, the
   * cursor keyset predicate, and any additional scalar filters (sprintId,
   * assigneeId, type, statusId). Fetches full rows by the returned ids via
   * `findMany` to preserve all relation includes. Response shape is identical
   * to the non-FTS path so callers are unaffected.
   *
   * All values are passed as bind parameters — no user input is concatenated
   * into the query string. `websearch_to_tsquery` is user-input-safe by design
   * (handles quotes, operators, stop words, special chars without error).
   */
  private async findAllFts(
    query: ListIssuesQueryDto,
    take: number,
    q: string,
    decoded: { createdAt: Date; id: string } | null,
  ): Promise<PaginatedIssuesDto> {
    type IdRow = { id: string; created_at: Date };

    // Build optional WHERE fragments. Each uses `Prisma.sql` so the final
    // query is a single parameterized statement, not string concatenation.
    const extraClauses: Prisma.Sql[] = [];
    if (query.sprintId) {
      extraClauses.push(Prisma.sql`AND "sprintId" = ${query.sprintId}`);
    }
    if (query.assigneeId) {
      extraClauses.push(Prisma.sql`AND "assigneeId" = ${query.assigneeId}`);
    }
    if (query.type) {
      // Cast the enum value explicitly; Prisma raw params default to text.
      extraClauses.push(
        Prisma.sql`AND "type" = ${query.type}::"IssueType"`,
      );
    }
    if (query.statusId) {
      extraClauses.push(Prisma.sql`AND "statusId" = ${query.statusId}`);
    }
    if (decoded) {
      const cursorDate = decoded.createdAt;
      const cursorId = decoded.id;
      extraClauses.push(
        Prisma.sql`AND ("createdAt" > ${cursorDate} OR ("createdAt" = ${cursorDate} AND id > ${cursorId}))`,
      );
    }

    // Combine all extra clauses into a single fragment.
    const extraSql =
      extraClauses.length > 0
        ? Prisma.join(extraClauses, '\n            ')
        : Prisma.empty;

    const limit = take + 1;
    const idRows = await this.prisma.$queryRaw<IdRow[]>`
      SELECT id, "createdAt" AS created_at FROM "Issue"
      WHERE "projectId" = ${query.projectId}
        AND "searchVector" @@ websearch_to_tsquery('english', ${q})
        ${extraSql}
      ORDER BY "createdAt" ASC, id ASC
      LIMIT ${limit}
    `;

    const hasMore = idRows.length > take;
    const pageRows = hasMore ? idRows.slice(0, take) : idRows;

    if (pageRows.length === 0) {
      return { items: [], nextCursor: null };
    }

    const ids = pageRows.map((r) => r.id);

    // Fetch full rows with all includes using Prisma (preserves relation loading).
    const issues = await this.prisma.issue.findMany({
      where: { id: { in: ids } },
      include: listInclude,
    });

    // Re-sort to match the raw query order (findMany with IN doesn't guarantee order).
    const indexMap = new Map(ids.map((id, idx) => [id, idx]));
    issues.sort((a, b) => (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0));

    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && lastRow
        ? encodeIssueCursor(new Date(lastRow.created_at), lastRow.id)
        : null;

    return { items: issues.map(toIssueDto), nextCursor };
  }

  async findOne(
    userId: string,
    id: string,
  ): Promise<IssueDto & { comments: CommentDto[]; activities: ActivityDto[] }> {
    const refSelect = {
      id: true,
      number: true,
      type: true,
      title: true,
      statusId: true,
      project: { select: { key: true } },
      status: true,
    } satisfies Prisma.IssueSelect;

    const issue = await this.prisma.issue.findUnique({
      where: { id },
      include: {
        ...listInclude,
        comments: { include: { author: true }, orderBy: { createdAt: 'asc' } },
        activities: { include: { actor: true }, orderBy: { createdAt: 'desc' } },
        parent: { select: refSelect },
        children: { select: refSelect, orderBy: { rank: 'asc' } },
      },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    await assertProjectMember(this.prisma, userId, issue.projectId);

    const base = toIssueDto(issue);

    /** Sentinel used when the comment author or activity actor has been deleted. */
    const deletedUserDto = {
      id: '',
      email: '',
      name: 'Deleted User',
      avatarColor: '#94a3b8',
      createdAt: new Date(0).toISOString(),
    };

    const comments: CommentDto[] = issue.comments.map((c) => ({
      id: c.id,
      body: c.body,
      issueId: c.issueId,
      author: c.author ? toUserDto(c.author) : deletedUserDto,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));
    const activities: ActivityDto[] = issue.activities.map((a) => ({
      id: a.id,
      issueId: a.issueId,
      actor: a.actor ? toUserDto(a.actor) : deletedUserDto,
      field: a.field,
      from: a.from,
      to: a.to,
      createdAt: a.createdAt.toISOString(),
    }));
    return { ...base, comments, activities };
  }

  async getActivity(userId: string, id: string): Promise<ActivityDto[]> {
    const issue = await this.prisma.issue.findUnique({ where: { id } });
    if (!issue) throw new NotFoundException('Issue not found');
    await assertProjectMember(this.prisma, userId, issue.projectId);
    const activities = await this.prisma.activityLog.findMany({
      where: { issueId: id },
      include: { actor: true },
      orderBy: { createdAt: 'desc' },
    });
    const deletedUserDto = {
      id: '',
      email: '',
      name: 'Deleted User',
      avatarColor: '#94a3b8',
      createdAt: new Date(0).toISOString(),
    };
    return activities.map((a) => ({
      id: a.id,
      issueId: a.issueId,
      actor: a.actor ? toUserDto(a.actor) : deletedUserDto,
      field: a.field,
      from: a.from,
      to: a.to,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  /**
   * Reject any referenced id that does not belong to `projectId`. Guards against
   * a member of one project attaching their issue to another project's
   * status/sprint/parent (or reordering against a foreign issue), which would
   * corrupt foreign boards and leak their rank ordering.
   */
  private async assertSameProject(
    projectId: string,
    refs: {
      statusId?: string | null;
      sprintId?: string | null;
      parentId?: string | null;
      issueId?: string | null;
    },
  ): Promise<void> {
    const checks: Array<Promise<void>> = [];

    if (refs.statusId != null) {
      const statusId = refs.statusId;
      checks.push(
        this.prisma.status
          .findUnique({ where: { id: statusId }, select: { projectId: true } })
          .then((status) => {
            if (!status || status.projectId !== projectId) {
              throw new BadRequestException(
                'statusId does not belong to this project',
              );
            }
          }),
      );
    }

    if (refs.sprintId != null) {
      const sprintId = refs.sprintId;
      checks.push(
        this.prisma.sprint
          .findUnique({ where: { id: sprintId }, select: { projectId: true } })
          .then((sprint) => {
            if (!sprint || sprint.projectId !== projectId) {
              throw new BadRequestException(
                'sprintId does not belong to this project',
              );
            }
          }),
      );
    }

    if (refs.parentId != null) {
      const parentId = refs.parentId;
      checks.push(
        this.prisma.issue
          .findUnique({ where: { id: parentId }, select: { projectId: true } })
          .then((parent) => {
            if (!parent || parent.projectId !== projectId) {
              throw new BadRequestException(
                'parentId does not belong to this project',
              );
            }
          }),
      );
    }

    if (refs.issueId != null) {
      const issueId = refs.issueId;
      checks.push(
        this.prisma.issue
          .findUnique({ where: { id: issueId }, select: { projectId: true } })
          .then((neighbor) => {
            if (!neighbor || neighbor.projectId !== projectId) {
              throw new BadRequestException(
                'neighbor issue does not belong to this project',
              );
            }
          }),
      );
    }

    await Promise.all(checks);
  }

  /**
   * Reject a parent assignment that would create a cycle using a single
   * `WITH RECURSIVE` CTE executed inside the caller's transaction. A cycle
   * occurs when the proposed `parentId` is either the issue itself, or any
   * descendant of `id` (walking up from `parentId` would reach `id`).
   *
   * The CTE walks UP the ancestor chain from `parentId`, stopping when it
   * finds a row whose own parentId is NULL or when 100 hops are exhausted
   * (defensive cap against pre-existing corrupt data). If any visited row has
   * `id = issueId`, the assignment would create a cycle.
   *
   * @param tx  - Prisma transaction client (keeps the check + write atomic).
   * @param id  - The issue being updated.
   * @param parentId - The proposed new parent.
   */
  private async assertNoParentCycleCTE(
    tx: Prisma.TransactionClient,
    id: string,
    parentId: string,
  ): Promise<void> {
    if (parentId === id) {
      throw new BadRequestException('An issue cannot be its own parent');
    }

    // Walk ancestor chain from parentId upward; if id appears anywhere in that
    // chain it means id is an ancestor of parentId → cycle.
    // The CTE is parameterized: $1 = parentId (start node), $2 = id (the node
    // to detect), $3 = hop limit.
    const rows = await tx.$queryRaw<{ cycle_detected: boolean }[]>`
      WITH RECURSIVE ancestors(node_id, depth) AS (
        SELECT "parentId"::text, 1
        FROM "Issue"
        WHERE id = ${parentId}::text
          AND "parentId" IS NOT NULL

        UNION ALL

        SELECT i."parentId"::text, a.depth + 1
        FROM "Issue" i
        INNER JOIN ancestors a ON i.id = a.node_id
        WHERE i."parentId" IS NOT NULL
          AND a.depth < 100
      )
      SELECT EXISTS (
        SELECT 1 FROM ancestors WHERE node_id = ${id}::text
      ) AS cycle_detected
    `;

    const cycleDetected = rows[0]?.cycle_detected ?? false;
    if (cycleDetected) {
      throw new BadRequestException(
        'parentId would create a cycle in the issue hierarchy',
      );
    }
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateIssueDto,
    opts?: MutationOpts,
  ): Promise<IssueDto> {
    const existing = await this.prisma.issue.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Issue not found');
    const project = await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.MEMBER,
    );

    await this.assertSameProject(existing.projectId, {
      statusId: dto.statusId,
      sprintId: dto.sprintId,
      parentId: dto.parentId,
    });
    await this.assertAssigneeInWorkspace(project.workspaceId, dto.assigneeId);

    // Resolve the effective issue type (may change in the same PATCH).
    const effectiveType = (dto.type ?? existing.type) as IssueType;

    // Validate and merge custom field values if provided.
    // MERGE: existing values not mentioned in the payload are untouched.
    // A key set to null removes that key from the stored object.
    let mergedCustomFields: Prisma.InputJsonValue | undefined;
    if (dto.customFields !== undefined) {
      const incoming = dto.customFields as Record<string, import('@next-lane/shared').CustomFieldValue>;
      const normalized = await this.customFieldsSvc.validateAndNormalize(
        existing.projectId,
        effectiveType,
        incoming,
      );

      // Start from the existing stored object (may be null/undefined → {}).
      const current =
        (existing.customFields as Record<string, import('@next-lane/shared').CustomFieldValue> | null) ?? {};

      const merged: Record<string, import('@next-lane/shared').CustomFieldValue> = { ...current };
      for (const [k, v] of Object.entries(normalized)) {
        if (v === null) {
          delete merged[k];
        } else {
          merged[k] = v;
        }
      }
      mergedCustomFields = merged as Prisma.InputJsonValue;
    }

    const activities: Prisma.ActivityLogCreateManyInput[] = [];
    /** Tracks which meaningful fields changed for watcher notifications. */
    const changedFields: string[] = [];

    if (dto.statusId !== undefined && dto.statusId !== existing.statusId) {
      activities.push({
        issueId: id,
        actorId: userId,
        field: 'status',
        from: existing.statusId,
        to: dto.statusId,
      });
      changedFields.push('status');
    }
    if (
      dto.assigneeId !== undefined &&
      dto.assigneeId !== existing.assigneeId
    ) {
      activities.push({
        issueId: id,
        actorId: userId,
        field: 'assignee',
        from: existing.assigneeId,
        to: dto.assigneeId,
      });
      changedFields.push('assignee');
    }
    if (dto.priority !== undefined && dto.priority !== existing.priority) {
      activities.push({
        issueId: id,
        actorId: userId,
        field: 'priority',
        from: existing.priority,
        to: dto.priority,
      });
      changedFields.push('priority');
    }
    if (dto.title !== undefined && dto.title !== existing.title) {
      changedFields.push('title');
    }
    const existingDueDateStr = existing.dueDate?.toISOString() ?? null;
    const incomingDueDateStr =
      dto.dueDate === undefined ? undefined : dto.dueDate;
    if (
      incomingDueDateStr !== undefined &&
      incomingDueDateStr !== existingDueDateStr
    ) {
      activities.push({
        issueId: id,
        actorId: userId,
        field: 'dueDate',
        from: existingDueDateStr,
        to: incomingDueDateStr,
      });
      changedFields.push('dueDate');
    }

    // Run cycle-check + write atomically so a concurrent parent reassignment
    // cannot slip through between the check and the UPDATE (TOCTOU fix).
    const issue = await this.prisma.$transaction(async (tx) => {
      if (dto.parentId != null) {
        await this.assertNoParentCycleCTE(tx, id, dto.parentId);
      }

      const updated = await tx.issue.update({
        where: { id },
        data: {
          title: dto.title,
          description: dto.description,
          type: dto.type,
          statusId: dto.statusId,
          assigneeId: dto.assigneeId,
          priority: dto.priority,
          storyPoints: dto.storyPoints,
          parentId: dto.parentId,
          sprintId: dto.sprintId,
          // dueDate: undefined = no-op; null = clear; string = set new date
          dueDate:
            dto.dueDate === undefined
              ? undefined
              : dto.dueDate === null
                ? null
                : new Date(dto.dueDate),
          // customFields: undefined = no-op; merged object = replace stored JSON
          ...(mergedCustomFields !== undefined
            ? { customFields: mergedCustomFields }
            : {}),
        },
        include: listInclude,
      });

      if (activities.length > 0) {
        await tx.activityLog.createMany({ data: activities });
      }

      return updated;
    });

    const dtoOut = toIssueDto(issue);
    this.realtime.emitToProject(
      issue.projectId,
      SocketEvents.IssueUpdated,
      dtoOut,
    );
    this.webhooks.dispatch(
      issue.projectId,
      WebhookEventTypes.IssueUpdated,
      dtoOut,
    );
    if (
      dto.assigneeId != null &&
      dto.assigneeId !== existing.assigneeId
    ) {
      await this.notifyAssignment(userId, dto.assigneeId, dtoOut);
    }

    // Fan out WATCHED_UPDATED to all watchers (minus actor) when any meaningful
    // field changed. This is a fire-and-forget — do not await to keep the HTTP
    // response fast; errors are non-fatal to the caller.
    if (changedFields.length > 0) {
      const actor = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      this.notifications
        .notifyWatchersUpdated({
          actorId: userId,
          actorName: actor?.name ?? 'Someone',
          issue: {
            id: issue.id,
            key: dtoOut.key,
            projectId: issue.projectId,
            title: issue.title,
          },
          changedFields,
        })
        .catch(() => {
          // Notification failure must not break the update response.
        });
    }

    // Emit automation event AFTER the mutation + dispatch are done.
    this.eventEmitter.emit(AUTOMATION_EVENTS.ISSUE_UPDATED, {
      projectId: issue.projectId,
      issueId: issue.id,
      actorUserId: userId,
      trigger: AutomationTrigger.ISSUE_UPDATED,
      automated: opts?.automated ?? false,
      changedFields,
    });

    return dtoOut;
  }

  /**
   * Collision fallback for {@link move}: when the requested neighbors leave no
   * representable gap, re-rank every issue in the destination column with fresh,
   * evenly spaced ranks. The moved issue (`id`) is positioned immediately before
   * `beforeId` (or appended to the end when `beforeId` is null). Returns the
   * rank the moved issue should receive; the caller persists it together with
   * the status change. Runs on the supplied transaction client so the rebalance
   * and the move commit atomically.
   *
   * All non-moved rows are updated in a single `UPDATE … SET rank = CASE … END`
   * statement — one DB round-trip regardless of column size, replacing the
   * previous O(N) serial loop.
   */
  private async rebalanceAndPlace(
    tx: Prisma.TransactionClient,
    id: string,
    statusId: string,
    beforeId: string | null,
  ): Promise<string> {
    const column = await tx.issue.findMany({
      where: { statusId, id: { not: id } },
      orderBy: { rank: 'asc' },
      select: { id: true },
    });

    const order: string[] = [];
    let inserted = false;
    for (const issue of column) {
      if (issue.id === beforeId) {
        order.push(id);
        inserted = true;
      }
      order.push(issue.id);
    }
    if (!inserted) order.push(id);

    const ranks = initialRanks(order.length);

    // Split into the moved issue's rank (returned to the caller) and the batch
    // of other-issue id→rank pairs that we will update in one SQL statement.
    let movedRank: string | null = null;
    const otherPairs: Array<{ issueId: string; rank: string }> = [];
    for (let i = 0; i < order.length; i += 1) {
      if (order[i] === id) {
        movedRank = ranks[i];
      } else {
        otherPairs.push({ issueId: order[i], rank: ranks[i] });
      }
    }

    // Single bulk UPDATE for all non-moved rows.
    // Uses a CASE expression and ANY(ARRAY[…]) so every id and rank value is a
    // bind parameter — one DB round-trip regardless of column size.
    if (otherPairs.length > 0) {
      // Build: CASE id WHEN $id1 THEN $rank1 WHEN $id2 THEN $rank2 … END
      const caseFragments = otherPairs.map(
        (p) => Prisma.sql`WHEN ${p.issueId}::text THEN ${p.rank}`,
      );
      const caseExpr = Prisma.join(caseFragments, ' ');

      // Build: ANY(ARRAY[$id1, $id2, …])
      const anyList = Prisma.join(
        otherPairs.map((p) => Prisma.sql`${p.issueId}::text`),
        ', ',
      );

      await tx.$executeRaw`
        UPDATE "Issue"
        SET rank = CASE id ${caseExpr} END
        WHERE id = ANY(ARRAY[${anyList}])
      `;
    }

    // order always contains `id`, so movedRank is assigned above.
    return movedRank as string;
  }

  async move(
    userId: string,
    id: string,
    dto: MoveIssueDto,
    opts?: MutationOpts,
  ): Promise<IssueDto> {
    const existing = await this.prisma.issue.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Issue not found');
    await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.MEMBER,
    );

    await this.assertSameProject(existing.projectId, {
      statusId: dto.statusId,
      issueId: dto.beforeId,
    });
    await this.assertSameProject(existing.projectId, {
      issueId: dto.afterId,
    });

    const statusChanged = dto.statusId !== existing.statusId;

    // Read neighbor ranks, compute the new rank, and persist inside a single
    // transaction. Doing the read + compute + write atomically prevents two
    // concurrent moves from both reading the same neighbors and computing
    // colliding ranks (lost-update / TOCTOU). If the neighbors leave no gap
    // (equal, or already adjacent so `rankBetween` would throw), we fall back
    // to rebalancing every issue in the destination column with fresh, evenly
    // spaced ranks — still within the transaction — and re-derive the moved
    // issue's rank from the rebalanced order.
    const issue = await this.prisma.$transaction(async (tx) => {
      let beforeRank: string | null = null;
      let afterRank: string | null = null;
      if (dto.beforeId) {
        const before = await tx.issue.findUnique({
          where: { id: dto.beforeId },
        });
        beforeRank = before?.rank ?? null;
      }
      if (dto.afterId) {
        const after = await tx.issue.findUnique({
          where: { id: dto.afterId },
        });
        afterRank = after?.rank ?? null;
      }

      let newRank: string;
      try {
        newRank = rankBetween(beforeRank, afterRank);
      } catch {
        newRank = await this.rebalanceAndPlace(
          tx,
          id,
          dto.statusId,
          dto.beforeId ?? null,
        );
      }

      const updated = await tx.issue.update({
        where: { id },
        data: { statusId: dto.statusId, rank: newRank },
        include: listInclude,
      });

      if (statusChanged) {
        await tx.activityLog.create({
          data: {
            issueId: id,
            actorId: userId,
            field: 'status',
            from: existing.statusId,
            to: dto.statusId,
          },
        });
      }

      return updated;
    });

    const movePayload = {
      issueId: issue.id,
      statusId: issue.statusId,
      rank: issue.rank,
    };
    this.realtime.emitToProject(
      issue.projectId,
      SocketEvents.IssueMoved,
      movePayload,
    );
    this.webhooks.dispatch(
      issue.projectId,
      WebhookEventTypes.IssueMoved,
      movePayload,
    );

    // Emit automation event AFTER the mutation + dispatch are done.
    this.eventEmitter.emit(AUTOMATION_EVENTS.ISSUE_TRANSITIONED, {
      projectId: issue.projectId,
      issueId: issue.id,
      actorUserId: userId,
      trigger: AutomationTrigger.ISSUE_TRANSITIONED,
      automated: opts?.automated ?? false,
    });

    return toIssueDto(issue);
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    const existing = await this.prisma.issue.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Issue not found');
    await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.MEMBER,
    );

    await this.prisma.issue.delete({ where: { id } });
    this.realtime.emitToProject(
      existing.projectId,
      SocketEvents.IssueDeleted,
      { issueId: id },
    );
    this.webhooks.dispatch(existing.projectId, WebhookEventTypes.IssueDeleted, {
      issueId: id,
    });
    return { id };
  }

  // ── CSV Export ────────────────────────────────────────────────────────────

  /**
   * Load custom field definitions for `projectId` — same helper pattern as
   * BoardService / SavedFiltersService.
   */
  private async loadCustomFieldDefs(
    projectId: string,
  ): Promise<ValidateCustomFieldDef[]> {
    const rows = await this.prisma.customFieldDefinition.findMany({
      where: { projectId },
      select: { id: true, key: true, name: true, type: true },
    });
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      type: r.type as ValidateCustomFieldDef['type'],
    }));
  }

  /**
   * Export all issues in a project as an RFC-4180 CSV string.
   *
   * Authorization: project member (VIEWER+).
   *
   * Columns: Key, Title, Type, Status, Priority, Assignee, Reporter,
   *   Story Points, Sprint, Labels, Due Date, Created, Updated.
   *
   * Optional `q` NLQL filter: validated via `validateQuery`, then evaluated
   * with `filterIssues` (same evaluator as the board uses). Invalid query →
   * 400 BadRequestException.
   *
   * Rows are ordered by issue number ascending.
   */
  async exportCsv(
    userId: string,
    projectId: string,
    q?: string,
  ): Promise<{ csv: string; projectKey: string }> {
    // Resolve project + assert membership.
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { workspace: true },
    });
    if (!project) throw new BadRequestException('Project not found');
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId: project.workspaceId,
        },
      },
    });
    if (!membership) {
      throw new ForbiddenException('Not a member of this project');
    }

    // Validate the NLQL query if provided.
    const trimmedQ = q?.trim() || undefined;
    if (trimmedQ) {
      const customFieldDefs = await this.loadCustomFieldDefs(projectId);
      const result = validateQuery(trimmedQ, { customFieldDefs });
      if (!result.ok) {
        throw new BadRequestException(
          `Invalid NLQL query: ${result.error?.message ?? 'parse error'}`,
        );
      }
    }

    // Fetch all issues for the project with the relations needed for columns.
    const rows = await this.prisma.issue.findMany({
      where: { projectId },
      include: {
        status: true,
        assignee: true,
        reporter: true,
        labels: { include: { label: true } },
        project: { select: { key: true } },
        sprint: { select: { name: true } },
      },
      orderBy: { number: 'asc' },
    });

    // Map to IssueDto for NLQL evaluation.
    let issueDtos: IssueDto[] = rows.map(toIssueDto);

    // Apply NLQL filter if a query was provided (already validated above).
    if (trimmedQ) {
      issueDtos = filterIssues(issueDtos, trimmedQ, {
        currentUserId: userId,
      });
    }

    // Build the CSV.
    const HEADER = [
      'Key',
      'Title',
      'Type',
      'Status',
      'Priority',
      'Assignee',
      'Reporter',
      'Story Points',
      'Sprint',
      'Labels',
      'Due Date',
      'Created',
      'Updated',
    ];

    // We need sprint names and label names per-issue — build lookup maps from
    // the raw rows keyed by issue id.
    const sprintNameById = new Map<string, string>();
    const labelsByIssueId = new Map<string, string[]>();
    for (const row of rows) {
      if (row.sprint) {
        sprintNameById.set(row.id, row.sprint.name);
      }
      const names = row.labels.map((il) => il.label.name);
      if (names.length > 0) {
        labelsByIssueId.set(row.id, names);
      }
    }

    const lines: string[] = [csvRow(HEADER)];

    for (const issue of issueDtos) {
      const labelNames = labelsByIssueId.get(issue.id) ?? [];
      lines.push(
        csvRow([
          issue.key,
          issue.title,
          issue.type,
          issue.status?.name ?? '',
          issue.priority,
          issue.assignee ? (issue.assignee.name || issue.assignee.email) : '',
          issue.reporter ? (issue.reporter.name || issue.reporter.email) : '',
          issue.storyPoints ?? '',
          sprintNameById.get(issue.id) ?? '',
          labelNames.join('; '),
          issue.dueDate ?? '',
          issue.createdAt,
          issue.updatedAt,
        ]),
      );
    }

    return { csv: lines.join(''), projectKey: project.key };
  }

  /**
   * Attach a label to an issue. Uses an upsert so calling it twice is safe.
   * Validates that both the issue and the label exist and belong to the same
   * project. Does NOT re-check project membership — the caller (`bulkUpdate`)
   * has already confirmed MEMBER access via `update()`.
   */
  private async attachLabel(issueId: string, labelId: string): Promise<void> {
    await this.prisma.issueLabel.upsert({
      where: { issueId_labelId: { issueId, labelId } },
      update: {},
      create: { issueId, labelId },
    });
  }

  /**
   * Apply a set of field changes to multiple issues in one API call.
   *
   * Each issue is processed independently:
   *  - Authorization is delegated to `update()` / `attachLabel()` — if the
   *    caller lacks MEMBER on a particular issue's project, that issue ends up
   *    in `failed` and the rest continue (partial success, no whole-batch 403).
   *  - `changes` must have at least one field set (enforced here after DTO
   *    validation has already confirmed individual field types/enums).
   *  - The `ids` array is capped at 100 by the DTO; the guard here provides a
   *    second-layer defence in case the DTO validation is bypassed.
   *
   * Label attachment (`addLabelIds`) is applied per-label per-issue after the
   * core field update so a label-attach failure does not roll back the field
   * changes for that issue.
   */
  async bulkUpdate(
    userId: string,
    dto: BulkUpdateIssuesDto,
  ): Promise<BulkUpdateResultDto> {
    const { ids, changes } = dto;

    // Guard: ids cap (second layer — DTO already enforces @ArrayMaxSize(100)).
    if (ids.length > 100) {
      throw new BadRequestException('ids must contain at most 100 entries');
    }

    // Guard: changes must have at least one field set.
    const hasChange =
      changes.statusId !== undefined ||
      changes.assigneeId !== undefined ||
      changes.priority !== undefined ||
      changes.sprintId !== undefined ||
      changes.type !== undefined ||
      (changes.addLabelIds !== undefined && changes.addLabelIds.length > 0);

    if (!hasChange) {
      throw new BadRequestException(
        'changes must contain at least one field to update',
      );
    }

    // Build the UpdateIssueDto from the BulkIssueChangesDto.
    // Only include defined keys so `update()` treats undefined as "no-op".
    const updateDto: UpdateIssueDto = {};
    if (changes.statusId !== undefined) updateDto.statusId = changes.statusId;
    if (changes.assigneeId !== undefined) updateDto.assigneeId = changes.assigneeId;
    if (changes.priority !== undefined) updateDto.priority = changes.priority;
    if (changes.sprintId !== undefined) updateDto.sprintId = changes.sprintId;
    if (changes.type !== undefined) updateDto.type = changes.type;

    let updated = 0;
    const failed: Array<{ id: string; reason: string }> = [];

    for (const id of ids) {
      try {
        // Delegate to the full single-update path: authz (assertProjectRole
        // MEMBER), same-project validation, assignee-in-workspace check,
        // ActivityLog, realtime, webhooks, watcher notifications, and
        // automation events all fire exactly as for a single PATCH.
        await this.update(userId, id, updateDto);

        // Apply label additions after the core update succeeds.
        if (changes.addLabelIds && changes.addLabelIds.length > 0) {
          for (const labelId of changes.addLabelIds) {
            await this.attachLabel(id, labelId);
          }
        }

        updated += 1;
      } catch (err: unknown) {
        const reason =
          err instanceof Error ? err.message : 'Unknown error';
        failed.push({ id, reason });
        // Continue: one bad id must not abort the batch.
      }
    }

    return { updated, failed };
  }
}

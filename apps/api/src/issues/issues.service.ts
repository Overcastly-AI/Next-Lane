import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';
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
import {
  SocketEvents,
  WebhookEventTypes,
  StatusCategory,
  initialRanks,
  rankAfter,
  rankBetween,
  Role,
} from '@next-lane/shared';
import type {
  IssueDto,
  CommentDto,
  ActivityDto,
  PaginatedIssuesDto,
} from '@next-lane/shared';

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

  async create(userId: string, dto: CreateIssueDto): Promise<IssueDto> {
    const project = await assertProjectRole(
      this.prisma,
      userId,
      dto.projectId,
      Role.MEMBER,
    );
    await this.assertAssigneeInWorkspace(project.workspaceId, dto.assigneeId);

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
    const comments: CommentDto[] = issue.comments.map((c) => ({
      id: c.id,
      body: c.body,
      issueId: c.issueId,
      author: toUserDto(c.author),
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));
    const activities: ActivityDto[] = issue.activities.map((a) => ({
      id: a.id,
      issueId: a.issueId,
      actor: toUserDto(a.actor),
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
    return activities.map((a) => ({
      id: a.id,
      issueId: a.issueId,
      actor: toUserDto(a.actor),
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

    const activities: Prisma.ActivityLogCreateManyInput[] = [];
    if (dto.statusId !== undefined && dto.statusId !== existing.statusId) {
      activities.push({
        issueId: id,
        actorId: userId,
        field: 'status',
        from: existing.statusId,
        to: dto.statusId,
      });
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
    }
    if (dto.priority !== undefined && dto.priority !== existing.priority) {
      activities.push({
        issueId: id,
        actorId: userId,
        field: 'priority',
        from: existing.priority,
        to: dto.priority,
      });
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
    let movedRank: string | null = null;
    for (let i = 0; i < order.length; i += 1) {
      if (order[i] === id) {
        movedRank = ranks[i];
        continue; // caller writes the moved issue's rank + status together
      }
      await tx.issue.update({
        where: { id: order[i] },
        data: { rank: ranks[i] },
      });
    }
    // order always contains `id`, so movedRank is assigned above.
    return movedRank as string;
  }

  async move(
    userId: string,
    id: string,
    dto: MoveIssueDto,
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
}

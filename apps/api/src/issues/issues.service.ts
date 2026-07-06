import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { WorkflowService } from '../workflows/workflow.service';
import {
  assertProjectMember,
  assertProjectRole,
  assertWorkspaceMember,
} from '../common/membership.util';
import { loadNlqlEvalContext } from '../common/nlql-eval-context.util';
import { withIdempotency } from '../common/idempotency.util';
import { toIssueDto } from './issue.mapper';
import type { IssueWithRelations } from './issue.mapper';
import { toUserDto } from '../auth/auth.service';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { MoveIssueDto, ListIssuesQueryDto } from './dto/move-issue.dto';
import type {
  BulkIssueChangesDto,
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
  BoardType,
  SprintState,
  filterIssues,
  validateQuery,
  getReferencedFieldKinds,
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

  /**
   * Pre-loaded workflow enforcement context from the caller (e.g. bulkUpdate).
   * When provided, `enforceTransition` skips the per-call project lookup and
   * uses this value directly, saving one DB round-trip per issue in bulk paths.
   *
   * - `undefined`: no hint; `enforceTransition` will load the project itself.
   * - `false`: the caller already determined enforcement is off; skip entirely.
   * - `true`: enforcement is on; proceed with the full transition check.
   */
  workflowEnforced?: boolean;

  /**
   * Pre-resolved WF-1 named-workflow id for this specific issue, computed
   * once per batch by `bulkUpdate`'s preload (`buildBulkWorkflowResolution`)
   * instead of letting `enforceStatusChange`'s `resolveEnforcedWorkflowId`
   * branch re-query `board`/`sprint` for every issue in the batch (P2-1,
   * Pass-12 engineering audit — the WF-1 unification's precomputation only
   * ever fed the legacy fallback via `workflowEnforced`, not this path).
   *
   * - `undefined`: not pre-resolved (the default for `move()`/`update()`
   *   called directly, outside `bulkUpdate`) — compute it normally.
   * - `null`: pre-resolved to "no enforced named workflow applies" — fall
   *   through to the legacy project-level path without a DB round trip.
   * - `string`: pre-resolved workflow id — enforce it directly.
   */
  resolvedWorkflowId?: string | null;
}

/**
 * Return shape of {@link IssuesService.prepareUpdate} — the guard/validation
 * phase of an issue update, computed before any write. Shared by the
 * single-issue `update()` path and the atomic/dry-run bulk paths
 * (`bulkUpdateAtomic`, `bulkUpdateDryRun`).
 */
interface PreparedIssueUpdate {
  existing: {
    id: string;
    projectId: string;
    statusId: string;
    assigneeId: string | null;
    sprintId: string | null;
  };
  activities: Prisma.ActivityLogCreateManyInput[];
  changedFields: string[];
  mergedCustomFields?: Prisma.InputJsonValue;
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
  versions: { include: { version: { select: { id: true, name: true, state: true } } } },
  project: { select: { key: true } },
  _count: { select: { comments: true } },
  component: { select: { id: true, name: true } },
  checklistItems: { orderBy: { order: 'asc' as const } },
  // Work-log minutes for the timeSpentMinutes rollup (select only what the mapper needs).
  workLogs: { select: { minutes: true } },
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
    @Inject(forwardRef(() => WorkflowService))
    private readonly workflowSvc: WorkflowService,
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

  /**
   * When both a start date and a due date are present (after applying the
   * incoming DTO on top of any existing values), reject the combination if
   * startDate is after dueDate. Either side being absent (undefined/null)
   * skips the check — this only guards against an inverted range, not
   * against having just one of the two set.
   */
  private assertStartBeforeDue(
    startDateIso: string | null | undefined,
    dueDateIso: string | null | undefined,
  ): void {
    if (!startDateIso || !dueDateIso) return;
    if (new Date(startDateIso).getTime() > new Date(dueDateIso).getTime()) {
      throw new BadRequestException('startDate must be on or before dueDate');
    }
  }

  /**
   * Create an issue. When `dto.idempotencyKey` is set, retrying this call
   * with the SAME key (scoped to this user) within the idempotency window
   * replays the original created issue instead of filing a duplicate — see
   * {@link withIdempotency} (Agent Experience Round 2, criterion 2).
   */
  async create(userId: string, dto: CreateIssueDto, opts?: MutationOpts): Promise<IssueDto> {
    const { idempotencyKey, ...payload } = dto;
    return withIdempotency(
      this.prisma,
      {
        userId,
        endpoint: 'POST /issues',
        key: idempotencyKey,
        requestFingerprint: payload,
      },
      () => this.createInner(userId, dto, opts),
    );
  }

  private async createInner(
    userId: string,
    dto: CreateIssueDto,
    opts?: MutationOpts,
  ): Promise<IssueDto> {
    const project = await assertProjectRole(
      this.prisma,
      userId,
      dto.projectId,
      Role.MEMBER,
    );
    await this.assertAssigneeInWorkspace(project.workspaceId, dto.assigneeId);

    // Reject any cross-project reference BEFORE creating anything. Agent
    // Experience Round 2 (P1, confirmed live 2026-07-03): POST /issues
    // accepted a statusId from a DIFFERENT project — the issue landed in
    // this project carrying the other project's status, rendering in no
    // board column (an invisible ticket). sprintId/parentId had the same gap
    // on create (update()/move() already guarded all of these). componentId
    // was already checked here; now every foreign-id field on create shares
    // one guard with precise, per-field 400 messages.
    await this.assertSameProject(dto.projectId, {
      statusId: dto.statusId,
      sprintId: dto.sprintId,
      parentId: dto.parentId,
      componentId: dto.componentId,
    });

    this.assertStartBeforeDue(dto.startDate, dto.dueDate);

    // Resolve default assignee from the component when no explicit assignee given.
    let effectiveAssigneeId = dto.assigneeId;
    if (dto.componentId != null && effectiveAssigneeId === undefined) {
      const component = await this.prisma.component.findUnique({
        where: { id: dto.componentId },
        select: { defaultAssigneeId: true },
      });
      if (component?.defaultAssigneeId) {
        effectiveAssigneeId = component.defaultAssigneeId;
      }
    }

    // Validate and normalise custom field values before entering the transaction.
    const issueType = (dto.type ?? IssueType.TASK) as IssueType;
    const normalizedCustomFields = dto.customFields
      ? await this.customFieldsSvc.validateAndNormalize(
          dto.projectId,
          issueType,
          dto.customFields,
        )
      : undefined;

    // Resolve the default status BEFORE opening the transaction when the
    // caller didn't supply one. This is a pure read with no dependency on —
    // and no side effect inside — the atomic write below (creating the
    // issue), so it doesn't need to share the transaction's connection; a
    // status added/removed in the few ms between this read and the commit
    // below is an already-accepted, vanishingly rare race (the previous
    // in-transaction version had the same window, just narrower). Moving it
    // out trims two round-trips off the transaction's held-connection time —
    // see the timeout/maxWait comment below for why that matters.
    let statusId = dto.statusId;
    if (!statusId) {
      const todo = await this.prisma.status.findFirst({
        where: { projectId: dto.projectId, category: StatusCategory.TODO },
        orderBy: { order: 'asc' },
      });
      const first =
        todo ??
        (await this.prisma.status.findFirst({
          where: { projectId: dto.projectId },
          orderBy: { order: 'asc' },
        }));
      if (!first) {
        throw new NotFoundException('Project has no statuses');
      }
      statusId = first.id;
    }
    const resolvedStatusId = statusId;

    const issue = await this.prisma.$transaction(
      async (tx) => {
        const project = await tx.project.update({
          where: { id: dto.projectId },
          data: { issueSeq: { increment: 1 } },
        });
        const number = project.issueSeq;

        const last = await tx.issue.findFirst({
          where: { statusId: resolvedStatusId },
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
            statusId: resolvedStatusId,
            assigneeId: effectiveAssigneeId,
            reporterId: userId,
            priority: dto.priority,
            parentId: dto.parentId,
            sprintId: dto.sprintId,
            storyPoints: dto.storyPoints,
            startDate: dto.startDate ? new Date(dto.startDate) : undefined,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
            rank,
            componentId: dto.componentId ?? null,
            ...(dto.originalEstimateMinutes !== undefined
              ? { originalEstimateMinutes: dto.originalEstimateMinutes }
              : {}),
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
      },
      // QA (2026-07-06, P3): POST /issues 500'd twice under 2-worker e2e
      // parallelism in a resource-constrained sandbox with "Transaction
      // already closed... timeout 5000 ms" — Prisma's defaults (timeout:
      // 5000ms, maxWait: 2000ms) aren't generous enough once the DB
      // connection pool is under real contention (several concurrent
      // requests each holding/awaiting a connection for this same short
      // transaction). This transaction now does the minimum necessary work
      // (issueSeq increment, rank lookup, the insert, and its activity-log
      // row — all of which genuinely need to commit atomically together),
      // so a longer ceiling here only protects against pool contention, not
      // a runaway query: `timeout` (12s) is how long the transaction body
      // may run once it has a connection — the value that fixes the observed
      // flake. `maxWait` (how long a request may QUEUE for a connection) is
      // kept at a tighter 5s: under genuine sustained pool exhaustion, a
      // large maxWait makes every request pile up and hold the line instead
      // of shedding load (security review on 6fd9201, should-fix 5 — the
      // worst case here is ~17s, inside typical 30s proxy budgets).
      { timeout: 12_000, maxWait: 5_000 },
    );

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
      // The issue is already committed at this point; a notification failure
      // must not fail the create — under an idempotencyKey it would release
      // the claim after the write, and the client's retry would then file a
      // real duplicate.
      await this.notifyAssignment(userId, dtoOut.assigneeId, dtoOut).catch(
        () => {},
      );
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
      emailNotifications: false,
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
      emailNotifications: false,
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
   * status/sprint/parent/component (or reordering against a foreign issue), which
   * would corrupt foreign boards and leak their rank ordering.
   */
  private async assertSameProject(
    projectId: string,
    refs: {
      statusId?: string | null;
      sprintId?: string | null;
      parentId?: string | null;
      issueId?: string | null;
      componentId?: string | null;
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

    if (refs.componentId != null) {
      const componentId = refs.componentId;
      checks.push(
        this.prisma.component
          .findUnique({ where: { id: componentId }, select: { projectId: true } })
          .then((component) => {
            if (!component || component.projectId !== projectId) {
              throw new BadRequestException(
                'componentId does not belong to this project',
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
    const prep = await this.prepareUpdate(userId, id, dto, opts);
    const issue = await this.prisma.$transaction((tx) =>
      this.writeIssueUpdate(tx, id, dto, prep.activities, prep.mergedCustomFields),
    );
    return this.finishUpdate(userId, issue, prep.existing, dto, prep.changedFields, opts);
  }

  /**
   * Guard-check + business-rule phase of an issue update: authorization,
   * cross-project reference validation, workflow-transition enforcement, and
   * the ActivityLog/customFields diff — everything `update()` used to do
   * BEFORE opening its `$transaction`. Performs only reads, no writes.
   *
   * Extracted (Agent Experience Round 2, criterion 3) so `bulkUpdateAtomic`
   * can validate every issue in a batch FIRST, and only open a single shared
   * transaction once every issue has passed — the "all-or-nothing" half of
   * atomic bulk updates. `update()` itself calls this too, so the
   * single-issue path is unchanged in behavior (same checks, same order).
   */
  private async prepareUpdate(
    userId: string,
    id: string,
    dto: UpdateIssueDto,
    opts?: MutationOpts,
  ): Promise<PreparedIssueUpdate> {
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
      componentId: dto.componentId,
    });
    await this.assertAssigneeInWorkspace(project.workspaceId, dto.assigneeId);

    {
      const effectiveStartDate =
        dto.startDate === undefined
          ? (existing.startDate?.toISOString() ?? null)
          : dto.startDate;
      const effectiveDueDate =
        dto.dueDate === undefined
          ? (existing.dueDate?.toISOString() ?? null)
          : dto.dueDate;
      this.assertStartBeforeDue(effectiveStartDate, effectiveDueDate);
    }

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

    // Enforce workflow gate BEFORE applying the status change.
    // Automation-applied moves bypass enforcement (opts.automated === true).
    // Bulk callers may pass workflowEnforced=false to skip the per-issue project
    // lookup when they have already pre-loaded the enforcement flag.
    if (dto.statusId !== undefined && dto.statusId !== existing.statusId) {
      await this.enforceStatusChange(
        id,
        dto.statusId,
        { projectId: existing.projectId, sprintId: existing.sprintId },
        opts,
      );
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
    const existingStartDateStr = existing.startDate?.toISOString() ?? null;
    const incomingStartDateStr =
      dto.startDate === undefined ? undefined : dto.startDate;
    if (
      incomingStartDateStr !== undefined &&
      incomingStartDateStr !== existingStartDateStr
    ) {
      activities.push({
        issueId: id,
        actorId: userId,
        field: 'startDate',
        from: existingStartDateStr,
        to: incomingStartDateStr,
      });
      changedFields.push('startDate');
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

    // Sprint / parent / component moves were previously never logged (MCP-QA
    // pass 2, top finding): a bulk sprint re-scope or epic re-parenting left
    // zero trace in the activity feed AND didn't bump agent-context
    // staleness — the server asserted "nothing happened" after a flagship
    // bulk operation. Both consumers count ActivityLog rows, so logging here
    // fixes the feed and staleness together (single-issue and bulk paths
    // share prepareUpdate).
    if (dto.sprintId !== undefined && dto.sprintId !== existing.sprintId) {
      activities.push({
        issueId: id,
        actorId: userId,
        field: 'sprint',
        from: existing.sprintId,
        to: dto.sprintId,
      });
      changedFields.push('sprint');
    }
    if (dto.parentId !== undefined && dto.parentId !== existing.parentId) {
      activities.push({
        issueId: id,
        actorId: userId,
        field: 'parent',
        from: existing.parentId,
        to: dto.parentId,
      });
      changedFields.push('parent');
    }
    if (
      dto.componentId !== undefined &&
      dto.componentId !== existing.componentId
    ) {
      activities.push({
        issueId: id,
        actorId: userId,
        field: 'component',
        from: existing.componentId,
        to: dto.componentId,
      });
      changedFields.push('component');
    }

    return { existing, activities, changedFields, mergedCustomFields };
  }

  /**
   * Write phase of an issue update: the parent-cycle check (TOCTOU-safe,
   * runs on the same transaction as the write) + the `Issue.update` + its
   * ActivityLog rows. Takes the caller's transaction client so:
   *  - `update()` opens a dedicated single-issue `$transaction` (unchanged
   *    behavior from before this was split out).
   *  - `bulkUpdateAtomic` shares ONE transaction across every issue in the
   *    batch, so a failure on issue N rolls back issues 1..N-1 too.
   */
  private async writeIssueUpdate(
    tx: Prisma.TransactionClient,
    id: string,
    dto: UpdateIssueDto,
    activities: Prisma.ActivityLogCreateManyInput[],
    mergedCustomFields: Prisma.InputJsonValue | undefined,
  ): Promise<IssueWithRelations> {
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
        // startDate: undefined = no-op; null = clear; string = set new date
        startDate:
          dto.startDate === undefined
            ? undefined
            : dto.startDate === null
              ? null
              : new Date(dto.startDate),
        // dueDate: undefined = no-op; null = clear; string = set new date
        dueDate:
          dto.dueDate === undefined
            ? undefined
            : dto.dueDate === null
              ? null
              : new Date(dto.dueDate),
        // componentId: undefined = no-op; null = clear; string = set new component
        ...(dto.componentId !== undefined
          ? { componentId: dto.componentId }
          : {}),
        // originalEstimateMinutes: undefined = no-op; null = clear; number = set
        ...(dto.originalEstimateMinutes !== undefined
          ? { originalEstimateMinutes: dto.originalEstimateMinutes }
          : {}),
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
  }

  /**
   * Side-effect phase of an issue update: realtime + webhook dispatch,
   * assignment/watcher notifications, and the automation event — everything
   * that must only happen AFTER the write has actually committed. Split out
   * so `bulkUpdateAtomic` can run this once per issue after its single
   * shared transaction commits, instead of interleaving side effects with
   * writes that might still roll back.
   */
  private async finishUpdate(
    userId: string,
    issue: IssueWithRelations,
    existing: PreparedIssueUpdate['existing'],
    dto: UpdateIssueDto,
    changedFields: string[],
    opts?: MutationOpts,
  ): Promise<IssueDto> {
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
      // Post-commit side effect: never let a notification failure surface as
      // a failed update (the write is already durable).
      await this.notifyAssignment(userId, dto.assigneeId, dtoOut).catch(
        () => {},
      );
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

  /**
   * Resolve the single enforced named workflow (if any) that governs status
   * changes for an issue when NO explicit board context is available (Triage,
   * the issue drawer, bulk edit, and any `move()` call without a `boardId`).
   *
   * This closes the WF-1 enforcement-bypass gap: those surfaces previously
   * fell straight through to the legacy project-level `workflowEnforced` flag
   * and never looked at a board's assigned named workflow at all, so an
   * ENFORCED named workflow assigned to a board could be silently defeated by
   * using a different surface to change status.
   *
   * Resolution:
   *  1. Load the project's boards that both (a) have an enforced named
   *     workflow (`workflowId` set AND `workflow.enforced === true`) and
   *     (b) would actually DISPLAY this issue — i.e. the same visibility rule
   *     `BoardService`'s `buildIssueWhere` uses: a KANBAN board shows
   *     backlog issues (no sprint) or issues in an ACTIVE sprint; a SCRUM
   *     board only shows issues in an ACTIVE sprint.
   *  2. If exactly one distinct enforced workflow applies among those
   *     visible boards → return its id.
   *  3. If more than one distinct enforced workflow applies → return the
   *     DEFAULT board's workflow id (deterministic tie-break).
   *  4. If none apply → return null (caller falls back to the legacy
   *     project-level path).
   */
  private async resolveEnforcedWorkflowId(
    projectId: string,
    sprintId: string | null,
  ): Promise<string | null> {
    const boards = await this.prisma.board.findMany({
      where: { projectId, workflowId: { not: null }, workflow: { enforced: true } },
      select: { id: true, type: true, isDefault: true, workflowId: true },
    });
    if (boards.length === 0) return null;

    // Only look up the sprint's state if at least one board could plausibly
    // need it (i.e. the issue is in a sprint at all).
    let sprintActive = false;
    if (sprintId) {
      const sprint = await this.prisma.sprint.findUnique({
        where: { id: sprintId },
        select: { state: true },
      });
      sprintActive = sprint?.state === SprintState.ACTIVE;
    }

    return this.pickEnforcedWorkflowId(boards, sprintId, sprintActive);
  }

  /**
   * Pure (no DB access) part of {@link resolveEnforcedWorkflowId}'s
   * resolution: given an already-loaded set of the project's
   * enforced-named-workflow boards and whether `sprintId` is currently
   * ACTIVE, pick which workflow (if any) applies. Factored out so a batch
   * caller (`buildBulkWorkflowResolution`) can reuse the exact same
   * visibility/tie-break rules against boards/sprint-state it already loaded
   * ONCE for the whole batch, instead of `resolveEnforcedWorkflowId`
   * re-querying `board`/`sprint` per issue (P2-1, Pass-12 engineering audit).
   */
  private pickEnforcedWorkflowId(
    // `type` is intentionally `string` (not the shared `BoardType` enum):
    // callers pass Prisma's generated `$Enums.BoardType` rows directly (from
    // `board.findMany`), which is nominally distinct from — though
    // value-compatible with — `@next-lane/shared`'s `BoardType`.
    boards: Array<{
      id: string;
      type: string;
      isDefault: boolean;
      workflowId: string | null;
    }>,
    sprintId: string | null,
    sprintActive: boolean,
  ): string | null {
    if (boards.length === 0) return null;

    // Mirrors BoardService.buildIssueWhere's visibility rule.
    const visible = boards.filter((b) =>
      b.type === BoardType.SCRUM
        ? sprintActive
        : sprintId == null || sprintActive,
    );
    if (visible.length === 0) return null;

    const distinctWorkflowIds = new Set(visible.map((b) => b.workflowId));
    if (distinctWorkflowIds.size === 1) {
      return visible[0].workflowId as string;
    }

    // Multiple distinct enforced workflows apply — deterministically prefer
    // the default board's.
    const defaultBoard = visible.find((b) => b.isDefault);
    return (defaultBoard ?? visible[0]).workflowId as string;
  }

  /**
   * Batch version of {@link resolveEnforcedWorkflowId} for `bulkUpdate`: loads
   * the project's enforced-named-workflow boards ONCE (not once per issue)
   * and the ACTIVE state of every DISTINCT sprint referenced in the batch in
   * a single `findMany` (not once per issue), then applies the same
   * resolution rule per issue in memory. Total DB round trips: O(1) board
   * query + O(1) sprint query, vs. the previous O(issues) × (board query +
   * conditional sprint query) — closes P2-1 (Pass-12 engineering audit).
   */
  private async buildBulkWorkflowResolution(
    projectId: string,
    issueRows: Array<{ id: string; sprintId: string | null }>,
  ): Promise<Map<string, string | null>> {
    const boards = await this.prisma.board.findMany({
      where: { projectId, workflowId: { not: null }, workflow: { enforced: true } },
      select: { id: true, type: true, isDefault: true, workflowId: true },
    });

    const activeSprintIds = new Set<string>();
    if (boards.length > 0) {
      const distinctSprintIds = [
        ...new Set(
          issueRows
            .map((r) => r.sprintId)
            .filter((id): id is string => id !== null),
        ),
      ];
      if (distinctSprintIds.length > 0) {
        const sprints = await this.prisma.sprint.findMany({
          where: { id: { in: distinctSprintIds } },
          select: { id: true, state: true },
        });
        for (const s of sprints) {
          if (s.state === SprintState.ACTIVE) activeSprintIds.add(s.id);
        }
      }
    }

    const resolution = new Map<string, string | null>();
    for (const row of issueRows) {
      const sprintActive = row.sprintId ? activeSprintIds.has(row.sprintId) : false;
      resolution.set(
        row.id,
        this.pickEnforcedWorkflowId(boards, row.sprintId, sprintActive),
      );
    }
    return resolution;
  }

  /**
   * Single shared enforcement routing method used by `move()`, `update()`,
   * and (transitively, via `update()`) `bulkUpdate()` — every surface that
   * can change an issue's status. Fixes WF-1 (board-scoped named-workflow
   * enforcement bypass on non-board surfaces).
   *
   * Resolution order:
   *  1. Automation bypass (opts.automated === true) → skip all enforcement.
   *  2. Explicit `boardId` (board drag / card status picker):
   *     - board has a non-null workflowId with workflow.enforced = true →
   *       enforce that named workflow's transitions.
   *     - otherwise → fall through to the legacy project-level path.
   *  3. No explicit `boardId` (Triage, issue drawer, bulk edit, or any other
   *     caller): resolve the project's enforced board-assigned workflow via
   *     {@link resolveEnforcedWorkflowId} using the issue's current
   *     project/sprint context.
   *     - a workflow resolves → enforce it (board-specific path).
   *     - none resolves → fall through to the legacy project-level path.
   */
  private async enforceStatusChange(
    issueId: string,
    targetStatusId: string,
    context: { projectId: string; sprintId: string | null; boardId?: string },
    opts?: MutationOpts,
  ): Promise<void> {
    // Automation bypass applies to all paths.
    if (opts?.automated) return;

    if (context.boardId) {
      // Load the board to check for a named workflow assignment.
      const board = await this.prisma.board.findUnique({
        where: { id: context.boardId },
        select: {
          workflowId: true,
          workflow: { select: { enforced: true } },
        },
      });

      if (board?.workflowId && board.workflow?.enforced) {
        // Board-specific enforcement: use the named workflow's transitions.
        return this.workflowSvc.enforceTransitionForWorkflow(
          board.workflowId,
          issueId,
          targetStatusId,
        );
      }
      // Board exists but no workflow (or workflow not enforced) → fall through
      // to project-level enforcement below.
    } else {
      // No explicit board context — resolve one from the project's boards so
      // Triage / the drawer / bulk edit can't silently bypass a board's
      // enforced named workflow (WF-1).
      //
      // If the caller already pre-resolved this (bulkUpdate's batch preload,
      // see buildBulkWorkflowResolution) use that directly — `undefined`
      // means "not pre-resolved", `null` means "pre-resolved: none applies".
      // This is what makes the batch preload actually load-bearing for this
      // branch instead of only feeding the legacy fallback below (P2-1).
      const resolvedWorkflowId =
        opts?.resolvedWorkflowId !== undefined
          ? opts.resolvedWorkflowId
          : await this.resolveEnforcedWorkflowId(
              context.projectId,
              context.sprintId,
            );
      if (resolvedWorkflowId) {
        return this.workflowSvc.enforceTransitionForWorkflow(
          resolvedWorkflowId,
          issueId,
          targetStatusId,
        );
      }
    }

    // Legacy project-level enforcement path (unchanged behavior).
    await this.workflowSvc.enforceTransition(issueId, targetStatusId, {
      automated: opts?.automated,
      workflowEnforced: opts?.workflowEnforced,
    });
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

    // Enforce workflow gate BEFORE applying the status change.
    // Automation-applied moves bypass enforcement (opts.automated === true).
    if (statusChanged) {
      await this.enforceStatusChange(
        id,
        dto.statusId,
        { projectId: existing.projectId, sprintId: existing.sprintId, boardId: dto.boardId },
        opts,
      );
    }

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
   *   Story Points, Sprint, Labels, Start Date, Due Date, Description,
   *   Component, Fix Versions, Parent, Original Estimate (minutes), one
   *   "CF: <name>" column per custom-field definition, Created, Updated.
   *
   * Optional `q` NLQL filter: validated via `validateQuery`, then evaluated
   * with `filterIssues` (same evaluator as the board uses). Invalid query →
   * 400 BadRequestException.
   *
   * Rows are ordered by issue number ascending.
   */
  /** Hard upper bound on rows returned by {@link exportCsv}. */
  static readonly CSV_ROW_CAP = 10_000;

  async exportCsv(
    userId: string,
    projectId: string,
    q?: string,
  ): Promise<{ csv: string; projectKey: string; truncated: boolean }> {
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

    // Custom-field definitions are needed both to validate the optional NLQL
    // query and to evaluate it (a query referencing a custom field must
    // resolve it the same way at both steps), plus to build the CSV's "CF: "
    // columns below — load once and reuse.
    const customFieldDefs = await this.loadCustomFieldDefs(projectId);

    // Validate the NLQL query if provided.
    const trimmedQ = q?.trim() || undefined;
    if (trimmedQ) {
      const result = validateQuery(trimmedQ, { customFieldDefs });
      if (!result.ok) {
        throw new BadRequestException(
          `Invalid NLQL query: ${result.error?.message ?? 'parse error'}`,
        );
      }
    }

    // Fetch issues for the project with a hard cap to prevent unbounded queries.
    // Fetch one extra to detect truncation without a separate COUNT query.
    const rows = await this.prisma.issue.findMany({
      where: { projectId },
      include: {
        status: true,
        assignee: true,
        reporter: true,
        labels: { include: { label: true } },
        project: { select: { key: true } },
        sprint: { select: { name: true } },
        // Issue keys are computed (PROJECT-number) — select the parent's number
        // and compose the key with the project key below. The extra fields
        // satisfy toIssueDto's IssueRef contract.
        parent: {
          select: {
            id: true,
            number: true,
            type: true,
            title: true,
            statusId: true,
          },
        },
        component: { select: { id: true, name: true } },
        versions: {
          include: {
            version: { select: { id: true, name: true, state: true } },
          },
        },
      },
      orderBy: { number: 'asc' },
      take: IssuesService.CSV_ROW_CAP + 1,
    });
    const truncated = rows.length > IssuesService.CSV_ROW_CAP;
    if (truncated) {
      rows.splice(IssuesService.CSV_ROW_CAP);
    }

    // Map to IssueDto for NLQL evaluation.
    let issueDtos: IssueDto[] = rows.map(toIssueDto);

    // Apply NLQL filter if a query was provided (already validated above).
    // Batch-load the side-context the query actually needs (workspace
    // members for assignee/reporter name-or-email resolution, project
    // sprints for sprint name resolution) exactly once — never per issue —
    // and only for the field kinds this query references. See MCP-QA pass 1,
    // finding 1: without this, `assignee = "Alex Rivera"` / `sprint =
    // "July-B"` silently matched zero issues.
    if (trimmedQ) {
      const referencedKinds = getReferencedFieldKinds(trimmedQ);
      const { users, sprints } = await loadNlqlEvalContext(this.prisma, projectId, {
        includeUsers: referencedKinds.has('user'),
        includeSprints: referencedKinds.has('sprint'),
      });
      issueDtos = filterIssues(issueDtos, trimmedQ, {
        currentUserId: userId,
        users,
        sprints,
        customFieldDefs,
      });
    }

    // customFieldDefs (loaded above) becomes one export column each
    // ("CF: <name>"), in definition order, so no stored data is invisible in
    // the download.

    // Build the CSV. Column names shared with the importer (Title, Type,
    // Status, Priority, Assignee, Story Points, Start Date, Due Date, Labels,
    // Description) keep the export round-trippable; the extra columns are
    // ignored on import.
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
      'Start Date',
      'Due Date',
      'Description',
      'Component',
      'Fix Versions',
      'Parent',
      'Original Estimate (minutes)',
      ...customFieldDefs.map((def) => `CF: ${def.name}`),
      'Created',
      'Updated',
    ];

    // Relation-derived cells come from the raw rows (the DTO mapper only
    // carries what its own include loaded) — build per-issue lookup maps.
    const sprintNameById = new Map<string, string>();
    const labelsByIssueId = new Map<string, string[]>();
    const parentKeyById = new Map<string, string>();
    const componentById = new Map<string, string>();
    const versionsByIssueId = new Map<string, string[]>();
    for (const row of rows) {
      if (row.sprint) {
        sprintNameById.set(row.id, row.sprint.name);
      }
      const names = row.labels.map((il) => il.label.name);
      if (names.length > 0) {
        labelsByIssueId.set(row.id, names);
      }
      if (row.parent) {
        parentKeyById.set(row.id, `${project.key}-${row.parent.number}`);
      }
      if (row.component) componentById.set(row.id, row.component.name);
      const versionNames = row.versions.map((iv) => iv.version.name);
      if (versionNames.length > 0) {
        versionsByIssueId.set(row.id, versionNames);
      }
    }

    const formatCustomField = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      if (Array.isArray(value)) return value.map(String).join('; ');
      return String(value);
    };

    const lines: string[] = [csvRow(HEADER)];

    for (const issue of issueDtos) {
      const labelNames = labelsByIssueId.get(issue.id) ?? [];
      const customValues = (issue.customFields ?? {}) as Record<string, unknown>;
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
          issue.startDate ?? '',
          issue.dueDate ?? '',
          issue.description ?? '',
          componentById.get(issue.id) ?? '',
          (versionsByIssueId.get(issue.id) ?? []).join('; '),
          parentKeyById.get(issue.id) ?? '',
          issue.originalEstimateMinutes ?? '',
          ...customFieldDefs.map((def) =>
            formatCustomField(customValues[def.id] ?? customValues[def.key ?? '']),
          ),
          issue.createdAt,
          issue.updatedAt,
        ]),
      );
    }

    return { csv: lines.join(''), projectKey: project.key, truncated };
  }

  /**
   * Attach a label to an issue, logging an ActivityLog row when (and only
   * when) the label was newly attached — a repeat attach stays a no-op with
   * no phantom activity (MCP-QA pass 2: label mutations previously left
   * zero trace in the feed/staleness). Idempotent: the P2002 race between
   * the existence check and the create is swallowed. Does NOT re-check
   * project membership — the caller (`bulkUpdate`) has already confirmed
   * MEMBER access via `update()`. Takes the caller's transaction client so
   * `bulkUpdateAtomic` keeps the join row + activity inside its shared
   * transaction.
   */
  private async attachLabel(
    client: Prisma.TransactionClient | PrismaService,
    userId: string,
    issueId: string,
    labelId: string,
  ): Promise<void> {
    const already = await client.issueLabel.findUnique({
      where: { issueId_labelId: { issueId, labelId } },
      select: { issueId: true },
    });
    if (already) return;
    try {
      await client.issueLabel.create({ data: { issueId, labelId } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return; // concurrent attach won — already labeled, nothing to log
      }
      throw e;
    }
    await client.activityLog.create({
      data: { issueId, actorId: userId, field: 'label', from: null, to: labelId },
    });
  }

  /**
   * Reject any labelId in `labelIds` that does not exist or belongs to a
   * different project than `projectId`. `LabelsService.addToIssue` (the
   * single-issue `POST /issues/:id/labels` path) already validated this;
   * `bulkUpdate`'s `addLabelIds` did not (Agent Experience Round 2,
   * criterion 1 — a label from a different project could be silently
   * attached to any issue via a bulk edit, since `attachLabel` above only
   * upserts the join row with no project-scope check at all).
   */
  private async assertLabelsInProject(
    projectId: string,
    labelIds: string[],
  ): Promise<void> {
    if (labelIds.length === 0) return;
    const labels = await this.prisma.label.findMany({
      where: { id: { in: labelIds } },
      select: { id: true, projectId: true },
    });
    const foundIds = new Set(labels.map((l) => l.id));
    const missing = labelIds.filter((lid) => !foundIds.has(lid));
    if (missing.length > 0) {
      throw new BadRequestException(`Label not found: ${missing.join(', ')}`);
    }
    const wrongProject = labels.filter((l) => l.projectId !== projectId);
    if (wrongProject.length > 0) {
      throw new BadRequestException(
        `addLabelIds must belong to the same project as the issue(s) being updated: ${wrongProject
          .map((l) => l.id)
          .join(', ')}`,
      );
    }
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
    const { ids, changes, atomic, dryRun } = dto;

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
      changes.parentId !== undefined ||
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
    // parentId (criterion 3): the same cross-project guard as update_issue
    // applies inside prepareUpdate's assertSameProject call — a bulk re-parent
    // to an issue in a different project is rejected per-item, same message.
    if (changes.parentId !== undefined) updateDto.parentId = changes.parentId;

    // ── Workflow context preload (performance) ────────────────────────────────
    // When a status change is requested, all issues in the batch share the same
    // project (enforced by assertSameProject inside update()). Pre-load the
    // workflow enforcement flag ONCE for the project rather than letting each
    // per-issue enforceTransition() make its own project lookup (saves
    // up to N × 1 DB queries for N issues in the batch), AND pre-resolve the
    // WF-1 named-workflow id per issue (buildBulkWorkflowResolution) so the
    // resolveEnforcedWorkflowId branch of enforceStatusChange doesn't re-query
    // board/sprint per issue either (P2-1, Pass-12 engineering audit — the
    // original preload only ever fed the legacy fallback, not this branch).
    //
    // We derive the projectId from the batch's issue rows (fetched once, also
    // used to build the per-issue workflow resolution below). If none of the
    // batch's issues can be loaded (all deleted / wrong tenant) we fall back
    // to undefined hints so each update() handles it individually.
    let bulkWorkflowEnforced: boolean | undefined;
    let resolvedWorkflowIds: Map<string, string | null> | undefined;
    if (changes.statusId !== undefined && ids.length > 0) {
      const issueRows = await this.prisma.issue.findMany({
        where: { id: { in: ids } },
        select: { id: true, projectId: true, sprintId: true },
      });
      const projectId = issueRows[0]?.projectId;
      if (projectId) {
        bulkWorkflowEnforced =
          await this.workflowSvc.isEnforcementEnabled(projectId);
        resolvedWorkflowIds = await this.buildBulkWorkflowResolution(
          projectId,
          issueRows,
        );
      }
    }

    // dryRun (criterion 4): validate every id independently and report
    // per-item verdicts — never write anything, whether or not `atomic` was
    // also requested (atomicity only governs the write phase, which dryRun
    // always skips entirely).
    if (dryRun) {
      return this.bulkUpdateDryRun(userId, ids, updateDto, changes, {
        bulkWorkflowEnforced,
        resolvedWorkflowIds,
        atomic: Boolean(atomic),
      });
    }

    // atomic (criterion 3): validate every id FIRST (zero writes so far),
    // then — only if every id passed — write all of them inside one shared
    // transaction so a mid-batch failure rolls back the whole batch.
    if (atomic) {
      return this.bulkUpdateAtomic(userId, ids, updateDto, changes, {
        bulkWorkflowEnforced,
        resolvedWorkflowIds,
      });
    }

    let updated = 0;
    const failed: Array<{ id: string; reason: string }> = [];

    for (const id of ids) {
      try {
        // Delegate to the full single-update path: authz (assertProjectRole
        // MEMBER), same-project validation, assignee-in-workspace check,
        // ActivityLog, realtime, webhooks, watcher notifications, and
        // automation events all fire exactly as for a single PATCH.
        //
        // Pass the pre-loaded workflowEnforced + resolvedWorkflowId hints so
        // enforceStatusChange() can skip its own per-issue board/sprint
        // lookups (saves up to 2 queries per issue in the batch).
        const dtoOut = await this.update(userId, id, updateDto, {
          workflowEnforced: bulkWorkflowEnforced,
          resolvedWorkflowId: resolvedWorkflowIds?.get(id),
        });

        // Apply label additions after the core update succeeds. Validated
        // against THIS issue's project first (criterion 1 — see
        // assertLabelsInProject); a mismatch fails just this id, same as any
        // other per-issue error in this loop.
        if (changes.addLabelIds && changes.addLabelIds.length > 0) {
          await this.assertLabelsInProject(dtoOut.projectId, changes.addLabelIds);
          for (const labelId of changes.addLabelIds) {
            await this.attachLabel(this.prisma, userId, id, labelId);
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

  /**
   * atomic:true path for `bulkUpdate` (Agent Experience Round 2, criterion
   * 3): validate every issue in the batch FIRST via `prepareUpdate` (pure
   * reads — no writes yet), then — only if every issue passes validation —
   * apply all of the writes inside a SINGLE `$transaction`, so a failure
   * partway through rolls back every issue already written in this batch
   * (all-or-nothing). Side effects (realtime/webhooks/notifications/
   * automation events) fire once per issue AFTER the shared transaction
   * commits, mirroring the non-atomic path's per-issue side effects.
   */
  private async bulkUpdateAtomic(
    userId: string,
    ids: string[],
    updateDto: UpdateIssueDto,
    changes: BulkIssueChangesDto,
    hints: {
      bulkWorkflowEnforced?: boolean;
      resolvedWorkflowIds?: Map<string, string | null>;
    },
  ): Promise<BulkUpdateResultDto> {
    const prepared: Array<{ id: string; prep: PreparedIssueUpdate }> = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const id of ids) {
      try {
        const prep = await this.prepareUpdate(userId, id, updateDto, {
          workflowEnforced: hints.bulkWorkflowEnforced,
          resolvedWorkflowId: hints.resolvedWorkflowIds?.get(id),
        });
        if (changes.addLabelIds && changes.addLabelIds.length > 0) {
          await this.assertLabelsInProject(prep.existing.projectId, changes.addLabelIds);
        }
        prepared.push({ id, prep });
      } catch (err: unknown) {
        failed.push({ id, reason: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    // All-or-nothing: ANY validation failure aborts the WHOLE batch with
    // zero writes — this is what makes atomic:true actually atomic, not just
    // "wrapped in a transaction that might still partially commit".
    if (failed.length > 0) {
      return { updated: 0, failed, atomic: true };
    }

    const results: Array<{ issue: IssueWithRelations; prep: PreparedIssueUpdate }> = [];

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const { id, prep } of prepared) {
          const issue = await this.writeIssueUpdate(
            tx,
            id,
            updateDto,
            prep.activities,
            prep.mergedCustomFields,
          );
          if (changes.addLabelIds && changes.addLabelIds.length > 0) {
            for (const labelId of changes.addLabelIds) {
              await this.attachLabel(tx, userId, id, labelId);
            }
          }
          results.push({ issue, prep });
        }
      });
    } catch (err: unknown) {
      // The shared transaction rolled back — nothing in this batch was
      // written. Report every id as failed with the same rollback reason.
      const reason = `Transaction rolled back: ${err instanceof Error ? err.message : 'Unknown error'}`;
      return { updated: 0, failed: ids.map((id) => ({ id, reason })), atomic: true };
    }

    for (const { issue, prep } of results) {
      // Every write in the batch is already committed; a side-effect failure
      // (realtime/webhook/notification) on one item must not turn the whole
      // atomic call into an error response after the fact.
      try {
        await this.finishUpdate(userId, issue, prep.existing, updateDto, prep.changedFields, {
          workflowEnforced: hints.bulkWorkflowEnforced,
        });
      } catch {
        // Swallow: the mutation succeeded; only post-commit fan-out failed.
      }
    }

    return { updated: results.length, failed: [], atomic: true };
  }

  /**
   * dryRun:true path for `bulkUpdate` (Agent Experience Round 2, criterion
   * 4): run every validation exactly as a real update would — for every id
   * independently, regardless of `atomic` — and report per-item verdicts
   * without writing anything. `atomic` only changes how a REAL write would
   * be applied; a dry run never writes either way, so it always validates
   * every id independently to give the caller the full picture.
   */
  private async bulkUpdateDryRun(
    userId: string,
    ids: string[],
    updateDto: UpdateIssueDto,
    changes: BulkIssueChangesDto,
    hints: {
      bulkWorkflowEnforced?: boolean;
      resolvedWorkflowIds?: Map<string, string | null>;
      atomic: boolean;
    },
  ): Promise<BulkUpdateResultDto> {
    const failed: Array<{ id: string; reason: string }> = [];
    const wouldUpdate: string[] = [];

    for (const id of ids) {
      try {
        const prep = await this.prepareUpdate(userId, id, updateDto, {
          workflowEnforced: hints.bulkWorkflowEnforced,
          resolvedWorkflowId: hints.resolvedWorkflowIds?.get(id),
        });
        if (changes.addLabelIds && changes.addLabelIds.length > 0) {
          await this.assertLabelsInProject(prep.existing.projectId, changes.addLabelIds);
        }
        wouldUpdate.push(id);
      } catch (err: unknown) {
        failed.push({ id, reason: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    return { updated: 0, failed, dryRun: true, atomic: hints.atomic, wouldUpdate };
  }
}

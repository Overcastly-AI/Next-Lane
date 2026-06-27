import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertWorkspaceRole } from '../common/membership.util';
import { Role } from '@next-lane/shared';
import type {
  AuditEventDto,
  PaginatedAuditEventsDto,
} from '@next-lane/shared';
import type { ListAuditEventsQueryDto } from './dto/audit-event.dto';

/** Default page size for audit log listing. */
const DEFAULT_PAGE_SIZE = 50;

/** Hard upper bound a caller may request. */
const MAX_PAGE_SIZE = 200;

/**
 * Parameters for recording a single audit event.
 *
 * `workspaceId` + `action` + `targetType` + `targetId` are always required.
 * `actorId`, `metadata`, and `ip` are optional.
 */
export interface RecordAuditEventParams {
  workspaceId: string;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

// ── Cursor helpers ────────────────────────────────────────────────────────────

/**
 * Encode an opaque cursor from `(createdAt, id)`.
 * Audit events are listed newest-first (DESC), so the cursor points to the
 * oldest row on the current page and the next page contains older events.
 */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(
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

// ── DTO mapper ────────────────────────────────────────────────────────────────

type AuditEventRow = {
  id: string;
  workspaceId: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata: unknown;
  ip: string | null;
  createdAt: Date;
  actor: { id: string; name: string; email: string } | null;
};

function toDto(row: AuditEventRow): AuditEventDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    actor: row.actor
      ? { id: row.actor.id, name: row.actor.name, email: row.actor.email }
      : null,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata:
      row.metadata != null
        ? (row.metadata as Record<string, unknown>)
        : null,
    ip: row.ip,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Write an audit event to the database.
   *
   * Best-effort: if the write fails (e.g. a transaction error or a DB blip),
   * it logs the failure and swallows the exception so the originating request
   * is NEVER broken by an audit-log write failure.
   */
  record(params: RecordAuditEventParams): void {
    void this.prisma.auditEvent
      .create({
        data: {
          workspaceId: params.workspaceId,
          actorId: params.actorId ?? null,
          action: params.action,
          targetType: params.targetType,
          targetId: params.targetId,
          metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          ip: params.ip ?? null,
        },
      })
      .catch((err: unknown) => {
        this.logger.error(
          `audit record failed (action=${params.action} workspace=${params.workspaceId}): ${String(err)}`,
        );
      });
  }

  /**
   * List audit events for a workspace, newest-first, cursor-paginated.
   *
   * Access control: caller must be ADMIN in the workspace.
   * Tenant isolation: query is always filtered by `workspaceId`.
   */
  async list(
    userId: string,
    workspaceId: string,
    query: ListAuditEventsQueryDto,
  ): Promise<PaginatedAuditEventsDto> {
    await assertWorkspaceRole(this.prisma, userId, workspaceId, Role.ADMIN);

    const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const decoded = query.cursor ? decodeCursor(query.cursor) : null;

    // Keyset condition for cursor:
    // "rows where (createdAt < cursor.createdAt)
    //          OR (createdAt = cursor.createdAt AND id < cursor.id)"
    // This is the correct expression for (createdAt DESC, id DESC) ordering.
    const cursorWhere = decoded
      ? {
          OR: [
            { createdAt: { lt: decoded.createdAt } },
            { createdAt: { equals: decoded.createdAt }, id: { lt: decoded.id } },
          ],
        }
      : {};

    const rows = await this.prisma.auditEvent.findMany({
      where: { workspaceId, ...cursorWhere },
      include: {
        actor: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1, // Fetch one extra to detect hasMore.
    });

    const hasMore = rows.length > limit;
    const pageItems = hasMore ? rows.slice(0, limit) : rows;
    const last = pageItems[pageItems.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

    return {
      items: pageItems.map(toDto),
      nextCursor,
    };
  }
}

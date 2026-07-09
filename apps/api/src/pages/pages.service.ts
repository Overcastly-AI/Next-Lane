import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { assertProjectRole } from '../common/membership.util';
import {
  Role,
  SocketEvents,
  parseWikiLinks,
  rankAfter,
  rankBetween,
  initialRanks,
} from '@next-lane/shared';
import type {
  PageDto,
  PageBacklinkDto,
  PageGraphDto,
  PageTreeNode,
  PageVersionDto,
  PaginatedPageVersionsDto,
} from '@next-lane/shared';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';
import { MovePageDto } from './dto/move-page.dto';
import { ListPageVersionsQueryDto } from './dto/list-page-versions.dto';
import {
  pageInclude,
  toPageDto,
  toPageVersionDto,
  toPageVersionSummaryDto,
  buildPageTree,
  type PageRow,
} from './page.mapper';

/**
 * Maximum number of nodes returned by `GET /projects/:id/pages/graph`.
 * Prevents OOM on a project with a very large wiki. When the cap is hit,
 * `truncated` is set to true (mirrors `ROADMAP_EPICS_CAP` /
 * `PUBLIC_BOARD_ISSUES_CAP`) so the client can inform the user rather than
 * silently rendering an incomplete graph as if it were complete. Edges are
 * filtered to only those between two retained nodes, so the truncated graph
 * is always internally consistent (never a dangling edge to a node that
 * isn't there).
 */
export const MAX_GRAPH_NODES = 1000;

/** Default/max page size for `GET /pages/:id/versions`. */
const VERSIONS_DEFAULT_LIMIT = 50;
const VERSIONS_MAX_LIMIT = 200;

@Injectable()
export class PagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async findOne(userId: string, id: string): Promise<PageDto> {
    const page = await this.prisma.page.findUnique({
      where: { id },
      include: pageInclude,
    });
    if (!page) throw new NotFoundException('Page not found');
    await assertProjectRole(this.prisma, userId, page.projectId, Role.VIEWER);
    return toPageDto(page as PageRow);
  }

  async create(
    userId: string,
    projectId: string,
    dto: CreatePageDto,
  ): Promise<PageDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.MEMBER);

    const parentId = dto.parentId ?? null;
    if (parentId !== null) {
      await this.assertParentInProject(parentId, projectId);
    }

    const content = dto.content ?? '';
    const lastSibling = await this.prisma.page.findFirst({
      where: { projectId, parentId },
      orderBy: { rank: 'desc' },
      select: { rank: true },
    });
    const rank = rankAfter(lastSibling?.rank ?? null);

    const page = await this.prisma.$transaction(async (tx) => {
      const created = await tx.page.create({
        data: {
          projectId,
          parentId,
          title: dto.title,
          content,
          rank,
          authorId: userId,
          lastEditedById: userId,
        },
        include: pageInclude,
      });
      await tx.pageVersion.create({
        data: {
          pageId: created.id,
          versionNumber: 1,
          title: created.title,
          content: created.content,
          editedById: userId,
        },
      });
      await this.syncWikiLinks(tx, projectId, created.id, content);
      return created;
    });

    this.emitUpdated(projectId, page.id);
    return toPageDto(page as PageRow);
  }

  /**
   * Update a page's title/content (writes a new `PageVersion` snapshot when
   * either is provided), and/or directly assign `parentId`/`rank`/`archived`.
   * `parentId` changes are validated for same-project membership and rejected
   * (400) if they would create a tree cycle. See `UpdatePageDto`'s class doc
   * for why `rank` is stored verbatim here vs. computed by `move()`.
   */
  async update(
    userId: string,
    id: string,
    dto: UpdatePageDto,
  ): Promise<PageDto> {
    const existing = await this.prisma.page.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Page not found');
    await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.MEMBER,
    );

    const isContentEdit = dto.title !== undefined || dto.content !== undefined;
    const finalTitle = dto.title ?? existing.title;
    const finalContent = dto.content ?? existing.content;

    const page = await this.prisma.$transaction(async (tx) => {
      if (dto.parentId !== undefined && dto.parentId !== existing.parentId) {
        if (dto.parentId !== null) {
          await this.assertParentInProject(
            dto.parentId,
            existing.projectId,
            tx,
          );
        }
        await this.assertNoCycle(tx, id, dto.parentId);
      }

      const updated = await tx.page.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.content !== undefined ? { content: dto.content } : {}),
          ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
          ...(dto.rank !== undefined ? { rank: dto.rank } : {}),
          ...(dto.archived !== undefined ? { archived: dto.archived } : {}),
          ...(isContentEdit ? { lastEditedById: userId } : {}),
        },
        include: pageInclude,
      });

      if (isContentEdit) {
        const last = await tx.pageVersion.findFirst({
          where: { pageId: id },
          orderBy: { versionNumber: 'desc' },
          select: { versionNumber: true },
        });
        await tx.pageVersion.create({
          data: {
            pageId: id,
            versionNumber: (last?.versionNumber ?? 0) + 1,
            title: finalTitle,
            content: finalContent,
            editedById: userId,
          },
        });
      }

      if (dto.content !== undefined) {
        await this.syncWikiLinks(tx, existing.projectId, id, dto.content);
      }

      return updated;
    });

    this.emitUpdated(existing.projectId, id);
    return toPageDto(page as PageRow);
  }

  /**
   * Delete a page. A page WITH children is rejected (400) rather than
   * silently cascading — see the design-decision comment on `Page.parentId`
   * (`onDelete: Restrict`) in `schema.prisma`: losing/reparenting a whole
   * subtree of a document tree should be an explicit, deliberate act, not an
   * implicit side effect of deleting one page. Callers must first move the
   * children elsewhere (`move()`) or delete them individually,
   * leaves-up — there is no cascade-subtree-delete endpoint in this slice.
   */
  async remove(userId: string, id: string): Promise<{ id: string }> {
    const existing = await this.prisma.page.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Page not found');
    await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.MEMBER,
    );

    const childCount = await this.prisma.page.count({
      where: { parentId: id },
    });
    if (childCount > 0) {
      throw new BadRequestException(
        `This page has ${childCount} child page${childCount === 1 ? '' : 's'} — move or delete them first before deleting this page.`,
      );
    }

    await this.prisma.page.delete({ where: { id } });
    this.emitUpdated(existing.projectId, id);
    return { id };
  }

  // ── Tree ──────────────────────────────────────────────────────────────────

  async tree(userId: string, projectId: string): Promise<PageTreeNode[]> {
    await assertProjectRole(this.prisma, userId, projectId, Role.VIEWER);
    const rows = await this.prisma.page.findMany({
      where: { projectId },
      select: { id: true, title: true, archived: true, rank: true, parentId: true },
      orderBy: { rank: 'asc' },
    });
    return buildPageTree(rows);
  }

  // ── Move / reorder ───────────────────────────────────────────────────────

  /**
   * Reorder a page among siblings and/or reparent it, computing the new
   * fractional-index `rank` server-side via `rankBetween` (never
   * renumbering the whole sibling list, except as the documented one-time
   * rebalance fallback below — same posture as `IssuesService.move`).
   *
   * TOCTOU note: the cycle check and the write both happen inside one
   * `$transaction`, so no OTHER move on this same page can interleave
   * between the check and the write. This is the same protection level
   * `IssuesService.move` relies on for its neighbor-rank read+write (no
   * explicit row locking) — sufficient for the concurrency this product
   * actually sees (one editor moving one page at a time), not a
   * SERIALIZABLE guarantee against an adversarial concurrent reparent of an
   * ancestor from a second transaction.
   */
  async move(userId: string, id: string, dto: MovePageDto): Promise<PageDto> {
    const existing = await this.prisma.page.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Page not found');
    await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.MEMBER,
    );

    const targetParentId =
      dto.parentId === undefined ? existing.parentId : dto.parentId;

    const page = await this.prisma.$transaction(async (tx) => {
      if (targetParentId !== null) {
        await this.assertParentInProject(
          targetParentId,
          existing.projectId,
          tx,
        );
      }
      await this.assertNoCycle(tx, id, targetParentId);

      let beforeRank: string | null = null;
      let afterRank: string | null = null;
      if (dto.beforeId) {
        const before = await this.loadSibling(
          tx,
          dto.beforeId,
          existing.projectId,
          targetParentId,
        );
        beforeRank = before.rank;
      }
      if (dto.afterId) {
        const after = await this.loadSibling(
          tx,
          dto.afterId,
          existing.projectId,
          targetParentId,
        );
        afterRank = after.rank;
      }

      let newRank: string;
      if (!dto.beforeId && !dto.afterId) {
        // No explicit neighbor given: append to the end of the destination
        // sibling list.
        const last = await tx.page.findFirst({
          where: { projectId: existing.projectId, parentId: targetParentId, id: { not: id } },
          orderBy: { rank: 'desc' },
          select: { rank: true },
        });
        newRank = rankAfter(last?.rank ?? null);
      } else {
        try {
          newRank = rankBetween(beforeRank, afterRank);
        } catch {
          newRank = await this.rebalanceSiblingsAndPlace(
            tx,
            existing.projectId,
            targetParentId,
            id,
            dto.beforeId ?? null,
          );
        }
      }

      return tx.page.update({
        where: { id },
        data: { parentId: targetParentId, rank: newRank },
        include: pageInclude,
      });
    });

    this.emitUpdated(existing.projectId, id);
    return toPageDto(page as PageRow);
  }

  /** Load a sibling page by id and assert it's actually in the destination sibling list. */
  private async loadSibling(
    tx: Prisma.TransactionClient,
    siblingId: string,
    projectId: string,
    parentId: string | null,
  ) {
    const sibling = await tx.page.findUnique({ where: { id: siblingId } });
    if (
      !sibling ||
      sibling.projectId !== projectId ||
      sibling.parentId !== parentId
    ) {
      throw new BadRequestException(
        'beforeId/afterId must reference a page that is already a sibling of the destination parent',
      );
    }
    return sibling;
  }

  /**
   * One-time rebalance fallback for when `rankBetween` throws because the
   * two neighbor ranks are adjacent/exhausted (no fractional room left
   * between them). Re-spaces every sibling under `(projectId, parentId)`
   * with fresh, evenly-spaced ranks and re-derives the moved page's rank
   * from the rebalanced order — mirrors `IssuesService.rebalanceAndPlace`.
   */
  private async rebalanceSiblingsAndPlace(
    tx: Prisma.TransactionClient,
    projectId: string,
    parentId: string | null,
    id: string,
    beforeId: string | null,
  ): Promise<string> {
    const siblings = await tx.page.findMany({
      where: { projectId, parentId, id: { not: id } },
      orderBy: { rank: 'asc' },
      select: { id: true },
    });

    const order: string[] = [];
    let inserted = false;
    for (const sibling of siblings) {
      if (sibling.id === beforeId) {
        order.push(id);
        inserted = true;
      }
      order.push(sibling.id);
    }
    if (!inserted) order.push(id);

    const ranks = initialRanks(order.length);
    let movedRank: string | null = null;
    for (let i = 0; i < order.length; i += 1) {
      if (order[i] === id) {
        movedRank = ranks[i];
      } else {
        await tx.page.update({ where: { id: order[i] }, data: { rank: ranks[i] } });
      }
    }
    return movedRank as string;
  }

  /** Assert `parentId` refers to an existing page in `projectId`. 400 otherwise. */
  private async assertParentInProject(
    parentId: string,
    projectId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const parent = await tx.page.findUnique({ where: { id: parentId } });
    if (!parent || parent.projectId !== projectId) {
      throw new BadRequestException(
        'parentId must reference a page in the same project',
      );
    }
  }

  /**
   * Reject (400) a reparent that would make `pageId` its own ancestor.
   * Walks the `parentId` chain upward from `newParentId`; if it ever reaches
   * `pageId`, the move is a cycle. Also rejects the trivial 0-length cycle
   * (a page becoming its own parent). Defensively bounded against
   * pre-existing corrupt cyclic data (should be impossible given this same
   * check runs on every reparent) via a visited-set break rather than an
   * infinite loop.
   */
  private async assertNoCycle(
    tx: Prisma.TransactionClient,
    pageId: string,
    newParentId: string | null,
  ): Promise<void> {
    if (newParentId === null) return;
    if (newParentId === pageId) {
      throw new BadRequestException('A page cannot be its own parent');
    }

    const visited = new Set<string>();
    let currentId: string | null = newParentId;
    while (currentId) {
      if (currentId === pageId) {
        throw new BadRequestException(
          'This move would make the page an ancestor of itself (a cycle)',
        );
      }
      if (visited.has(currentId)) break; // corrupt pre-existing cycle; bail out safely
      visited.add(currentId);
      const row: { parentId: string | null } | null = await tx.page.findUnique({
        where: { id: currentId },
        select: { parentId: true },
      });
      currentId = row?.parentId ?? null;
    }
  }

  // ── Version history ──────────────────────────────────────────────────────

  async listVersions(
    userId: string,
    id: string,
    query: ListPageVersionsQueryDto,
  ): Promise<PaginatedPageVersionsDto> {
    const page = await this.prisma.page.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Page not found');
    await assertProjectRole(this.prisma, userId, page.projectId, Role.VIEWER);

    const limit = Math.min(query.limit ?? VERSIONS_DEFAULT_LIMIT, VERSIONS_MAX_LIMIT);
    const cursorVersion = query.cursor ? decodeVersionCursor(query.cursor) : null;

    const rows = await this.prisma.pageVersion.findMany({
      where: {
        pageId: id,
        ...(cursorVersion !== null ? { versionNumber: { lt: cursorVersion } } : {}),
      },
      include: { editedBy: true },
      orderBy: { versionNumber: 'desc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeVersionCursor(last.versionNumber) : null;

    return { items: items.map(toPageVersionSummaryDto), nextCursor };
  }

  async getVersion(
    userId: string,
    id: string,
    versionNumber: number,
  ): Promise<PageVersionDto> {
    const page = await this.prisma.page.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Page not found');
    await assertProjectRole(this.prisma, userId, page.projectId, Role.VIEWER);

    const version = await this.prisma.pageVersion.findUnique({
      where: { pageId_versionNumber: { pageId: id, versionNumber } },
      include: { editedBy: true },
    });
    if (!version) throw new NotFoundException('Page version not found');
    return toPageVersionDto(version);
  }

  /**
   * Restore an old version's title/content as a brand-new `PageVersion`
   * snapshot — history is never mutated or truncated; "restoring" version 3
   * on a page currently at version 8 writes a NEW version 9 whose content
   * equals version 3's, leaving versions 1-8 untouched.
   */
  async restoreVersion(
    userId: string,
    id: string,
    versionNumber: number,
  ): Promise<PageDto> {
    const existing = await this.prisma.page.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Page not found');
    await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.MEMBER,
    );

    const target = await this.prisma.pageVersion.findUnique({
      where: { pageId_versionNumber: { pageId: id, versionNumber } },
    });
    if (!target) throw new NotFoundException('Page version not found');

    const page = await this.prisma.$transaction(async (tx) => {
      const last = await tx.pageVersion.findFirst({
        where: { pageId: id },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const newVersionNumber = (last?.versionNumber ?? 0) + 1;

      const updated = await tx.page.update({
        where: { id },
        data: {
          title: target.title,
          content: target.content,
          lastEditedById: userId,
        },
        include: pageInclude,
      });

      await tx.pageVersion.create({
        data: {
          pageId: id,
          versionNumber: newVersionNumber,
          title: target.title,
          content: target.content,
          editedById: userId,
        },
      });

      await this.syncWikiLinks(tx, existing.projectId, id, target.content);

      return updated;
    });

    this.emitUpdated(existing.projectId, id);
    return toPageDto(page as PageRow);
  }

  // ── Backlinks + graph ────────────────────────────────────────────────────

  async backlinks(userId: string, id: string): Promise<PageBacklinkDto[]> {
    const page = await this.prisma.page.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Page not found');
    await assertProjectRole(this.prisma, userId, page.projectId, Role.VIEWER);

    const rows = await this.prisma.pageLink.findMany({
      where: { targetPageId: id },
      include: { sourcePage: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => ({
      id: row.id,
      sourcePageId: row.sourcePageId,
      sourcePageTitle: row.sourcePage.title,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async graph(userId: string, projectId: string): Promise<PageGraphDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.VIEWER);

    // Fetch one extra row beyond the cap to detect truncation without a
    // separate COUNT query (same pattern as ROADMAP_EPICS_CAP).
    const fetched = await this.prisma.page.findMany({
      where: { projectId },
      select: { id: true, title: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_GRAPH_NODES + 1,
    });
    const truncated = fetched.length > MAX_GRAPH_NODES;
    const nodes = truncated ? fetched.slice(0, MAX_GRAPH_NODES) : fetched;
    const nodeIds = new Set(nodes.map((n) => n.id));

    const edgeRows = await this.prisma.pageLink.findMany({
      where: { sourcePage: { projectId }, targetPage: { projectId } },
      select: { sourcePageId: true, targetPageId: true },
    });
    // Keep the truncated graph internally consistent: drop any edge that
    // touches a node cut off by the cap above.
    const edges = edgeRows
      .filter((e) => nodeIds.has(e.sourcePageId) && nodeIds.has(e.targetPageId))
      .map((e) => ({ sourceId: e.sourcePageId, targetId: e.targetPageId }));

    return {
      nodes: nodes.map((n) => ({ id: n.id, title: n.title })),
      edges,
      truncated,
    };
  }

  // ── [[wiki-link]] parsing + PageLink sync ───────────────────────────────

  /**
   * Parse `content` for `[[wiki-link]]` references (via the shared
   * `parseWikiLinks`), resolve each title to a page in the SAME project
   * (case-insensitive exact match, self excluded), and reconcile this page's
   * outgoing `PageLink` rows to match — add missing edges, remove stale
   * ones. An unresolved `[[link]]` (no matching title) is simply skipped;
   * see `parseWikiLinks`'s module doc for why that's not an error.
   *
   * Must run inside the SAME transaction as the page/version write that
   * triggered it (all three call sites — create/update/restore — already do
   * this), so a reader never observes a page whose content mentions a link
   * that hasn't been reconciled into `PageLink` yet.
   */
  private async syncWikiLinks(
    tx: Prisma.TransactionClient,
    projectId: string,
    sourcePageId: string,
    content: string,
  ): Promise<void> {
    const parsed = parseWikiLinks(content);
    const uniqueTitles = [...new Set(parsed.map((l) => l.title.toLowerCase()))];

    let resolvedTargetIds = new Set<string>();
    if (uniqueTitles.length > 0) {
      const candidates = await tx.page.findMany({
        where: {
          projectId,
          id: { not: sourcePageId }, // self-links excluded
          OR: uniqueTitles.map((title) => ({
            title: { equals: title, mode: 'insensitive' as const },
          })),
        },
        select: { id: true, title: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });
      // Deterministic resolution when multiple pages share a case-insensitive
      // title within the project: the oldest page wins (first in creation
      // order — `orderBy: createdAt asc` above, first-wins-on-insert below).
      const byLowerTitle = new Map<string, string>();
      for (const candidate of candidates) {
        const key = candidate.title.toLowerCase();
        if (!byLowerTitle.has(key)) byLowerTitle.set(key, candidate.id);
      }
      resolvedTargetIds = new Set(
        parsed
          .map((link) => byLowerTitle.get(link.title.toLowerCase()))
          .filter((id): id is string => id !== undefined),
      );
    }

    const existingLinks = await tx.pageLink.findMany({
      where: { sourcePageId },
      select: { id: true, targetPageId: true },
    });
    const existingTargetIds = new Set(existingLinks.map((l) => l.targetPageId));

    const toAdd = [...resolvedTargetIds].filter((id) => !existingTargetIds.has(id));
    const toRemoveIds = existingLinks
      .filter((l) => !resolvedTargetIds.has(l.targetPageId))
      .map((l) => l.id);

    if (toAdd.length > 0) {
      await tx.pageLink.createMany({
        data: toAdd.map((targetPageId) => ({ sourcePageId, targetPageId })),
        skipDuplicates: true,
      });
    }
    if (toRemoveIds.length > 0) {
      await tx.pageLink.deleteMany({ where: { id: { in: toRemoveIds } } });
    }
  }

  private emitUpdated(projectId: string, pageId: string): void {
    this.realtime.emitToProject(projectId, SocketEvents.PageUpdated, {
      projectId,
      pageId,
    });
  }
}

// ── Version-history cursor helpers ──────────────────────────────────────────
// Versions are listed newest-first (versionNumber DESC); versionNumber is
// already a unique, monotonic per-page key, so the cursor only needs to
// encode it (unlike the audit log's (createdAt, id) compound cursor, which
// exists because createdAt alone isn't guaranteed unique).

function encodeVersionCursor(versionNumber: number): string {
  return Buffer.from(String(versionNumber)).toString('base64url');
}

function decodeVersionCursor(cursor: string): number | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const n = Number(decoded);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { assertProjectRole, assertWorkspaceRole } from '../common/membership.util';
import { extractIssueNumbers } from '../common/issue-key.util';
import { toIssueRefDto } from '../issues/issue.mapper';
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
  PageOutgoingLinksDto,
  PageLinkedIssuesDto,
  IssueLinkedPagesDto,
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
/**
 * Hard ceiling on edges returned by the project graph — bounds the response
 * independently of the node cap (a fully-connected 1000-node graph could
 * otherwise be ~1M edges). 5000 comfortably covers a densely-linked real
 * wiki while keeping the payload sane.
 */
export const MAX_GRAPH_EDGES = 5000;

/**
 * Hard ceiling on outgoing links returned by `GET /pages/:id/links`. A single
 * page linking to more than this is pathological; the cap keeps the response
 * (which `get_page` fetches by default) bounded regardless of content size.
 * `truncated` flags when it's hit, same as the graph endpoint.
 */
export const MAX_OUTGOING_LINKS = 500;

/**
 * Hard ceiling on issues returned by `GET /pages/:id/issues`. Same
 * resource-exhaustion posture as `MAX_OUTGOING_LINKS` — a single page
 * mentioning an unbounded number of issue keys is pathological, not a real
 * workflow.
 */
export const MAX_LINKED_ISSUES = 500;

/**
 * Hard ceiling on pages returned by `GET /issues/:id/pages`. An issue
 * mentioned from more than this many pages is pathological; the cap keeps
 * the issue drawer's "Linked pages" panel bounded regardless of how many
 * docs reference it.
 */
export const MAX_LINKED_PAGES = 500;

/** Default/max page size for `GET /pages/:id/versions`. */
const VERSIONS_DEFAULT_LIMIT = 50;
const VERSIONS_MAX_LIMIT = 200;

@Injectable()
export class PagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  // ── Scope helpers ────────────────────────────────────────────────────────
  //
  // A `Page` is EITHER project-scoped (`projectId` set — `PageScope.projectId
  // !== null`) OR workspace-scoped (`projectId: null`, a top-of-workspace doc
  // not attached to any single project); `workspaceId` is always present
  // either way (see the `Page.workspaceId` model comment in schema.prisma).
  // Every method below that used to take a bare `projectId` now takes/derives
  // a `PageScope` and branches on `scope.projectId === null` through this one
  // small set of helpers, rather than repeating the branch at each of the ~25
  // call sites that need it.

  /** The scoping key every page-tree/sibling/link query is scoped by. */
  private scopeOf(page: { workspaceId: string; projectId: string | null }): PageScope {
    return { workspaceId: page.workspaceId, projectId: page.projectId };
  }

  /**
   * Authorize `userId` for `minRole` on a page's scope: the EFFECTIVE project
   * role (`assertProjectRole`) for a project page, or workspace membership
   * role (`assertWorkspaceRole`) for a workspace-level page. Returns the
   * project's `key` (needed for `syncIssueLinks`'s issue-key parsing) for a
   * project page, `null` for a workspace page (which has no project key —
   * see `syncIssueLinks`'s workspace-page early-return).
   */
  private async assertPageRole(
    userId: string,
    scope: PageScope,
    minRole: Role,
  ): Promise<string | null> {
    if (scope.projectId !== null) {
      const project = await assertProjectRole(this.prisma, userId, scope.projectId, minRole);
      return project.key;
    }
    await assertWorkspaceRole(this.prisma, userId, scope.workspaceId, minRole);
    return null;
  }

  /** The Prisma `where` that selects "every page in this scope" (any parent). */
  private scopeWhere(scope: PageScope): Prisma.PageWhereInput {
    return scope.projectId !== null
      ? { projectId: scope.projectId }
      : { workspaceId: scope.workspaceId, projectId: null };
  }

  /** The Prisma `where` that selects "siblings under this parent, in this scope". */
  private siblingWhere(scope: PageScope, parentId: string | null): Prisma.PageWhereInput {
    return { ...this.scopeWhere(scope), parentId };
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async findOne(userId: string, id: string): Promise<PageDto> {
    const page = await this.prisma.page.findUnique({
      where: { id },
      include: pageInclude,
    });
    if (!page) throw new NotFoundException('Page not found');
    await this.assertPageRole(userId, this.scopeOf(page), Role.VIEWER);
    return toPageDto(page as PageRow);
  }

  /** Create a project-scoped page under `POST /projects/:projectId/pages`. */
  async create(
    userId: string,
    projectId: string,
    dto: CreatePageDto,
  ): Promise<PageDto> {
    const project = await assertProjectRole(
      this.prisma,
      userId,
      projectId,
      Role.MEMBER,
    );
    return this.createPage(
      userId,
      { workspaceId: project.workspaceId, projectId },
      project.key,
      dto,
    );
  }

  /**
   * Create a workspace-level page (no project) under
   * `POST /workspaces/:workspaceId/pages` — the org-level-docs entry point.
   * Sibling order and `[[wiki-link]]` resolution are scoped to this
   * workspace's OTHER workspace-level pages only (never a project page, and
   * never another workspace's pages); see `syncWikiLinks`. There is no
   * issue-key sync for workspace pages — `Issue` is project-scoped and a
   * workspace page has no project to resolve keys against (see
   * `syncIssueLinks`'s early return).
   */
  async createWorkspacePage(
    userId: string,
    workspaceId: string,
    dto: CreatePageDto,
  ): Promise<PageDto> {
    await assertWorkspaceRole(this.prisma, userId, workspaceId, Role.MEMBER);
    return this.createPage(userId, { workspaceId, projectId: null }, null, dto);
  }

  private async createPage(
    userId: string,
    scope: PageScope,
    projectKey: string | null,
    dto: CreatePageDto,
  ): Promise<PageDto> {
    const parentId = dto.parentId ?? null;
    if (parentId !== null) {
      await this.assertParentInScope(parentId, scope);
    }

    const content = dto.content ?? '';

    const page = await this.prisma.$transaction(async (tx) => {
      // Read the last sibling's rank INSIDE the transaction (code-review
      // should-fix on 3b03430): two concurrent creates under the same parent
      // that read the same lastSibling would otherwise compute an identical
      // rank and both insert (no unique constraint on rank), leaving sibling
      // order unstable. Mirrors IssuesService.create.
      const lastSibling = await tx.page.findFirst({
        where: this.siblingWhere(scope, parentId),
        orderBy: { rank: 'desc' },
        select: { rank: true },
      });
      const rank = rankAfter(lastSibling?.rank ?? null);
      const created = await tx.page.create({
        data: {
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
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
      await this.syncWikiLinks(tx, scope, created.id, content);
      if (scope.projectId !== null && projectKey !== null) {
        await this.syncIssueLinks(tx, scope.projectId, projectKey, created.id, content);
      }
      return created;
    });

    this.emitUpdated(scope, page.id);
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
    const scope = this.scopeOf(existing);
    const projectKey = await this.assertPageRole(userId, scope, Role.MEMBER);

    const isContentEdit = dto.title !== undefined || dto.content !== undefined;
    const finalTitle = dto.title ?? existing.title;
    const finalContent = dto.content ?? existing.content;

    const page = await this.prisma.$transaction(async (tx) => {
      if (dto.parentId !== undefined && dto.parentId !== existing.parentId) {
        if (dto.parentId !== null) {
          await this.assertParentInScope(dto.parentId, scope, tx);
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
        await this.syncWikiLinks(tx, scope, id, dto.content);
        if (scope.projectId !== null && projectKey !== null) {
          await this.syncIssueLinks(tx, scope.projectId, projectKey, id, dto.content);
        }
      }

      return updated;
    });

    this.emitUpdated(scope, id);
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
  async remove(
    userId: string,
    id: string,
  ): Promise<{ id: string; orphanedBacklinks: number }> {
    const existing = await this.prisma.page.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Page not found');
    const scope = this.scopeOf(existing);
    await this.assertPageRole(userId, scope, Role.MEMBER);

    // Child-count guard, backlink count, and the delete run in ONE transaction
    // so the guard is atomic with the delete (no child added between check and
    // delete) and `orphanedBacklinks` can't undercount a backlink added by a
    // concurrent save in the window between the count and the cascade.
    const orphanedBacklinks = await this.prisma.$transaction(async (tx) => {
      const childCount = await tx.page.count({ where: { parentId: id } });
      if (childCount > 0) {
        throw new BadRequestException(
          `This page has ${childCount} child page${childCount === 1 ? '' : 's'} — move or delete them first before deleting this page.`,
        );
      }

      // Informed-consent signal (MCP-QA pass 3, P2): deleting a page other
      // pages link to is legitimate (Obsidian-style, never blocked), but the
      // caller should KNOW those pages' [[links]] just became unresolved.
      // Counted inside the tx before the delete (the cascade removes the rows),
      // reported in the response, and surfaced pre-delete in the web confirm
      // dialog.
      const backlinks = await tx.pageLink.count({ where: { targetPageId: id } });
      await tx.page.delete({ where: { id } });
      return backlinks;
    });

    this.emitUpdated(scope, id);
    return { id, orphanedBacklinks };
  }

  // ── Tree ──────────────────────────────────────────────────────────────────

  async tree(userId: string, projectId: string): Promise<PageTreeNode[]> {
    await assertProjectRole(this.prisma, userId, projectId, Role.VIEWER);
    return this.buildTree({ projectId });
  }

  /** Top-of-workspace docs tree: workspace-level pages only (`projectId: null`). */
  async workspaceTree(userId: string, workspaceId: string): Promise<PageTreeNode[]> {
    await assertWorkspaceRole(this.prisma, userId, workspaceId, Role.VIEWER);
    return this.buildTree({ workspaceId, projectId: null });
  }

  private async buildTree(where: Prisma.PageWhereInput): Promise<PageTreeNode[]> {
    const rows = await this.prisma.page.findMany({
      where,
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
    const scope = this.scopeOf(existing);
    await this.assertPageRole(userId, scope, Role.MEMBER);

    const targetParentId =
      dto.parentId === undefined ? existing.parentId : dto.parentId;

    const page = await this.prisma.$transaction(async (tx) => {
      if (targetParentId !== null) {
        await this.assertParentInScope(targetParentId, scope, tx);
      }
      await this.assertNoCycle(tx, id, targetParentId);

      let beforeRank: string | null = null;
      let afterRank: string | null = null;
      if (dto.beforeId) {
        const before = await this.loadSibling(
          tx,
          dto.beforeId,
          scope,
          targetParentId,
        );
        beforeRank = before.rank;
      }
      if (dto.afterId) {
        const after = await this.loadSibling(
          tx,
          dto.afterId,
          scope,
          targetParentId,
        );
        afterRank = after.rank;
      }

      let newRank: string;
      if (!dto.beforeId && !dto.afterId) {
        // No explicit neighbor given: append to the end of the destination
        // sibling list.
        const last = await tx.page.findFirst({
          where: { ...this.siblingWhere(scope, targetParentId), id: { not: id } },
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
            scope,
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

    this.emitUpdated(scope, id);
    return toPageDto(page as PageRow);
  }

  /** Load a sibling page by id and assert it's actually in the destination sibling list. */
  private async loadSibling(
    tx: Prisma.TransactionClient,
    siblingId: string,
    scope: PageScope,
    parentId: string | null,
  ) {
    const sibling = await tx.page.findUnique({ where: { id: siblingId } });
    const inScope = sibling
      ? scope.projectId !== null
        ? sibling.projectId === scope.projectId
        : sibling.workspaceId === scope.workspaceId && sibling.projectId === null
      : false;
    if (!sibling || !inScope || sibling.parentId !== parentId) {
      throw new BadRequestException(
        'beforeId/afterId must reference a page that is already a sibling of the destination parent',
      );
    }
    return sibling;
  }

  /**
   * One-time rebalance fallback for when `rankBetween` throws because the
   * two neighbor ranks are adjacent/exhausted (no fractional room left
   * between them). Re-spaces every sibling under `(scope, parentId)`
   * with fresh, evenly-spaced ranks and re-derives the moved page's rank
   * from the rebalanced order — mirrors `IssuesService.rebalanceAndPlace`.
   */
  private async rebalanceSiblingsAndPlace(
    tx: Prisma.TransactionClient,
    scope: PageScope,
    parentId: string | null,
    id: string,
    beforeId: string | null,
  ): Promise<string> {
    const siblings = await tx.page.findMany({
      where: { ...this.siblingWhere(scope, parentId), id: { not: id } },
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

  /**
   * Assert `parentId` refers to an existing page in the same scope (same
   * project for a project page; same workspace's OTHER workspace-level pages
   * for a workspace page — never cross-scope). 400 otherwise.
   */
  private async assertParentInScope(
    parentId: string,
    scope: PageScope,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const parent = await tx.page.findUnique({ where: { id: parentId } });
    const inScope = parent
      ? scope.projectId !== null
        ? parent.projectId === scope.projectId
        : parent.workspaceId === scope.workspaceId && parent.projectId === null
      : false;
    if (!parent || !inScope) {
      throw new BadRequestException(
        scope.projectId !== null
          ? 'parentId must reference a page in the same project'
          : 'parentId must reference a workspace-level page in the same workspace',
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
    await this.assertPageRole(userId, this.scopeOf(page), Role.VIEWER);

    const limit = Math.min(query.limit ?? VERSIONS_DEFAULT_LIMIT, VERSIONS_MAX_LIMIT);
    const cursorVersion = query.cursor ? decodeVersionCursor(query.cursor) : null;

    const rows = await this.prisma.pageVersion.findMany({
      where: {
        pageId: id,
        ...(cursorVersion !== null ? { versionNumber: { lt: cursorVersion } } : {}),
      },
      // Explicit select — the summary DTO never returns `content`, and each
      // version's content can be up to 256 KiB; `include` would pull ~50 MB
      // of bodies per full page only to discard them (code-review
      // should-fix on 3b03430).
      select: {
        id: true,
        pageId: true,
        versionNumber: true,
        title: true,
        editedById: true,
        createdAt: true,
        editedBy: true,
      },
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
    await this.assertPageRole(userId, this.scopeOf(page), Role.VIEWER);

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
    const scope = this.scopeOf(existing);
    const projectKey = await this.assertPageRole(userId, scope, Role.MEMBER);

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

      await this.syncWikiLinks(tx, scope, id, target.content);
      if (scope.projectId !== null && projectKey !== null) {
        await this.syncIssueLinks(tx, scope.projectId, projectKey, id, target.content);
      }

      return updated;
    });

    this.emitUpdated(scope, id);
    return toPageDto(page as PageRow);
  }

  // ── Backlinks + graph ────────────────────────────────────────────────────

  async backlinks(userId: string, id: string): Promise<PageBacklinkDto[]> {
    const page = await this.prisma.page.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Page not found');
    await this.assertPageRole(userId, this.scopeOf(page), Role.VIEWER);

    // Since Slice 15, a source page can legitimately live in a DIFFERENT
    // project than `id` (or in the workspace-docs space) — pull enough of
    // its scope (projectId/project.key/workspaceId) for the client to route
    // to it and label it with a cross-project badge (see `PageBacklinkDto`'s
    // doc). This never leaks a foreign WORKSPACE's page: every row here is
    // already guaranteed same-workspace-as-`id` by construction (Slice 15
    // never creates a cross-workspace `PageLink`).
    const rows = await this.prisma.pageLink.findMany({
      where: { targetPageId: id },
      include: {
        sourcePage: {
          select: {
            id: true,
            title: true,
            projectId: true,
            workspaceId: true,
            project: { select: { key: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => ({
      id: row.id,
      sourcePageId: row.sourcePageId,
      sourcePageTitle: row.sourcePage.title,
      sourceProjectId: row.sourcePage.projectId,
      sourceProjectKey: row.sourcePage.project?.key ?? null,
      sourceWorkspaceId: row.sourcePage.workspaceId,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * This page's outgoing `[[wiki-link]]` edges. `resolved` is read straight
   * from the stored `PageLink` rows (the same source `graph`/`backlinks` use),
   * so the target ids are authoritative — never a client-side re-derivation
   * that could diverge from real link-sync when two pages share a title.
   * `unresolvedTitles` are `[[titles]]` in the content with no matching page
   * yet (the "link first, create later" flow); computed by diffing the parsed
   * titles against the resolved targets' titles.
   */
  async links(userId: string, id: string): Promise<PageOutgoingLinksDto> {
    const page = await this.prisma.page.findUnique({
      where: { id },
      select: { id: true, projectId: true, workspaceId: true, title: true, content: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    await this.assertPageRole(userId, this.scopeOf(page), Role.VIEWER);

    // Since Slice 15, a target page can legitimately live in a DIFFERENT
    // project than `id` (or in the workspace-docs space) — see `backlinks()`
    // above for why the extra scope fields are pulled and why this never
    // leaks a foreign workspace's page.
    const rows = await this.prisma.pageLink.findMany({
      where: { sourcePageId: id },
      include: {
        targetPage: {
          select: {
            id: true,
            title: true,
            projectId: true,
            workspaceId: true,
            project: { select: { key: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_OUTGOING_LINKS + 1,
    });
    const truncated = rows.length > MAX_OUTGOING_LINKS;
    const resolved = (truncated ? rows.slice(0, MAX_OUTGOING_LINKS) : rows).map((row) => ({
      targetPageId: row.targetPage.id,
      targetPageTitle: row.targetPage.title,
      targetProjectId: row.targetPage.projectId,
      targetProjectKey: row.targetPage.project?.key ?? null,
      targetWorkspaceId: row.targetPage.workspaceId,
    }));

    // Unresolved = parsed [[titles]] (self excluded) whose lowercase doesn't
    // match any resolved target's title. Matches the resolution rule
    // syncWikiLinks applied on the write that produced these rows.
    const resolvedLower = new Set(resolved.map((r) => r.targetPageTitle.toLowerCase()));
    const selfLower = page.title.toLowerCase();
    const seen = new Set<string>();
    const unresolvedTitles: string[] = [];
    for (const link of parseWikiLinks(page.content)) {
      const lower = link.title.toLowerCase();
      if (lower === selfLower || resolvedLower.has(lower) || seen.has(lower)) continue;
      seen.add(lower);
      unresolvedTitles.push(link.title);
    }

    return { resolved, unresolvedTitles, truncated };
  }

  // ── Issue cross-links (in + out) ─────────────────────────────────────────

  /**
   * The issues this page's body currently references — reconciled into
   * `PageIssueLink` on every save/restore by `syncIssueLinks`, so this is a
   * straight read of that join table (never a live re-parse of `content`),
   * ordered newest-linked-first.
   */
  async pageIssues(userId: string, id: string): Promise<PageLinkedIssuesDto> {
    const page = await this.prisma.page.findUnique({
      where: { id },
      select: { id: true, projectId: true, workspaceId: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    await this.assertPageRole(userId, this.scopeOf(page), Role.VIEWER);

    const rows = await this.prisma.pageIssueLink.findMany({
      where: { pageId: id },
      include: {
        issue: {
          select: {
            id: true,
            number: true,
            type: true,
            title: true,
            statusId: true,
            project: { select: { key: true } },
            status: {
              select: {
                id: true,
                name: true,
                category: true,
                order: true,
                wipLimit: true,
                projectId: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_LINKED_ISSUES + 1,
    });
    const truncated = rows.length > MAX_LINKED_ISSUES;
    const items = (truncated ? rows.slice(0, MAX_LINKED_ISSUES) : rows).map((row) =>
      toIssueRefDto(row.issue),
    );

    return { items, truncated };
  }

  /**
   * The pages whose body currently references this issue — the other
   * direction of `pageIssues`, powering the issue drawer's "Linked pages"
   * section. Authorization is checked against the ISSUE's project (not a
   * page id the caller doesn't have), matching every other issue-scoped
   * read in the API.
   */
  async issuePages(userId: string, issueId: string): Promise<IssueLinkedPagesDto> {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { id: true, projectId: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    await assertProjectRole(this.prisma, userId, issue.projectId, Role.VIEWER);

    const rows = await this.prisma.pageIssueLink.findMany({
      where: { issueId },
      include: { page: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
      take: MAX_LINKED_PAGES + 1,
    });
    const truncated = rows.length > MAX_LINKED_PAGES;
    const items = (truncated ? rows.slice(0, MAX_LINKED_PAGES) : rows).map((row) => ({
      id: row.page.id,
      title: row.page.title,
    }));

    return { items, truncated };
  }

  async graph(userId: string, projectId: string): Promise<PageGraphDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.VIEWER);
    return this.buildGraph({ projectId });
  }

  /**
   * Workspace-wide docs graph (org-level-docs epic, Slice 16) — the UNION of
   * every project's page graph in this workspace PLUS the workspace-docs
   * space: nodes are every `Page` whose `workspaceId` matches (project pages
   * across ALL of the workspace's projects, and workspace-level pages),
   * edges are the `PageLink` rows between them. An edge to/from a
   * foreign-workspace page cannot exist by construction (`syncWikiLinks`,
   * Slice 15, only ever resolves within `workspaceId`) — `buildGraph` still
   * scopes the edge query to the retained node-id set below, same as the
   * per-project graph, so this holds even under the node-count cap (never a
   * dangling edge to a node that got truncated out).
   *
   * The per-project `graph()` method above is UNCHANGED — still narrowed to
   * one project's own pages, for anyone who wants that tighter view; its
   * edge query is scoped to that project's node-id list, so a cross-project
   * edge Slice 15 can now create is naturally excluded from it (the target
   * id is never in that project's node list).
   */
  async workspaceGraph(userId: string, workspaceId: string): Promise<PageGraphDto> {
    await assertWorkspaceRole(this.prisma, userId, workspaceId, Role.VIEWER);
    return this.buildGraph({ workspaceId });
  }

  private async buildGraph(where: Prisma.PageWhereInput): Promise<PageGraphDto> {
    // Fetch one extra row beyond the cap to detect truncation without a
    // separate COUNT query (same pattern as ROADMAP_EPICS_CAP).
    const fetched = await this.prisma.page.findMany({
      where,
      select: { id: true, title: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_GRAPH_NODES + 1,
    });
    const nodesTruncated = fetched.length > MAX_GRAPH_NODES;
    const nodes = nodesTruncated ? fetched.slice(0, MAX_GRAPH_NODES) : fetched;
    const nodeIdList = nodes.map((n) => n.id);

    // Scope the edge query to the capped node set (both endpoints must be a
    // kept node) AND cap the edge rows themselves — a project with thousands
    // of pages each linking many titles can otherwise produce millions of
    // PageLink rows, and pulling them all into memory before filtering is a
    // resource-exhaustion vector any pages:write member could trigger
    // (code-review must-fix on 3b03430). The `in`-list bounds it so Postgres
    // never materialises an edge outside the visible graph; the `take` is a
    // hard ceiling with its own truncation flag.
    const edgeRows = await this.prisma.pageLink.findMany({
      where: {
        sourcePageId: { in: nodeIdList },
        targetPageId: { in: nodeIdList },
      },
      select: { sourcePageId: true, targetPageId: true },
      take: MAX_GRAPH_EDGES + 1,
    });
    const edgesTruncated = edgeRows.length > MAX_GRAPH_EDGES;
    const edges = (edgesTruncated ? edgeRows.slice(0, MAX_GRAPH_EDGES) : edgeRows).map(
      (e) => ({ sourceId: e.sourcePageId, targetId: e.targetPageId }),
    );

    return {
      nodes: nodes.map((n) => ({ id: n.id, title: n.title })),
      edges,
      truncated: nodesTruncated || edgesTruncated,
    };
  }

  // ── [[wiki-link]] parsing + PageLink sync ───────────────────────────────

  /**
   * Parse `content` for `[[wiki-link]]` references (via the shared
   * `parseWikiLinks`), resolve each title to a page in the SAME WORKSPACE
   * (case-insensitive exact match, self excluded), and reconcile this page's
   * outgoing `PageLink` rows to match — add missing edges, remove stale
   * ones. An unresolved `[[link]]` (no matching title) is simply skipped;
   * see `parseWikiLinks`'s module doc for why that's not an error.
   *
   * Scope-of-resolution (org-level-docs epic, Slice 15 — cross-workspace-safe
   * `[[wiki-link]]` resolution): the candidate set is EVERY page — project-
   * scoped (any project) OR workspace-scoped — that shares this page's
   * `workspaceId`. This is what makes a project-A page able to link to a
   * page in project B, or to/from the workspace-docs space, within the same
   * workspace. It is deliberately NOT broadened past `workspaceId`: the
   * candidate query below is filtered to `scope.workspaceId` and nothing
   * wider, so a `[[Title]]` whose only match lives in a DIFFERENT workspace
   * resolves to NOTHING — zero `PageLink` row, rendered identically to a
   * genuinely nonexistent title (Obsidian's "not-yet-created page" state),
   * never a distinguishable "restricted" state. This is safe because every
   * workspace member already holds at least VIEWER on every project in that
   * workspace (`getEffectiveProjectRole`), so a cross-project link WITHIN one
   * workspace never crosses a visibility boundary — but a foreign workspace's
   * page is never even visible to begin with, and "resolved but you can't
   * open it" would itself leak that page's existence/title to a non-member.
   * See ROADMAP.md Phase 11 continuation item 15 for the full authz writeup
   * (same suppress-don't-half-reveal posture as the `4d3a43a` /search fix).
   *
   * Tie-break when a title matches more than one page in the workspace
   * (to NOT regress pre-slice-15 same-project/same-scope links): a match in
   * the SAME scope as the linking page — same `projectId` for a project
   * page, or another workspace-docs page (`projectId: null`) for a
   * workspace page — is preferred over a match in a different project;
   * within a tier, resolution is deterministic oldest-page-wins
   * (`createdAt` ascending). Concretely: candidates are fetched ordered by
   * `createdAt` ascending, then reduced to `title -> id` in TWO passes —
   * same-scope candidates first (so a same-project title always beats an
   * other-project one, preserving exactly what every pre-slice-15 test
   * asserts), then a second pass over ALL candidates fills in any title
   * that had no same-scope match at all, falling back to the oldest
   * workspace-wide match.
   *
   * Must run inside the SAME transaction as the page/version write that
   * triggered it (all three call sites — create/update/restore — already do
   * this), so a reader never observes a page whose content mentions a link
   * that hasn't been reconciled into `PageLink` yet.
   */
  private async syncWikiLinks(
    tx: Prisma.TransactionClient,
    scope: PageScope,
    sourcePageId: string,
    content: string,
  ): Promise<void> {
    const parsed = parseWikiLinks(content);
    // Cap the distinct titles we resolve per save at the same ceiling the read
    // side enforces (`MAX_OUTGOING_LINKS`). Without this, a pathological page
    // (up to 256 KiB of `[[a]][[b]]…`) would build an unbounded `OR` predicate
    // on every write — inconsistent with the MAX_* caps used everywhere else in
    // this file. A page linking to more than that many distinct pages only gets
    // the first N reconciled, which matches what `links()` will ever return.
    const uniqueTitles = [...new Set(parsed.map((l) => l.title.toLowerCase()))].slice(
      0,
      MAX_OUTGOING_LINKS,
    );

    let resolvedTargetIds = new Set<string>();
    if (uniqueTitles.length > 0) {
      // Candidate set = every page (project-scoped OR workspace-scoped) in
      // THIS workspace — see the method doc above for why `workspaceId` (not
      // `scopeWhere(scope)`) is the authz-relevant boundary here.
      const candidates = await tx.page.findMany({
        where: {
          workspaceId: scope.workspaceId,
          id: { not: sourcePageId }, // self-links excluded
          OR: uniqueTitles.map((title) => ({
            title: { equals: title, mode: 'insensitive' as const },
          })),
        },
        select: { id: true, title: true, createdAt: true, projectId: true },
        orderBy: { createdAt: 'asc' },
      });
      const inSameScope = (candidate: { projectId: string | null }): boolean =>
        candidate.projectId === scope.projectId;

      const byLowerTitle = new Map<string, string>();
      // Pass 1: same-scope candidates only, oldest-wins within the pass
      // (candidates are already createdAt-asc) — a same-project (or
      // same-workspace-docs) title match always beats an other-project one.
      for (const candidate of candidates) {
        if (!inSameScope(candidate)) continue;
        const key = candidate.title.toLowerCase();
        if (!byLowerTitle.has(key)) byLowerTitle.set(key, candidate.id);
      }
      // Pass 2: fall back to any candidate in the workspace (other scopes
      // included) for titles with no same-scope match, still oldest-wins.
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

  // ── Issue-key parsing + PageIssueLink sync ──────────────────────────────

  /**
   * Parse `content` for this project's issue keys (e.g. "NL-123", via the
   * shared `extractIssueNumbers` — the same project-scoped parser every SCM
   * integration uses for commit/branch/PR-title linking), resolve each
   * number to an `Issue` row in the SAME project, and reconcile this page's
   * `PageIssueLink` rows to match — add missing links, remove stale ones.
   * Mirrors `syncWikiLinks` exactly (see its doc for the general shape); the
   * key difference is the resolution key is a project-scoped issue number
   * instead of a page title, and there's no "unresolved/create later" flow —
   * an issue key with no matching `Issue` row (wrong number, or the issue
   * was deleted) is simply skipped, same as an unresolved `[[wiki-link]]`.
   *
   * Cross-project issue keys never match: `extractIssueNumbers` is built
   * from the CALLER-SUPPLIED `projectKey`, so a page in project "NL"
   * mentioning "OTHER-123" produces no match at all — the same scoping
   * `extractIssueNumbers`'s module doc documents for webhook-driven
   * commit/branch linking. There is deliberately no cross-project linking
   * escape hatch here.
   *
   * Must run inside the SAME transaction as the page/version write that
   * triggered it (all three call sites — create/update/restore — already do
   * this for `syncWikiLinks`), so a reader never observes a page whose
   * content mentions an issue key that hasn't been reconciled into
   * `PageIssueLink` yet.
   *
   * DELIBERATE SLICE-2 BEHAVIOR: `Issue` is project-scoped and a
   * workspace-level page (`projectId: null`) has no project to resolve issue
   * keys against, so every call site guards this method behind
   * `scope.projectId !== null` and simply never calls it for a workspace
   * page — no `PageIssueLink` rows are ever created for a workspace page's
   * content, even if it contains text that looks like an issue key. This
   * method itself is unchanged/project-only; it is never passed a workspace
   * page's `projectId` (which would be `null` and not type-check here).
   */
  private async syncIssueLinks(
    tx: Prisma.TransactionClient,
    projectId: string,
    projectKey: string,
    pageId: string,
    content: string,
  ): Promise<void> {
    // Cap the distinct issue numbers we resolve per save at the same ceiling
    // the read side enforces (`MAX_LINKED_ISSUES`), so a pathological page can't
    // build an unbounded `IN (…)` list on every write. Mirrors the cap in
    // `syncWikiLinks`.
    const numbers = extractIssueNumbers(content, projectKey).slice(0, MAX_LINKED_ISSUES);

    let resolvedIssueIds = new Set<string>();
    if (numbers.length > 0) {
      const issues = await tx.issue.findMany({
        where: { projectId, number: { in: numbers } },
        select: { id: true },
      });
      resolvedIssueIds = new Set(issues.map((i) => i.id));
    }

    const existingLinks = await tx.pageIssueLink.findMany({
      where: { pageId },
      select: { id: true, issueId: true },
    });
    const existingIssueIds = new Set(existingLinks.map((l) => l.issueId));

    const toAdd = [...resolvedIssueIds].filter((id) => !existingIssueIds.has(id));
    const toRemoveIds = existingLinks
      .filter((l) => !resolvedIssueIds.has(l.issueId))
      .map((l) => l.id);

    if (toAdd.length > 0) {
      await tx.pageIssueLink.createMany({
        data: toAdd.map((issueId) => ({ pageId, issueId })),
        skipDuplicates: true,
      });
    }
    if (toRemoveIds.length > 0) {
      await tx.pageIssueLink.deleteMany({ where: { id: { in: toRemoveIds } } });
    }
  }

  /**
   * Broadcast `page.updated`. Follows the realtime gateway's existing
   * room-naming convention (see `apps/api/src/realtime/realtime.gateway.ts`
   * — `userRoom` = `user:<id>`, the project room is the bare `projectId`): a
   * project page emits to the project room (unchanged); a workspace page
   * emits to the analogous `workspace:<id>` room via
   * `RealtimeService.emitToWorkspace` instead of (there being no project to
   * emit to at all).
   */
  private emitUpdated(scope: PageScope, pageId: string): void {
    if (scope.projectId !== null) {
      this.realtime.emitToProject(scope.projectId, SocketEvents.PageUpdated, {
        projectId: scope.projectId,
        pageId,
      });
    } else {
      this.realtime.emitToWorkspace(scope.workspaceId, SocketEvents.PageUpdated, {
        workspaceId: scope.workspaceId,
        pageId,
      });
    }
  }
}

/**
 * The scoping key every page-tree/sibling/link/authorization query is scoped
 * by — see the "Scope helpers" section on `PagesService` above.
 */
type PageScope = { workspaceId: string; projectId: string | null };

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

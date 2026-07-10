import { toUserDto } from '../auth/auth.service';
import type {
  PageDto,
  PageTreeNode,
  PageVersionDto,
  PageVersionSummaryDto,
} from '@next-lane/shared';

/** Minimal User row shape as returned by Prisma when included on a page/version. */
type UserRow = {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  emailNotifications: boolean;
  createdAt: Date;
};

export type PageRow = {
  id: string;
  /** Always present — see `Page.workspaceId`'s model comment in schema.prisma. */
  workspaceId: string;
  /** Null = workspace-level page (no single owning project). */
  projectId: string | null;
  parentId: string | null;
  title: string;
  content: string;
  rank: string;
  archived: boolean;
  authorId: string | null;
  author: UserRow | null;
  lastEditedById: string | null;
  lastEditedBy: UserRow | null;
  createdAt: Date;
  updatedAt: Date;
};

export const pageInclude = {
  author: true,
  lastEditedBy: true,
} as const;

export function toPageDto(page: PageRow): PageDto {
  return {
    id: page.id,
    workspaceId: page.workspaceId,
    projectId: page.projectId,
    parentId: page.parentId,
    title: page.title,
    content: page.content,
    rank: page.rank,
    archived: page.archived,
    authorId: page.authorId,
    author: page.author ? toUserDto(page.author) : null,
    lastEditedById: page.lastEditedById,
    lastEditedBy: page.lastEditedBy ? toUserDto(page.lastEditedBy) : null,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  };
}

type PageVersionRow = {
  id: string;
  pageId: string;
  versionNumber: number;
  title: string;
  content: string;
  editedById: string | null;
  editedBy: UserRow | null;
  createdAt: Date;
};

export function toPageVersionDto(version: PageVersionRow): PageVersionDto {
  return {
    id: version.id,
    pageId: version.pageId,
    versionNumber: version.versionNumber,
    title: version.title,
    content: version.content,
    editedById: version.editedById,
    editedBy: version.editedBy ? toUserDto(version.editedBy) : null,
    createdAt: version.createdAt.toISOString(),
  };
}

export function toPageVersionSummaryDto(
  version: Omit<PageVersionRow, 'content'>,
): PageVersionSummaryDto {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    title: version.title,
    editedById: version.editedById,
    editedBy: version.editedBy ? toUserDto(version.editedBy) : null,
    createdAt: version.createdAt.toISOString(),
  };
}

/** Flat row shape needed to build a project's page tree (sidebar navigation). */
export type PageTreeRow = {
  id: string;
  title: string;
  archived: boolean;
  rank: string;
  parentId: string | null;
};

/**
 * Build the nested `PageTreeNode[]` from a flat, rank-ordered list of a
 * project's pages. `rows` MUST already be ordered by `rank` ascending — this
 * function groups by `parentId` while preserving that order within each
 * group, so it never re-sorts.
 *
 * Defensive against corrupt/cyclic data (should be impossible given
 * `Page.parentId`'s `onDelete: Restrict` FK plus the service-layer cycle
 * checks on every reparent, but a tree-walk over untrusted-shape data should
 * never be able to infinite-loop): each page id is visited at most once.
 */
export function buildPageTree(rows: PageTreeRow[]): PageTreeNode[] {
  const byParent = new Map<string | null, PageTreeRow[]>();
  for (const row of rows) {
    const siblings = byParent.get(row.parentId);
    if (siblings) siblings.push(row);
    else byParent.set(row.parentId, [row]);
  }

  const visited = new Set<string>();

  function build(parentId: string | null): PageTreeNode[] {
    const children = byParent.get(parentId) ?? [];
    const nodes: PageTreeNode[] = [];
    for (const child of children) {
      if (visited.has(child.id)) continue; // guard against corrupt cyclic data
      visited.add(child.id);
      nodes.push({
        id: child.id,
        title: child.title,
        archived: child.archived,
        rank: child.rank,
        children: build(child.id),
      });
    }
    return nodes;
  }

  return build(null);
}

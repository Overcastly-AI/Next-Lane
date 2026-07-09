import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePageDto,
  PageBacklinkDto,
  PageDto,
  PageGraphDto,
  PageTreeNode,
  PageVersionDto,
  PaginatedPageVersionsDto,
  UpdatePageDto,
} from '@next-lane/shared';
import { request } from './client';
import { qk, invalidatePagesFamily } from './keys';

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** A project's page tree — the sidebar nav. */
export function usePageTree(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.pageTree(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () => request<PageTreeNode[]>(`/projects/${projectId}/pages/tree`),
  });
}

/** A project's whole page<->page wiki-link graph — the knowledge graph view. */
export function usePageGraph(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.pageGraph(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () => request<PageGraphDto>(`/projects/${projectId}/pages/graph`),
  });
}

/** A single page's full detail (title/content/metadata). */
export function usePage(pageId: string | undefined) {
  return useQuery({
    queryKey: qk.page(pageId ?? ''),
    enabled: !!pageId,
    queryFn: () => request<PageDto>(`/pages/${pageId}`),
  });
}

/** A page's version history, newest-first, cursor-paginated. */
export function usePageVersions(pageId: string | undefined) {
  return useInfiniteQuery<PaginatedPageVersionsDto, Error>({
    queryKey: qk.pageVersions(pageId ?? ''),
    enabled: !!pageId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (pageParam) params.set('cursor', pageParam as string);
      return request<PaginatedPageVersionsDto>(
        `/pages/${pageId}/versions?${params.toString()}`,
      );
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** One specific version's full content — fetched on demand (e.g. to preview before restoring). */
export function usePageVersion(pageId: string | undefined, versionNumber: number | undefined) {
  return useQuery({
    queryKey: qk.pageVersion(pageId ?? '', versionNumber ?? 0),
    enabled: !!pageId && !!versionNumber,
    queryFn: () => request<PageVersionDto>(`/pages/${pageId}/versions/${versionNumber}`),
  });
}

/** "What links here" — pages that link TO this page (Obsidian-style backlinks panel). */
export function usePageBacklinks(pageId: string | undefined) {
  return useQuery({
    queryKey: qk.pageBacklinks(pageId ?? ''),
    enabled: !!pageId,
    queryFn: () => request<PageBacklinkDto[]>(`/pages/${pageId}/backlinks`),
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreatePage(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreatePageDto) =>
      request<PageDto>(`/projects/${projectId}/pages`, { method: 'POST', body: dto }),
    onSuccess: () => {
      invalidatePagesFamily(qc, projectId);
    },
  });
}

export function useUpdatePage(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdatePageDto }) =>
      request<PageDto>(`/pages/${id}`, { method: 'PATCH', body: patch }),
    // Optimistically patch the single-page cache so title/content edits feel
    // instant; the tree/graph/backlinks families still need a server round
    // trip (wiki-link edges are resolved server-side), so those settle via
    // invalidation in onSuccess.
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qk.page(id) });
      const previous = qc.getQueryData<PageDto>(qk.page(id));
      if (previous) {
        qc.setQueryData<PageDto>(qk.page(id), { ...previous, ...patch });
      }
      return { previous };
    },
    onError: (_err, { id }, ctx) => {
      if (ctx?.previous) qc.setQueryData(qk.page(id), ctx.previous);
    },
    onSuccess: (data) => {
      qc.setQueryData(qk.page(data.id), data);
      invalidatePagesFamily(qc, projectId, data.id);
    },
  });
}

export function useDeletePage(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<void>(`/pages/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: qk.page(id) });
      invalidatePagesFamily(qc, projectId, id);
    },
  });
}

export interface MovePageVars {
  id: string;
  /** Omit = keep current parent. Null = move to top-level. */
  parentId?: string | null;
  beforeId?: string;
  afterId?: string;
}

/**
 * Reorder/reparent a page relative to a sibling. The server computes the
 * fractional-index rank from `beforeId`/`afterId` — the client never touches
 * rank encoding directly (see `MovePageDto`).
 *
 * Optimistically reorders the cached tree so an up/down move (or a future
 * drag) feels instant, then reconciles from the server response.
 */
export function useMovePage(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, parentId, beforeId, afterId }: MovePageVars) =>
      request<PageDto>(`/pages/${id}/move`, {
        method: 'POST',
        body: { parentId, beforeId, afterId },
      }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: qk.pageTree(projectId) });
      const previous = qc.getQueryData<PageTreeNode[]>(qk.pageTree(projectId));
      if (previous) {
        qc.setQueryData<PageTreeNode[]>(
          qk.pageTree(projectId),
          optimisticallyReorderTree(previous, vars),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(qk.pageTree(projectId), ctx.previous);
    },
    onSettled: () => {
      invalidatePagesFamily(qc, projectId);
    },
  });
}

/** Best-effort client-side reorder of the tree cache for instant feedback. */
function optimisticallyReorderTree(
  tree: PageTreeNode[],
  { id, beforeId, afterId }: MovePageVars,
): PageTreeNode[] {
  // Only handle the simple, common case here: a same-level swap with an
  // adjacent sibling (what the up/down affordance produces). Reparenting or
  // cross-branch drops just fall through unchanged until the server settles
  // (still correct, just a one-frame delay instead of instant).
  function reorderSiblings(nodes: PageTreeNode[]): PageTreeNode[] {
    const idx = nodes.findIndex((n) => n.id === id);
    if (idx === -1) {
      return nodes.map((n) =>
        n.children.length ? { ...n, children: reorderSiblings(n.children) } : n,
      );
    }
    const next = nodes.slice();
    const [moved] = next.splice(idx, 1);
    if (afterId) {
      const afterIdx = next.findIndex((n) => n.id === afterId);
      next.splice(afterIdx === -1 ? next.length : afterIdx + 1, 0, moved);
    } else if (beforeId) {
      const beforeIdx = next.findIndex((n) => n.id === beforeId);
      next.splice(beforeIdx === -1 ? 0 : beforeIdx, 0, moved);
    } else {
      next.push(moved);
    }
    return next;
  }
  return reorderSiblings(tree);
}

export function useRestorePageVersion(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pageId, versionNumber }: { pageId: string; versionNumber: number }) =>
      request<PageDto>(`/pages/${pageId}/versions/${versionNumber}/restore`, {
        method: 'POST',
      }),
    onSuccess: (data) => {
      qc.setQueryData(qk.page(data.id), data);
      invalidatePagesFamily(qc, projectId, data.id);
    },
  });
}

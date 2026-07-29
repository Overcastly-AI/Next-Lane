import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  CreatePageDto,
  IssueLinkedPagesDto,
  PageBacklinkDto,
  PageDto,
  PageGraphDto,
  PageLinkedIssuesDto,
  PageOutgoingLinksDto,
  PageTreeNode,
  PageVersionDto,
  PaginatedPageVersionsDto,
  UpdatePageDto,
} from '@next-lane/shared';
import { request } from './client';
import {
  qk,
  invalidatePagesFamily,
  pagesTreeKey,
  pagesGraphKey,
  type PagesScope,
} from './keys';
import { optimisticallyReorderTree } from './pages.reorder';

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

/**
 * A workspace's org-wide docs tree — the workspace Docs surface's sidebar
 * nav (`GET /workspaces/:id/pages/tree`, mirrors `usePageTree`'s shape but a
 * page here always has `projectId: null`).
 */
export function useWorkspacePagesTree(workspaceId: string | undefined) {
  return useQuery({
    queryKey: qk.workspacePageTree(workspaceId ?? ''),
    enabled: !!workspaceId,
    queryFn: () => request<PageTreeNode[]>(`/workspaces/${workspaceId}/pages/tree`),
  });
}

/**
 * A workspace's org-wide page<->page wiki-link graph — the workspace Docs
 * surface's Graph view (`GET /workspaces/:id/pages/graph`).
 */
export function useWorkspacePageGraph(workspaceId: string | undefined) {
  return useQuery({
    queryKey: qk.workspacePageGraph(workspaceId ?? ''),
    enabled: !!workspaceId,
    queryFn: () => request<PageGraphDto>(`/workspaces/${workspaceId}/pages/graph`),
  });
}

/**
 * Knowledge-base pages that reference a given issue — the issue drawer's
 * "Linked pages" section (the reverse of a page's issue cross-links).
 */
export function useIssuePages(issueId: string | undefined) {
  return useQuery({
    queryKey: qk.issuePages(issueId ?? ''),
    enabled: !!issueId,
    queryFn: () => request<IssueLinkedPagesDto>(`/issues/${issueId}/pages`),
  });
}

/**
 * Issues a given page's body references — the page reading view's "Linked
 * issues" panel (the reverse of `useIssuePages`, populated server-side on
 * every page save, same as backlinks).
 */
export function usePageIssues(pageId: string | undefined) {
  return useQuery({
    queryKey: qk.pageIssues(pageId ?? ''),
    enabled: !!pageId,
    queryFn: () => request<PageLinkedIssuesDto>(`/pages/${pageId}/issues`),
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

/**
 * This page's own outgoing `[[wiki-link]]` edges, resolved authoritatively
 * server-side (org-level-docs epic, BACKLOG #12b) — the "Links out" panel,
 * outgoing companion to `usePageBacklinks`. `resolved[]` entries now carry
 * the target's own scope (`targetProjectId`/`targetProjectKey`/
 * `targetWorkspaceId`) since a link can resolve to a page in a different
 * project, or the workspace-docs space — see `lib/pageRoute.ts`.
 */
export function usePageOutgoingLinks(pageId: string | undefined) {
  return useQuery({
    queryKey: qk.pageOutgoingLinks(pageId ?? ''),
    enabled: !!pageId,
    queryFn: () => request<PageOutgoingLinksDto>(`/pages/${pageId}/links`),
  });
}

/**
 * Fetch a page's own scope (`projectId`/`workspaceId`) by id, imperatively —
 * NOT a `use*` hook. For a caller that only has a bare page id and needs to
 * resolve where that page actually lives before routing to it. (Historical
 * note: `KnowledgeGraphView` used to call this for every workspace-graph
 * node click before `PageGraphNode` carried `projectId` — since it does
 * now, that call site routes directly instead. Kept here as a general
 * utility for any future caller in the same situation.) Goes through the
 * query client's cache (same key `usePage` reads/writes) so it's a no-op
 * network call when the page is already cached, and it warms that cache for
 * the page view that opens immediately after.
 */
export function fetchPageScope(qc: QueryClient, pageId: string): Promise<PageDto> {
  return qc.fetchQuery({
    queryKey: qk.page(pageId),
    queryFn: () => request<PageDto>(`/pages/${pageId}`),
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
      invalidatePagesFamily(qc, { kind: 'project', id: projectId });
    },
  });
}

/**
 * Create a workspace-level page (`projectId: null`) — the workspace Docs
 * surface's "New page" entry point (`POST /workspaces/:id/pages`). Mirrors
 * `useCreatePage` exactly, just a different scope/endpoint.
 */
export function useCreateWorkspacePage(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreatePageDto) =>
      request<PageDto>(`/workspaces/${workspaceId}/pages`, { method: 'POST', body: dto }),
    onSuccess: () => {
      invalidatePagesFamily(qc, { kind: 'workspace', id: workspaceId });
    },
  });
}

/**
 * By-id mutations below (update/delete/move/restore) operate on `/pages/:id`
 * unchanged regardless of whether the target page is project- or
 * workspace-scoped — the server branches internally. They take a `PagesScope`
 * (not a bare `projectId`) purely so they invalidate the RIGHT tree/graph
 * cache family: `PagesSurface` passes `{ kind: 'project', id }` when mounted
 * under a project's Pages route and `{ kind: 'workspace', id }` under the
 * workspace Docs route.
 */
export function useUpdatePage(scope: PagesScope) {
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
      invalidatePagesFamily(qc, scope, data.id);
    },
  });
}

export function useDeletePage(scope: PagesScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<void>(`/pages/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: qk.page(id) });
      invalidatePagesFamily(qc, scope, id);
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
 * Shared mutation key for page moves, so that a burst of rapid reorders can
 * be recognised as one batch and only the last one triggers a refetch.
 */
const MOVE_PAGE_MUTATION_KEY = ['pages', 'move'] as const;

/**
 * Serialises page-move requests.
 *
 * A move is expressed RELATIVE to siblings (`beforeId`/`afterId`) and the
 * server derives the fractional rank from those neighbours' CURRENT ranks.
 * The caller picks the neighbours from its optimistic tree, so each request
 * assumes every earlier move has already been applied. Fired concurrently —
 * which is what happens when a user clicks "move up" a few times quickly —
 * they race: a later move is ranked against neighbours the server has not
 * repositioned yet, and the order that survives a reload is a mid-sequence
 * one with the trailing moves silently lost.
 *
 * Chaining the requests keeps them in intent order. The optimistic cache
 * update still happens immediately in `onMutate`, so the UI stays instant;
 * only the network writes queue. A failed request must not stall the chain,
 * hence the `catch` on the stored tail.
 */
let movePageChain: Promise<unknown> = Promise.resolve();

/**
 * Reorder/reparent a page relative to a sibling. The server computes the
 * fractional-index rank from `beforeId`/`afterId` — the client never touches
 * rank encoding directly (see `MovePageDto`).
 *
 * Optimistically reorders the cached tree so an up/down move (or a future
 * drag) feels instant, then reconciles from the server response.
 */
export function useMovePage(scope: PagesScope) {
  const qc = useQueryClient();
  const treeKey = pagesTreeKey(scope);
  return useMutation({
    // Shared key so concurrent moves can see each other in `onSettled`.
    mutationKey: MOVE_PAGE_MUTATION_KEY,
    mutationFn: ({ id, parentId, beforeId, afterId }: MovePageVars) => {
      // Queue behind any move already in flight — see `movePageChain`.
      const run = movePageChain.then(() =>
        request<PageDto>(`/pages/${id}/move`, {
          method: 'POST',
          body: { parentId, beforeId, afterId },
        }),
      );
      movePageChain = run.catch(() => undefined);
      return run;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: treeKey });
      const previous = qc.getQueryData<PageTreeNode[]>(treeKey);
      if (previous) {
        qc.setQueryData<PageTreeNode[]>(
          treeKey,
          optimisticallyReorderTree(previous, vars),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(treeKey, ctx.previous);
      // The move was rejected, so the optimistic tree is a lie — resync.
      void qc.invalidateQueries({ queryKey: treeKey });
    },
    // Deliberately does NOT invalidate the tree on success.
    //
    // The optimistic reorder already encodes exactly the move the server was
    // asked to perform, so a refetch can only return the same order — but it
    // re-renders the tree, and THAT is what broke reordering: a refetch
    // landing between two clicks swapped the rows underneath the user, so
    // `handleMove` (which resolves the node's index in the tree it is holding)
    // decided the next move was out of bounds and silently did nothing. A
    // captured failing run shows six clicks producing only five requests —
    // the last one was swallowed, and the reload exposed the missing move.
    //
    // The graph is derived from ranks, so it still needs refreshing; that is
    // scoped to the last in-flight move (`isMutating(...) === 1`) so a burst
    // of reorders refetches once rather than N times.
    onSettled: () => {
      if (qc.isMutating({ mutationKey: MOVE_PAGE_MUTATION_KEY }) === 1) {
        void qc.invalidateQueries({ queryKey: pagesGraphKey(scope) });
      }
    },
  });
}

export function useRestorePageVersion(scope: PagesScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pageId, versionNumber }: { pageId: string; versionNumber: number }) =>
      request<PageDto>(`/pages/${pageId}/versions/${versionNumber}/restore`, {
        method: 'POST',
      }),
    onSuccess: (data) => {
      qc.setQueryData(qk.page(data.id), data);
      invalidatePagesFamily(qc, scope, data.id);
    },
  });
}

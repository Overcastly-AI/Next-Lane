/**
 * PagesSurface — the Confluence x Obsidian-hybrid knowledge base surface:
 * a tree of markdown pages with a Document view (tree + editor + backlinks)
 * and a Graph view (the force-directed knowledge graph).
 *
 * Scope-parameterized (`PagesScope`) so the EXACT same component tree and
 * orchestration logic (tree nav, editor, create/delete/move, version
 * history, mobile drawer, Document/Graph toggle, unsaved-changes guard)
 * powers BOTH:
 *  - a project's own page tree (`PagesPage`, `scope: { kind: 'project' }`)
 *  - a workspace's org-wide docs space (`WorkspaceDocsPage`,
 *    `scope: { kind: 'workspace' }` — pages here have `projectId: null` and
 *    no "Linked issues" section, since a workspace page has no owning
 *    project to cross-link issues from — see `showLinkedIssues`).
 *
 * Route ownership (URL construction, chrome/breadcrumb, realtime
 * subscription) stays with the two thin page-level wrappers — this
 * component only knows its `basePath` (e.g. `/projects/:id/pages` or
 * `/workspaces/:id/docs`) and reads the optional `:pageId` param off
 * whatever route it's actually mounted under.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import type { PageTreeNode } from '@next-lane/shared';
import type { PagesScope } from '@/api/keys';
import {
  useCreatePage,
  useCreateWorkspacePage,
  useDeletePage,
  useMovePage,
  usePage,
  usePageTree,
  useUpdatePage,
  useWorkspacePagesTree,
} from '@/api/pages';
import { flattenPageTree, buildTitleIndex } from '@/lib/wikiLinks';
import { errorMessage } from '@/lib/errorMessage';
import { useOverlay } from '@/lib/useOverlay';
import { useUnsavedChangesGuard } from '@/lib/unsavedChangesGuard';
import { usePersistentWidth } from '@/lib/usePersistentWidth';
import type { DropPosition } from '@/lib/useTreeDrag';
import { pageRefPath, type PageScopeRef } from '@/lib/pageRoute';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { ResizeHandle } from '@/components/ui/ResizeHandle';
import { PageTree } from './PageTree';
import { PageEditor } from './PageEditor';
import { BacklinksPanel } from './BacklinksPanel';
import { OutgoingLinksPanel } from './OutgoingLinksPanel';
import { PageLinkedIssuesSection } from './PageLinkedIssuesSection';
import { VersionHistoryDrawer } from './VersionHistoryDrawer';
import { KnowledgeGraphView } from './graph/KnowledgeGraphView';
import { BLANK_TEMPLATE_ID, CreatePageModal } from './CreatePageModal';
import { usePageTemplates, useCreatePageFromTemplate } from '@/api/pageTemplates';
import { cn } from '@/lib/cn';

/**
 * The Document/Graph segmented control — shared verbatim between the
 * Document view's own toolbar row and the Graph view's full-bleed top bar
 * (`KnowledgeGraphView`'s `viewToggle` prop) so "back to Document" is always
 * one click away no matter which surface is currently mounted. Only ONE of
 * the two call sites is ever mounted at a time (they're mutually exclusive
 * on `isGraphMode`), so the `data-testid`s below never collide in the DOM.
 */
function ViewToggle({
  isGraphMode,
  onDocument,
  onGraph,
}: {
  isGraphMode: boolean;
  onDocument: () => void;
  onGraph: () => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-ink-200 bg-ink-50 p-0.5 text-xs font-medium">
      <button
        type="button"
        onClick={onDocument}
        data-testid="pages-view-document"
        aria-pressed={!isGraphMode}
        className={cn(
          'rounded px-2.5 py-1 transition-colors duration-[120ms]',
          !isGraphMode ? 'bg-surface text-ink-900 shadow-xs' : 'text-ink-500 hover:text-ink-800',
        )}
      >
        Document
      </button>
      <button
        type="button"
        onClick={onGraph}
        data-testid="pages-view-graph"
        aria-pressed={isGraphMode}
        className={cn(
          'rounded px-2.5 py-1 transition-colors duration-[120ms]',
          isGraphMode ? 'bg-surface text-ink-900 shadow-xs' : 'text-ink-500 hover:text-ink-800',
        )}
      >
        Graph
      </button>
    </div>
  );
}

/** Find the id of the FIRST page in tree order (depth-first, top-level-first). */
function firstPageId(tree: PageTreeNode[]): string | undefined {
  return tree[0]?.id;
}

interface Siblings {
  siblings: PageTreeNode[];
  parentId: string | null;
}

/** Depth-first lookup of a node by id. */
function findNode(tree: PageTreeNode[], nodeId: string): PageTreeNode | null {
  for (const node of tree) {
    if (node.id === nodeId) return node;
    const hit = findNode(node.children, nodeId);
    if (hit) return hit;
  }
  return null;
}

/** Locate the sibling array (and its parent id) containing `nodeId`. */
function findSiblings(tree: PageTreeNode[], nodeId: string, parentId: string | null = null): Siblings | null {
  if (tree.some((n) => n.id === nodeId)) return { siblings: tree, parentId };
  for (const node of tree) {
    const found = findSiblings(node.children, nodeId, node.id);
    if (found) return found;
  }
  return null;
}

export interface PagesSurfaceProps {
  scope: PagesScope;
  /** The route prefix this surface is mounted under, e.g. `/projects/abc/pages` or `/workspaces/abc/docs` — no trailing slash. */
  basePath: string;
  editable: boolean;
  /**
   * Whether to render the "Linked issues" panel. False for a workspace page
   * (`projectId: null`) — the backend doesn't sync issue mentions for
   * workspace-scoped pages (no owning project to resolve issue keys
   * against), so there's nothing to show.
   */
  showLinkedIssues: boolean;
  emptyTitle: string;
  emptyDescription: string;
}

/**
 * Page-tree sidebar width bounds (px).
 *
 * 240 was the old fixed `w-64`, kept as the default so nothing moves for
 * anyone who never drags. The MINIMUM is 180 rather than something smaller
 * because below that the row's disclosure caret, icon, title and hover
 * actions stop co-existing and titles truncate to two or three characters —
 * a width that "works" but is useless. The MAXIMUM stops the tree from
 * crowding out the document it exists to navigate.
 */
const TREE_WIDTH_DEFAULT = 240;
const TREE_WIDTH_MIN = 180;
const TREE_WIDTH_MAX = 480;

export function PagesSurface({
  scope,
  basePath,
  editable,
  showLinkedIssues,
  emptyTitle,
  emptyDescription,
}: PagesSurfaceProps) {
  const { pageId } = useParams<{ pageId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  const isGraphMode = pageId === undefined && location.pathname === `${basePath}/graph`;

  // The page editor registers itself here whenever it has unsaved edits
  // (see `PageEditor.tsx`); every navigation this component itself drives —
  // switching tree pages, toggling Document/Graph — goes through
  // `confirmDiscard()` first so an in-progress edit is never silently lost.
  const { confirmDiscard } = useUnsavedChangesGuard();

  // Exactly one tree query is enabled per scope — see `KnowledgeGraphView`'s
  // identical dual-hook pattern for why (hooks must be called unconditionally).
  const projectTreeQuery = usePageTree(scope.kind === 'project' ? scope.id : undefined);
  const workspaceTreeQuery = useWorkspacePagesTree(scope.kind === 'workspace' ? scope.id : undefined);
  const treeQuery = scope.kind === 'project' ? projectTreeQuery : workspaceTreeQuery;

  const pageQuery = usePage(!isGraphMode ? pageId : undefined);

  const createProjectPage = useCreatePage(scope.kind === 'project' ? scope.id : '');
  const createWorkspacePage = useCreateWorkspacePage(scope.kind === 'workspace' ? scope.id : '');
  const createPage = scope.kind === 'project' ? createProjectPage : createWorkspacePage;
  // Doc templates offered for this scope. A project's list also carries the
  // workspace-wide templates it inherits (server-merged, project rows first).
  const templatesQuery = usePageTemplates(scope);
  const createFromTemplate = useCreatePageFromTemplate(scope);

  const updatePage = useUpdatePage(scope);
  const deletePage = useDeletePage(scope);
  const movePage = useMovePage(scope);

  const tree = treeQuery.data ?? [];
  const pageOptions = useMemo(() => flattenPageTree(tree), [tree]);
  const titleIndex = useMemo(() => buildTitleIndex(tree), [tree]);

  // Auto-open the first page when landing on the bare base route.
  useEffect(() => {
    if (isGraphMode || pageId || !treeQuery.data) return;
    const first = firstPageId(treeQuery.data);
    if (first) navigate(`${basePath}/${first}`, { replace: true });
  }, [isGraphMode, pageId, treeQuery.data, basePath, navigate]);

  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  // True while the editor is in edit mode — the backlinks panel is hidden so
  // the editing canvas gets the full page (founder directive: full-page editing).
  const [editingPage, setEditingPage] = useState(false);
  // Width of the page-tree sidebar, drag-resizable and persisted. One key for
  // BOTH scopes on purpose: a reader who widens the tree because their page
  // titles are long wants that everywhere, not re-set per project.
  const [treeWidth, setTreeWidth] = usePersistentWidth(
    'nl_pages_tree_width',
    TREE_WIDTH_DEFAULT,
    TREE_WIDTH_MIN,
    TREE_WIDTH_MAX,
  );

  const [createModal, setCreateModal] = useState<{ parentId: string | null; parentTitle?: string; initialTitle?: string } | null>(null);

  async function openPage(id: string) {
    const ok = await confirmDiscard();
    if (!ok) return;
    setMobileTreeOpen(false);
    navigate(`${basePath}/${id}`);
  }

  /**
   * Open a page reference by its OWN scope (org-level-docs epic, BACKLOG
   * #12b) — used wherever the target might live in a DIFFERENT project (or
   * the workspace-docs space) than `scope`: backlinks, outgoing links, and
   * workspace-graph nodes. `openPage` above stays basePath-relative for
   * same-scope-guaranteed call sites (the tree, the create-from-wiki-link
   * flow, per-project graph nodes) — `pageRefPath` computes the identical
   * route for those anyway, so nothing regresses by having both.
   */
  async function openPageRef(ref: PageScopeRef) {
    const ok = await confirmDiscard();
    if (!ok) return;
    setMobileTreeOpen(false);
    navigate(pageRefPath(ref));
  }

  function handleCreate(title: string, templateId: string) {
    if (!createModal) return;
    // Same success/failure handling either way — only the endpoint differs.
    const onSettled = {
      onSuccess: (created: { id: string }) => {
        toast.success('Page created.');
        setCreateModal(null);
        openPage(created.id);
      },
      onError: (err: unknown) =>
        toast.error(errorMessage(err, 'Could not create the page.')),
    };

    if (templateId === BLANK_TEMPLATE_ID) {
      createPage.mutate({ title, parentId: createModal.parentId }, onSettled);
      return;
    }

    // A workspace-wide template can create a page in EITHER space, so the
    // destination has to be stated explicitly: pass this surface's project
    // when mounted under one, and null for the workspace-docs surface.
    createFromTemplate.mutate(
      {
        templateId,
        title,
        parentId: createModal.parentId,
        projectId: scope.kind === 'project' ? scope.id : null,
      },
      onSettled,
    );
  }

  function handleMove(nodeId: string, direction: 'up' | 'down') {
    const found = findSiblings(tree, nodeId);
    if (!found) return;
    const idx = found.siblings.findIndex((n) => n.id === nodeId);
    if (direction === 'up' && idx > 0) {
      const prev = found.siblings[idx - 1];
      const prevPrev = found.siblings[idx - 2];
      movePage.mutate({ id: nodeId, beforeId: prevPrev?.id, afterId: prev.id });
    } else if (direction === 'down' && idx < found.siblings.length - 1) {
      const next = found.siblings[idx + 1];
      const nextNext = found.siblings[idx + 2];
      movePage.mutate({ id: nodeId, beforeId: next.id, afterId: nextNext?.id });
    }
  }

  /**
   * Drag-and-drop move: turn a drop position into the API's
   * `{parentId, beforeId, afterId}` neighbour pair.
   *
   * `before`/`after` reorder within the TARGET's sibling list — which also
   * re-parents when the target sits at a different depth than the dragged
   * node. That is intended, and it is why `parentId` is always sent
   * explicitly rather than omitted to mean "unchanged".
   *
   * `inside` makes the node the target's last child.
   */
  function handleDropMove(dragId: string, targetId: string, position: DropPosition) {
    if (dragId === targetId) return;
    const onError = (err: unknown) =>
      toast.error(errorMessage(err, 'Could not move the page.'));

    if (position === 'inside') {
      const target = findNode(tree, targetId);
      const lastChild = target?.children.filter((c) => c.id !== dragId).slice(-1)[0];
      movePage.mutate(
        { id: dragId, parentId: targetId, afterId: lastChild?.id },
        { onError },
      );
      return;
    }

    const found = findSiblings(tree, targetId);
    if (!found) return;
    // Neighbours come from the sibling list WITHOUT the dragged node. Computed
    // with it still in place, dragging a node onto its immediate neighbour
    // resolves to "insert between yourself and them" — a no-op move that looks
    // like the drop silently failed.
    const siblings = found.siblings.filter((n) => n.id !== dragId);
    const idx = siblings.findIndex((n) => n.id === targetId);
    if (idx === -1) return;
    const before = position === 'before' ? siblings[idx - 1] : siblings[idx];
    const after = position === 'before' ? siblings[idx] : siblings[idx + 1];

    movePage.mutate(
      { id: dragId, parentId: found.parentId, beforeId: before?.id, afterId: after?.id },
      { onError },
    );
  }

  function handleDelete(nodeId: string) {
    deletePage.mutate(nodeId, {
      onSuccess: () => {
        toast.success('Page deleted.');
        if (nodeId === pageId) {
          navigate(basePath, { replace: true });
        }
      },
      onError: (err) => toast.error(errorMessage(err, 'Could not delete the page.')),
    });
  }

  function handleCreateFromWikiLink(title: string) {
    setCreateModal({ parentId: null, initialTitle: title });
  }

  // Shared Document/Graph segmented control — rendered in the Document
  // toolbar OR handed to `KnowledgeGraphView` for its own full-bleed top bar
  // (see `ViewToggle`'s doc comment; the two call sites are mutually
  // exclusive, so this single element never renders twice at once).
  const viewToggle = (
    <ViewToggle
      isGraphMode={isGraphMode}
      onDocument={async () => {
        const ok = await confirmDiscard();
        if (!ok) return;
        navigate(`${basePath}${pageId ? `/${pageId}` : ''}`);
      }}
      onGraph={async () => {
        const ok = await confirmDiscard();
        if (!ok) return;
        navigate(`${basePath}/graph`);
      }}
    />
  );

  return (
    <div className="flex h-full min-h-0">
      {/* Desktop tree sidebar — Graph mode is a distinct full-bleed surface
          (founder directive: "a distinct full-page feel, better than
          Obsidian"), so the tree/History chrome below is Document-only. */}
      {!isGraphMode && (
        <div
          className="hidden shrink-0 border-r border-ink-200 bg-surface sm:block"
          style={{ width: treeWidth }}
          data-testid="page-tree-panel"
        >
          {treeQuery.isLoading ? (
            <LoadingState label="Loading pages…" />
          ) : treeQuery.isError ? (
            <div className="p-3">
              <ErrorState error={treeQuery.error} onRetry={() => treeQuery.refetch()} />
            </div>
          ) : (
            <PageTree
              tree={tree}
              activePageId={pageId}
              editable={editable}
              onOpen={openPage}
              onCreateRoot={() => setCreateModal({ parentId: null })}
              onCreateChild={(parentId) => {
                const parent = pageOptions.find((p) => p.id === parentId);
                setCreateModal({ parentId, parentTitle: parent?.title });
              }}
              onMoveUp={(id) => handleMove(id, 'up')}
              onMoveDown={(id) => handleMove(id, 'down')}
              onDropMove={handleDropMove}
              onDelete={handleDelete}
            />
          )}
        </div>
      )}
      {/* Desktop only: the mobile tree is a full-height drawer, where a
          resize handle would have nothing to resize. */}
      {!isGraphMode && (
        <div className="hidden sm:flex">
          <ResizeHandle
            width={treeWidth}
            onWidthChange={setTreeWidth}
            min={TREE_WIDTH_MIN}
            max={TREE_WIDTH_MAX}
            label="Resize the page list"
            data-testid="page-tree-resize"
          />
        </div>
      )}

      {/* Mobile tree drawer */}
      {!isGraphMode &&
        mobileTreeOpen &&
        createPortal(
          <MobileTreeDrawer onClose={() => setMobileTreeOpen(false)}>
            <PageTree
              tree={tree}
              activePageId={pageId}
              editable={editable}
              onOpen={openPage}
              onCreateRoot={() => {
                setMobileTreeOpen(false);
                setCreateModal({ parentId: null });
              }}
              onCreateChild={(parentId) => {
                const parent = pageOptions.find((p) => p.id === parentId);
                setMobileTreeOpen(false);
                setCreateModal({ parentId, parentTitle: parent?.title });
              }}
              onMoveUp={(id) => handleMove(id, 'up')}
              onMoveDown={(id) => handleMove(id, 'down')}
              onDropMove={handleDropMove}
              onDelete={handleDelete}
            />
          </MobileTreeDrawer>,
          document.body,
        )}

      {/* Main pane */}
      <div className="flex min-w-0 flex-1 flex-col">
        {isGraphMode ? (
          <KnowledgeGraphView scope={scope} onOpenPage={openPageRef} viewToggle={viewToggle} />
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ink-100 bg-surface px-3 py-2 sm:px-4">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMobileTreeOpen(true)}
                  aria-label="Show page tree"
                  data-testid="page-tree-mobile-toggle"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-ink-200 text-ink-600 hover:bg-ink-50 sm:hidden"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>

                {viewToggle}
              </div>

              {pageQuery.data && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setVersionsOpen(true)}
                  data-testid="page-open-version-history"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
                  </svg>
                  <span className="hidden sm:inline">History</span>
                </Button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {!pageId ? (
                treeQuery.isLoading ? (
                  <LoadingState label="Loading pages…" />
                ) : (
                  <div className="p-6">
                    <EmptyState
                      title={emptyTitle}
                      description={emptyDescription}
                      action={
                        editable ? (
                          <Button size="sm" onClick={() => setCreateModal({ parentId: null })} data-testid="page-create-first">
                            New page
                          </Button>
                        ) : undefined
                      }
                    />
                  </div>
                )
              ) : pageQuery.isLoading ? (
                <LoadingState label="Loading page…" />
              ) : pageQuery.isError || !pageQuery.data ? (
                <div className="p-6">
                  <ErrorState error={pageQuery.error ?? new Error('Page not found')} onRetry={() => pageQuery.refetch()} />
                </div>
              ) : (
                (() => {
                  const page = pageQuery.data;
                  return (
                    // min-h-full (not h-full) so the editor can flex-fill the
                    // pane for full-page editing while long read-mode content
                    // still grows and scrolls naturally.
                    <div className="flex min-h-full flex-col">
                      <PageEditor
                        page={page}
                        titleIndex={titleIndex}
                        pageOptions={pageOptions}
                        editable={editable}
                        saving={updatePage.isPending}
                        onSave={({ title, content }) =>
                          updatePage.mutateAsync({ id: page.id, patch: { title, content } })
                        }
                        onOpenPage={openPage}
                        onCreatePage={handleCreateFromWikiLink}
                        onEditingChange={setEditingPage}
                      />
                      {!editingPage && (
                        <>
                          <BacklinksPanel pageId={page.id} scope={scope} onOpenPage={openPageRef} />
                          <OutgoingLinksPanel pageId={page.id} scope={scope} onOpenPage={openPageRef} />
                          {showLinkedIssues && scope.kind === 'project' && (
                            <PageLinkedIssuesSection pageId={page.id} projectId={scope.id} />
                          )}
                        </>
                      )}
                    </div>
                  );
                })()
              )}
            </div>
          </>
        )}
      </div>

      {versionsOpen && pageQuery.data && (
        <VersionHistoryDrawer
          scope={scope}
          pageId={pageQuery.data.id}
          titleIndex={titleIndex}
          onClose={() => setVersionsOpen(false)}
          onOpenPage={openPage}
        />
      )}

      <CreatePageModal
        open={createModal !== null}
        parentTitle={createModal?.parentTitle}
        initialTitle={createModal?.initialTitle}
        loading={createPage.isPending || createFromTemplate.isPending}
        templates={templatesQuery.data}
        onCreate={handleCreate}
        onClose={() => setCreateModal(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile tree drawer (left slide-over, mirrors MobileSidebarDrawer)
// ---------------------------------------------------------------------------

function MobileTreeDrawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ open: true, onClose, containerRef: panelRef });
  return (
    <div className="fixed inset-0 z-40 flex sm:hidden" role="presentation">
      <div className="fixed inset-0 bg-scrim/35 backdrop-blur-[2px] animate-nl-fade-in" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Page tree"
        data-testid="page-tree-mobile-drawer"
        className="nl-sidebar-drawer-animate relative z-10 flex h-full w-72 max-w-[85vw] flex-col border-r border-ink-200 bg-surface shadow-modal outline-none"
      >
        {children}
      </div>
    </div>
  );
}

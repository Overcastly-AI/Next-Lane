/**
 * PagesPage — the Confluence x Obsidian-hybrid knowledge base: a project-
 * scoped tree of markdown pages with a Document view (tree + editor +
 * backlinks) and a Graph view (the force-directed knowledge graph).
 *
 * Routes (see App.tsx):
 *   /projects/:projectId/pages             — Document view, no page selected
 *                                             (auto-opens the first page, if any)
 *   /projects/:projectId/pages/graph       — Graph view
 *   /projects/:projectId/pages/:pageId     — Document view, that page open
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import type { PageTreeNode } from '@next-lane/shared';
import { useProject } from '@/api/projects';
import { useMyRole } from '@/api/workspaces';
import { useBoardRealtime } from '@/api/socket';
import {
  useCreatePage,
  useDeletePage,
  useMovePage,
  usePage,
  usePageTree,
  useUpdatePage,
} from '@/api/pages';
import { canEdit } from '@/lib/permissions';
import { flattenPageTree, buildTitleIndex } from '@/lib/wikiLinks';
import { errorMessage } from '@/lib/errorMessage';
import { useOverlay } from '@/lib/useOverlay';
import { useUnsavedChangesGuard } from '@/lib/unsavedChangesGuard';
import { AppHeader } from '@/components/AppHeader';
import { ProjectBreadcrumb } from '@/components/project/ProjectBreadcrumb';
import { ProjectNav } from '@/components/project/ProjectNav';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { PageTree } from '@/components/pages/PageTree';
import { PageEditor } from '@/components/pages/PageEditor';
import { BacklinksPanel } from '@/components/pages/BacklinksPanel';
import { PageLinkedIssuesSection } from '@/components/pages/PageLinkedIssuesSection';
import { VersionHistoryDrawer } from '@/components/pages/VersionHistoryDrawer';
import { KnowledgeGraphView } from '@/components/pages/KnowledgeGraphView';
import { CreatePageModal } from '@/components/pages/CreatePageModal';
import { cn } from '@/lib/cn';

/** Find the id of the FIRST page in tree order (depth-first, top-level-first). */
function firstPageId(tree: PageTreeNode[]): string | undefined {
  return tree[0]?.id;
}

interface Siblings {
  siblings: PageTreeNode[];
  parentId: string | null;
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

export function PagesPage() {
  const { projectId = '', pageId } = useParams<{ projectId: string; pageId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  const isGraphMode = pageId === undefined && location.pathname.endsWith('/pages/graph');

  // The page editor registers itself here whenever it has unsaved edits
  // (see `PageEditor.tsx`); every navigation this component itself drives —
  // switching tree pages, toggling Document/Graph — goes through
  // `confirmDiscard()` first so an in-progress edit is never silently lost.
  const { confirmDiscard } = useUnsavedChangesGuard();

  const projectQuery = useProject(projectId);
  const myRole = useMyRole(projectQuery.data?.workspaceId);
  const editable = canEdit(myRole);

  useBoardRealtime(projectId);

  const treeQuery = usePageTree(projectId);
  const pageQuery = usePage(!isGraphMode ? pageId : undefined);

  const createPage = useCreatePage(projectId);
  const updatePage = useUpdatePage(projectId);
  const deletePage = useDeletePage(projectId);
  const movePage = useMovePage(projectId);

  const tree = treeQuery.data ?? [];
  const pageOptions = useMemo(() => flattenPageTree(tree), [tree]);
  const titleIndex = useMemo(() => buildTitleIndex(tree), [tree]);

  // Auto-open the first page when landing on the bare /pages route.
  useEffect(() => {
    if (isGraphMode || pageId || !treeQuery.data) return;
    const first = firstPageId(treeQuery.data);
    if (first) navigate(`/projects/${projectId}/pages/${first}`, { replace: true });
  }, [isGraphMode, pageId, treeQuery.data, projectId, navigate]);

  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  // True while the editor is in edit mode — the backlinks panel is hidden so
  // the editing canvas gets the full page (founder directive: full-page editing).
  const [editingPage, setEditingPage] = useState(false);
  const [createModal, setCreateModal] = useState<{ parentId: string | null; parentTitle?: string; initialTitle?: string } | null>(null);

  async function openPage(id: string) {
    const ok = await confirmDiscard();
    if (!ok) return;
    setMobileTreeOpen(false);
    navigate(`/projects/${projectId}/pages/${id}`);
  }

  function handleCreate(title: string) {
    if (!createModal) return;
    createPage.mutate(
      { title, parentId: createModal.parentId },
      {
        onSuccess: (created) => {
          toast.success('Page created.');
          setCreateModal(null);
          openPage(created.id);
        },
        onError: (err) => toast.error(errorMessage(err, 'Could not create the page.')),
      },
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

  function handleDelete(nodeId: string) {
    deletePage.mutate(nodeId, {
      onSuccess: () => {
        toast.success('Page deleted.');
        if (nodeId === pageId) {
          navigate(`/projects/${projectId}/pages`, { replace: true });
        }
      },
      onError: (err) => toast.error(errorMessage(err, 'Could not delete the page.')),
    });
  }

  function handleCreateFromWikiLink(title: string) {
    setCreateModal({ parentId: null, initialTitle: title });
  }

  const projectName = projectQuery.data?.name;

  return (
    <Shell projectId={projectId} projectName={projectName}>
      <div className="flex h-full min-h-0">
        {/* Desktop tree sidebar */}
        <div className="hidden w-64 shrink-0 border-r border-ink-200 bg-surface sm:block">
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
              onDelete={handleDelete}
            />
          )}
        </div>

        {/* Mobile tree drawer */}
        {mobileTreeOpen &&
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
                onDelete={handleDelete}
              />
            </MobileTreeDrawer>,
            document.body,
          )}

        {/* Main pane */}
        <div className="flex min-w-0 flex-1 flex-col">
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

              <div className="flex items-center gap-1 rounded-md border border-ink-200 bg-ink-50 p-0.5 text-xs font-medium">
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirmDiscard();
                    if (!ok) return;
                    navigate(`/projects/${projectId}/pages${pageId ? `/${pageId}` : ''}`);
                  }}
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
                  onClick={async () => {
                    const ok = await confirmDiscard();
                    if (!ok) return;
                    navigate(`/projects/${projectId}/pages/graph`);
                  }}
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
            </div>

            {!isGraphMode && pageQuery.data && (
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
            {isGraphMode ? (
              <div className="p-3 sm:p-5">
                <KnowledgeGraphView projectId={projectId} onOpenPage={openPage} />
              </div>
            ) : !pageId ? (
              treeQuery.isLoading ? (
                <LoadingState label="Loading pages…" />
              ) : (
                <div className="p-6">
                  <EmptyState
                    title="No pages yet"
                    description="Create your project's first page to start building a knowledge base."
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
                        <BacklinksPanel pageId={page.id} onOpenPage={openPage} />
                        <PageLinkedIssuesSection pageId={page.id} projectId={projectId} />
                      </>
                    )}
                  </div>
                );
              })()
            )}
          </div>
        </div>
      </div>

      {versionsOpen && pageQuery.data && (
        <VersionHistoryDrawer
          projectId={projectId}
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
        loading={createPage.isPending}
        onCreate={handleCreate}
        onClose={() => setCreateModal(null)}
      />
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function Shell({
  children,
  projectId,
  projectName,
}: {
  children: React.ReactNode;
  projectId: string;
  projectName?: string;
}) {
  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader>
        <ProjectBreadcrumb primary={projectName} secondary={[{ label: 'Pages' }]} />
      </AppHeader>
      <ProjectNav projectId={projectId} />
      <main className="min-h-0 flex-1 overflow-hidden bg-surface">{children}</main>
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


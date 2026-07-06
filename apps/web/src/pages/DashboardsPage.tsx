import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { Role, type DashboardGadgetDto, type DashboardGadgetResult, type DashboardSummaryDto } from '@next-lane/shared';
import { useProject } from '@/api/projects';
import { useMyRole } from '@/api/workspaces';
import { useBoardRealtime } from '@/api/socket';
import { canEdit } from '@/lib/permissions';
import { errorMessage } from '@/lib/errorMessage';
import { EditableSafeKeyboardSensor } from '@/lib/dndSensors';
import {
  useDashboards,
  useDashboard,
  useDashboardData,
  useCreateDashboard,
  useUpdateDashboard,
  useDeleteDashboard,
  useDeleteGadget,
  useReorderGadget,
} from '@/api/dashboards';
import { AppHeader } from '@/components/AppHeader';
import { ProjectNav } from '@/components/project/ProjectNav';
import { ProjectBreadcrumb } from '@/components/project/ProjectBreadcrumb';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { ErrorState, LoadingState, EmptyState } from '@/components/ui/States';
import { cn } from '@/lib/cn';
import { GadgetCard } from '@/components/dashboards/GadgetCard';
import { GadgetFormModal } from '@/components/dashboards/GadgetFormModal';
import { DashboardShareModal } from '@/components/dashboards/DashboardShareModal';

/** Sort gadgets by their config-derived grid position (mirrors the server's `sortGadgets`). */
function byPosition(a: DashboardGadgetDto, b: DashboardGadgetDto): number {
  return (a.config.position ?? 0) - (b.config.position ?? 0);
}

/**
 * Sortable wrapper around `GadgetCard` — owns the `useSortable` hook and
 * hands the drag handle's attributes/listeners down as props, mirroring the
 * `SortablePersonalCard` pattern (`PersonalBoardPage.tsx`): only a dedicated
 * grab handle activates the drag, so the card's Edit/Delete buttons and the
 * gadget's own content stay clickable.
 */
function SortableGadgetCard({
  gadget,
  result,
  loading,
  editable,
  onEdit,
  onDelete,
}: {
  gadget: DashboardGadgetDto;
  result: DashboardGadgetResult | undefined;
  loading: boolean;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: gadget.id,
    disabled: !editable,
  });

  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={cn((gadget.config.size ?? 1) >= 2 && 'sm:col-span-2')}>
      <GadgetCard
        gadget={gadget}
        result={result}
        loading={loading}
        editable={editable}
        onEdit={onEdit}
        onDelete={onDelete}
        dragHandle={editable ? { attributes, listeners } : undefined}
        isDragging={isDragging}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// New dashboard modal
// ---------------------------------------------------------------------------

function NewDashboardModal({
  open,
  onClose,
  projectId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onCreated: (dashboard: DashboardSummaryDto) => void;
}) {
  const toast = useToast();
  const createDashboard = useCreateDashboard(projectId);
  const [name, setName] = useState('');

  useEffect(() => {
    if (open) setName('');
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createDashboard.mutate(trimmed, {
      onSuccess: (dashboard) => {
        toast.success(`Dashboard "${dashboard.name}" created.`);
        onCreated(dashboard);
        onClose();
      },
      onError: (err) => toast.error(errorMessage(err, 'Could not create dashboard.')),
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New dashboard"
      size="max-w-sm"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-dashboard-form"
            loading={createDashboard.isPending}
            disabled={!name.trim()}
          >
            Create
          </Button>
        </>
      }
    >
      <form id="create-dashboard-form" onSubmit={handleSubmit}>
        <label htmlFor="dashboard-name" className="mb-1 block text-xs font-semibold text-ink-500">
          Name
        </label>
        <Input
          id="dashboard-name"
          data-testid="dashboard-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Team overview"
          maxLength={80}
          autoFocus
        />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function DashboardsPage() {
  const { projectId = '' } = useParams();
  const toast = useToast();
  const projectQuery = useProject(projectId);
  const myRole = useMyRole(projectQuery.data?.workspaceId);
  const editable = canEdit(myRole);
  // Minting/revoking a public dashboard share link is ADMIN-only, mirroring
  // the project-board ShareSection's gate — the server enforces this too
  // (assertProjectRole ADMIN), this only controls whether the button shows.
  const isAdmin = myRole === Role.ADMIN;

  const dashboardsQuery = useDashboards(projectId);
  const dashboards = dashboardsQuery.data ?? [];

  // Live-refresh this page: issue.* events (dashboard gadget data depends on
  // the project's issues) and dashboard.updated (metadata/gadget CRUD from
  // another tab/teammate) are both handled centrally in useBoardRealtime —
  // subscribing here is what actually turns that on for this page.
  useBoardRealtime(projectId);

  // ── Selection — URL as single source of truth ────────────────────────────
  //
  // The active dashboard lives in the `?dashboard=<id>` search param (not
  // local React state) so reload, deep-link, and share all land on the same
  // dashboard the user was looking at — mirrors BoardPage's URL-as-source-
  // of-truth filter pattern. `replace: true` is used for the "pick a
  // sensible default" effects below so they don't spam browser history;
  // `replace: false` is used for user-initiated tab clicks / creation so the
  // back button can step through dashboard switches.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('dashboard') ?? undefined;

  function selectDashboard(id: string | undefined, opts: { replace?: boolean } = {}) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set('dashboard', id);
        else next.delete('dashboard');
        return next;
      },
      { replace: opts.replace ?? false },
    );
  }

  // Default to the first dashboard when none is selected yet, and reset
  // selection if the currently-selected dashboard doesn't exist (deleted,
  // stale deep link, or a bad id typed into the URL) — but only once the
  // list has actually loaded, so an in-flight fetch doesn't momentarily look
  // like "not found" and bounce a valid deep-linked id back to dashboard #1.
  useEffect(() => {
    if (dashboardsQuery.isLoading) return;
    if (dashboards.length === 0) {
      if (selectedId) selectDashboard(undefined, { replace: true });
      return;
    }
    if (!selectedId || !dashboards.some((d) => d.id === selectedId)) {
      selectDashboard(dashboards[0].id, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboards, selectedId, dashboardsQuery.isLoading]);

  const dashboardQuery = useDashboard(selectedId);
  const dataQuery = useDashboardData(selectedId);
  const updateDashboard = useUpdateDashboard(projectId);
  const deleteDashboard = useDeleteDashboard(projectId);
  const deleteGadget = useDeleteGadget(selectedId ?? '', projectId);
  const reorderGadget = useReorderGadget(selectedId ?? '');

  const [newDashboardOpen, setNewDashboardOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [gadgetModalOpen, setGadgetModalOpen] = useState(false);
  const [editingGadget, setEditingGadget] = useState<DashboardGadgetDto | undefined>(undefined);
  const [deletingGadgetId, setDeletingGadgetId] = useState<string | undefined>(undefined);
  const [deletingDashboard, setDeletingDashboard] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  // Sort client-side too (not just trust the server's order) so an
  // optimistic drag reorder — which only patches the moved gadget's
  // `config.position` in the cache, not the array order — repaints
  // immediately instead of snapping back until the refetch lands.
  const gadgets = [...(dashboardQuery.data?.gadgets ?? [])].sort(byPosition);
  const activeDashboard = dashboards.find((d) => d.id === selectedId);

  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(EditableSafeKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleGadgetDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = gadgets.findIndex((g) => g.id === active.id);
    const newIndex = gadgets.findIndex((g) => g.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Fractional-midpoint reorder: compute the dragged gadget's new
    // `config.position` from its neighbors AFTER the move, then PATCH only
    // that ONE gadget — never renumber the rest of the list.
    const reordered = arrayMove(gadgets, oldIndex, newIndex);
    const draggedIdx = reordered.findIndex((g) => g.id === active.id);
    const prevPos = reordered[draggedIdx - 1]?.config.position ?? null;
    const nextPos = reordered[draggedIdx + 1]?.config.position ?? null;
    const newPosition =
      prevPos === null && nextPos === null
        ? 0
        : prevPos === null
          ? nextPos! - 1
          : nextPos === null
            ? prevPos + 1
            : (prevPos + nextPos) / 2;

    reorderGadget.mutate(
      { gadgetId: String(active.id), position: newPosition },
      { onError: (err) => toast.error(errorMessage(err, 'Could not reorder gadgets.')) },
    );
  }

  function openCreateGadget() {
    setEditingGadget(undefined);
    setGadgetModalOpen(true);
  }

  function openEditGadget(g: DashboardGadgetDto) {
    setEditingGadget(g);
    setGadgetModalOpen(true);
  }

  async function confirmDeleteGadget() {
    if (!deletingGadgetId) return;
    try {
      await deleteGadget.mutateAsync(deletingGadgetId);
      toast.success('Gadget deleted.');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete gadget.'));
    } finally {
      setDeletingGadgetId(undefined);
    }
  }

  async function confirmDeleteDashboard() {
    if (!selectedId) return;
    try {
      await deleteDashboard.mutateAsync(selectedId);
      toast.success('Dashboard deleted.');
      selectDashboard(undefined, { replace: true });
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete dashboard.'));
    } finally {
      setDeletingDashboard(false);
    }
  }

  function startRename() {
    setRenameValue(activeDashboard?.name ?? '');
    setRenaming(true);
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !renameValue.trim()) return;
    try {
      await updateDashboard.mutateAsync({ dashboardId: selectedId, patch: { name: renameValue.trim() } });
      setRenaming(false);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not rename dashboard.'));
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader>
        <ProjectBreadcrumb primary={projectQuery.data?.name} />
      </AppHeader>
      <ProjectNav projectId={projectId} />
      <main className="flex-1 overflow-y-auto bg-ink-50" data-testid="dashboard-page">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-ink-900">Dashboards</h1>
              <p className="text-sm text-ink-500">
                Build custom views from the same query language that powers boards and filters.
              </p>
            </div>
          </div>

          {dashboardsQuery.isLoading ? (
            <LoadingState label="Loading dashboards…" />
          ) : dashboardsQuery.isError ? (
            <ErrorState error={dashboardsQuery.error} onRetry={() => dashboardsQuery.refetch()} />
          ) : dashboards.length === 0 ? (
            <EmptyState
              title="No dashboards yet"
              description="Create a dashboard and add gadgets — each one is just an NLQL query and a chart type."
              action={
                editable ? (
                  <Button data-testid="dashboard-create" onClick={() => setNewDashboardOpen(true)}>
                    New dashboard
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {/* Dashboard tabs */}
              <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-200 pb-2">
                {dashboards.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    data-testid="dashboard-tab"
                    aria-current={d.id === selectedId ? 'page' : undefined}
                    onClick={() => selectDashboard(d.id)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-[120ms]',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-300',
                      d.id === selectedId
                        ? 'bg-signal-50 text-signal-700'
                        : 'text-ink-500 hover:bg-ink-100 hover:text-ink-800',
                    )}
                  >
                    {d.name}
                  </button>
                ))}
                {editable && (
                  <button
                    type="button"
                    data-testid="dashboard-create"
                    onClick={() => setNewDashboardOpen(true)}
                    className="rounded-md px-2.5 py-1.5 text-sm font-medium text-signal-600 transition-colors duration-[120ms] hover:bg-signal-50"
                  >
                    + New
                  </button>
                )}
              </div>

              {/* Active dashboard toolbar */}
              {activeDashboard && (
                <div className="flex items-center justify-between gap-2">
                  {renaming ? (
                    <form onSubmit={(e) => void handleRename(e)} className="flex items-center gap-2">
                      <Input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => setRenaming(false)}
                        className="h-8 w-56"
                        maxLength={80}
                      />
                    </form>
                  ) : (
                    <div className="flex items-center gap-2">
                      {editable ? (
                        <button
                          type="button"
                          onClick={startRename}
                          className="text-sm font-semibold text-ink-800 hover:text-signal-700"
                        >
                          {activeDashboard.name}
                        </button>
                      ) : (
                        <span className="text-sm font-semibold text-ink-800">{activeDashboard.name}</span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="secondary"
                        data-testid="dashboard-share"
                        onClick={() => setShareModalOpen(true)}
                      >
                        Share
                      </Button>
                    )}
                    {editable && (
                      <>
                        <Button size="sm" data-testid="gadget-add" onClick={openCreateGadget}>
                          + Add gadget
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid="dashboard-delete"
                          onClick={() => setDeletingDashboard(true)}
                        >
                          Delete dashboard
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Gadget grid */}
              {dashboardQuery.isLoading ? (
                <LoadingState label="Loading dashboard…" />
              ) : dashboardQuery.isError ? (
                <ErrorState error={dashboardQuery.error} onRetry={() => dashboardQuery.refetch()} />
              ) : gadgets.length === 0 ? (
                <EmptyState
                  title="No gadgets yet"
                  description="Add a gadget — pick an NLQL query and how to visualize it."
                  action={
                    editable ? (
                      <Button onClick={openCreateGadget}>+ Add gadget</Button>
                    ) : undefined
                  }
                />
              ) : (
                <DndContext
                  sensors={dragSensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleGadgetDragEnd}
                >
                  <SortableContext items={gadgets.map((g) => g.id)} strategy={rectSortingStrategy}>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {gadgets.map((g) => (
                        <SortableGadgetCard
                          key={g.id}
                          gadget={g}
                          result={dataQuery.data?.gadgets.find((r) => r.gadgetId === g.id)}
                          loading={dataQuery.isLoading}
                          editable={editable}
                          onEdit={() => openEditGadget(g)}
                          onDelete={() => setDeletingGadgetId(g.id)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
              {dataQuery.data?.issuesTruncated && (
                <p className="text-xs text-ink-400">
                  This project has more issues than the dashboard evaluates at once — results may be partial.
                </p>
              )}
            </>
          )}
        </div>
      </main>

      <NewDashboardModal
        open={newDashboardOpen}
        onClose={() => setNewDashboardOpen(false)}
        projectId={projectId}
        onCreated={(d) => selectDashboard(d.id)}
      />

      {selectedId && (
        <GadgetFormModal
          open={gadgetModalOpen}
          onClose={() => setGadgetModalOpen(false)}
          projectId={projectId}
          dashboardId={selectedId}
          gadget={editingGadget}
        />
      )}

      {isAdmin && (
        <DashboardShareModal
          open={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
          dashboardId={selectedId}
          dashboardName={activeDashboard?.name ?? ''}
        />
      )}

      <ConfirmDialog
        open={!!deletingGadgetId}
        title="Delete gadget?"
        message="This removes the gadget from the dashboard. This can't be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteGadget.isPending}
        onConfirm={() => void confirmDeleteGadget()}
        onCancel={() => setDeletingGadgetId(undefined)}
      />

      <ConfirmDialog
        open={deletingDashboard}
        title="Delete dashboard?"
        message={`This deletes "${activeDashboard?.name ?? ''}" and all of its gadgets. This can't be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteDashboard.isPending}
        onConfirm={() => void confirmDeleteDashboard()}
        onCancel={() => setDeletingDashboard(false)}
      />
    </div>
  );
}

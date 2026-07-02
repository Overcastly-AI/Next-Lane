import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { DashboardGadgetDto, DashboardSummaryDto } from '@next-lane/shared';
import { useProject } from '@/api/projects';
import { useMyRole } from '@/api/workspaces';
import { canEdit } from '@/lib/permissions';
import { errorMessage } from '@/lib/errorMessage';
import {
  useDashboards,
  useDashboard,
  useDashboardData,
  useCreateDashboard,
  useUpdateDashboard,
  useDeleteDashboard,
  useDeleteGadget,
  useUpdateGadget,
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

  const dashboardsQuery = useDashboards(projectId);
  const dashboards = dashboardsQuery.data ?? [];

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (selectedId || dashboards.length === 0) return;
    setSelectedId(dashboards[0].id);
  }, [dashboards, selectedId]);
  // Reset selection if the currently-selected dashboard was deleted.
  useEffect(() => {
    if (selectedId && dashboards.length > 0 && !dashboards.some((d) => d.id === selectedId)) {
      setSelectedId(dashboards[0].id);
    }
  }, [dashboards, selectedId]);

  const dashboardQuery = useDashboard(selectedId);
  const dataQuery = useDashboardData(selectedId);
  const updateDashboard = useUpdateDashboard(projectId);
  const deleteDashboard = useDeleteDashboard(projectId);
  const deleteGadget = useDeleteGadget(selectedId ?? '', projectId);
  const updateGadget = useUpdateGadget(selectedId ?? '');

  const [newDashboardOpen, setNewDashboardOpen] = useState(false);
  const [gadgetModalOpen, setGadgetModalOpen] = useState(false);
  const [editingGadget, setEditingGadget] = useState<DashboardGadgetDto | undefined>(undefined);
  const [deletingGadgetId, setDeletingGadgetId] = useState<string | undefined>(undefined);
  const [deletingDashboard, setDeletingDashboard] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const gadgets = dashboardQuery.data?.gadgets ?? [];
  const activeDashboard = dashboards.find((d) => d.id === selectedId);

  function openCreateGadget() {
    setEditingGadget(undefined);
    setGadgetModalOpen(true);
  }

  function openEditGadget(g: DashboardGadgetDto) {
    setEditingGadget(g);
    setGadgetModalOpen(true);
  }

  async function handleMoveGadget(index: number, direction: -1 | 1) {
    const target = gadgets[index + direction];
    const current = gadgets[index];
    if (!target || !current) return;
    const currentPos = current.config.position ?? index;
    const targetPos = target.config.position ?? index + direction;
    try {
      await Promise.all([
        updateGadget.mutateAsync({
          gadgetId: current.id,
          patch: { config: { ...current.config, position: targetPos } },
        }),
        updateGadget.mutateAsync({
          gadgetId: target.id,
          patch: { config: { ...target.config, position: currentPos } },
        }),
      ]);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not reorder gadgets.'));
    }
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
      setSelectedId(undefined);
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
                    onClick={() => setSelectedId(d.id)}
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
                  {editable && (
                    <div className="flex items-center gap-2">
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
                    </div>
                  )}
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
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {gadgets.map((g, i) => (
                    <GadgetCard
                      key={g.id}
                      gadget={g}
                      result={dataQuery.data?.gadgets.find((r) => r.gadgetId === g.id)}
                      loading={dataQuery.isLoading}
                      editable={editable}
                      isFirst={i === 0}
                      isLast={i === gadgets.length - 1}
                      onEdit={() => openEditGadget(g)}
                      onDelete={() => setDeletingGadgetId(g.id)}
                      onMoveUp={() => void handleMoveGadget(i, -1)}
                      onMoveDown={() => void handleMoveGadget(i, 1)}
                    />
                  ))}
                </div>
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
        onCreated={(d) => setSelectedId(d.id)}
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

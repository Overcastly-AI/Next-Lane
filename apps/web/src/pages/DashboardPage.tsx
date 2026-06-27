import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorkspaceDto } from '@next-lane/shared';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { ErrorState, LoadingState } from '@/components/ui/States';
import {
  useCreateWorkspace,
  useWorkspaces,
} from '@/api/workspaces';
import { useProjects } from '@/api/projects';
import { CreateProjectModal } from '@/components/project/CreateProjectModal';
import { CreateWorkspaceModal } from '@/components/workspace/CreateWorkspaceModal';
import { ProjectCard } from '@/components/project/ProjectCard';
import { OnboardingPanel } from '@/components/project/OnboardingPanel';

export function DashboardPage() {
  const navigate = useNavigate();
  const workspacesQuery = useWorkspaces();
  const createWorkspace = useCreateWorkspace();
  const [selectedWs, setSelectedWs] = useState<string | null>(null);
  const [creatingDefault, setCreatingDefault] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);

  const workspaces = workspacesQuery.data;

  // Auto-create a default workspace the first time a user has none.
  useEffect(() => {
    if (
      workspacesQuery.isSuccess &&
      workspaces &&
      workspaces.length === 0 &&
      !creatingDefault &&
      !createWorkspace.isPending
    ) {
      setCreatingDefault(true);
      createWorkspace
        .mutateAsync({ name: 'My Workspace' })
        .catch(() => undefined)
        .finally(() => setCreatingDefault(false));
    }
  }, [
    workspacesQuery.isSuccess,
    workspaces,
    creatingDefault,
    createWorkspace,
  ]);

  // Keep a valid selection as workspaces load/change.
  useEffect(() => {
    if (!workspaces || workspaces.length === 0) return;
    if (!selectedWs || !workspaces.some((w) => w.id === selectedWs)) {
      setSelectedWs(workspaces[0].id);
    }
  }, [workspaces, selectedWs]);

  const activeWorkspace = useMemo<WorkspaceDto | undefined>(
    () => workspaces?.find((w) => w.id === selectedWs),
    [workspaces, selectedWs],
  );

  const projectsQuery = useProjects(activeWorkspace?.id);

  if (workspacesQuery.isLoading) {
    return (
      <Shell>
        <LoadingState label="Loading workspaces…" />
      </Shell>
    );
  }

  if (workspacesQuery.isError) {
    return (
      <Shell>
        <ErrorState
          error={workspacesQuery.error}
          onRetry={() => workspacesQuery.refetch()}
        />
      </Shell>
    );
  }

  if ((workspaces?.length ?? 0) === 0) {
    return (
      <Shell>
        <LoadingState label="Setting up your workspace…" />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500">
            Workspace
          </label>
          <div className="flex items-center gap-2">
            <Select
              value={selectedWs ?? ''}
              onChange={(e) => setSelectedWs(e.target.value)}
              className="w-56"
            >
              {workspaces?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setWorkspaceModalOpen(true)}
            >
              + Workspace
            </Button>
          </div>
        </div>
        <Button onClick={() => setProjectModalOpen(true)}>+ New Project</Button>
      </div>

      <ProjectsGrid
        loading={projectsQuery.isLoading}
        error={projectsQuery.isError ? projectsQuery.error : null}
        onRetry={() => projectsQuery.refetch()}
        onCreate={() => setProjectModalOpen(true)}
        onOpen={(id) => navigate(`/projects/${id}/board`)}
        projects={projectsQuery.data ?? []}
      />

      {activeWorkspace && (
        <CreateProjectModal
          open={projectModalOpen}
          onClose={() => setProjectModalOpen(false)}
          workspaceId={activeWorkspace.id}
          onCreated={(p) => {
            setProjectModalOpen(false);
            navigate(`/projects/${p.id}/board`);
          }}
        />
      )}

      <CreateWorkspaceModal
        open={workspaceModalOpen}
        onClose={() => setWorkspaceModalOpen(false)}
        onCreated={(ws) => {
          setWorkspaceModalOpen(false);
          setSelectedWs(ws.id);
        }}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}

function ProjectsGrid({
  loading,
  error,
  onRetry,
  onCreate,
  onOpen,
  projects,
}: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onCreate: () => void;
  onOpen: (id: string) => void;
  projects: import('@next-lane/shared').ProjectDto[];
}) {
  if (loading) return <LoadingState label="Loading projects…" />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (projects.length === 0) {
    return <OnboardingPanel onCreate={onCreate} />;
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => (
        <ProjectCard key={p.id} project={p} onClick={() => onOpen(p.id)} />
      ))}
    </div>
  );
}


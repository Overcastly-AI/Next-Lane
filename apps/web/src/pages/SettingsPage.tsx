import { useMemo } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { Role, type StatusDto } from '@next-lane/shared';
import { useProject } from '@/api/projects';
import { useStatuses } from '@/api/meta';
import { useMyRole, useWorkspaceMembers } from '@/api/workspaces';
import { useBoardRealtime } from '@/api/socket';
import { canEdit } from '@/lib/permissions';
import { AppHeader } from '@/components/AppHeader';
import { ProjectBreadcrumb } from '@/components/project/ProjectBreadcrumb';
import { ProjectNav } from '@/components/project/ProjectNav';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { SettingsLayout } from '@/components/settings/SettingsLayout';
import { PROJECT_SETTINGS_GROUPS } from '@/components/settings/settingsGroups';
import type { ProjectSettingsContext } from './settings/projectSettingsContext';

/**
 * Project settings: the configuration home for a project, split into six
 * grouped routes behind the shared `SettingsLayout` (General / People / Work
 * structure / Templates / Integrations / Agents). This page fetches
 * everything a group page could need exactly once — project, role, statuses,
 * workspace members — and hands it down through an outlet context, so
 * switching groups via the rail is a route change, not a refetch.
 */
export function SettingsPage() {
  const { projectId = '' } = useParams();
  const projectQuery = useProject(projectId);
  const project = projectQuery.data;
  const myRole = useMyRole(project?.workspaceId);
  const editable = canEdit(myRole);
  const isAdmin = myRole === Role.ADMIN;

  // Workspace members for the ComponentsSection default-assignee picker.
  const membersQuery = useWorkspaceMembers(project?.workspaceId);
  const workspaceUsers = (membersQuery.data ?? []).map((m) => m.user);

  // Live-refresh the agent-context doc + its staleness signal (someone else's
  // save, or any issue/audit activity that moves the "changes since" count).
  useBoardRealtime(projectId);

  // Statuses needed by WorkflowSection (shared with ColumnsSection internally).
  const statusesQuery = useStatuses(projectId);
  const statusesForWorkflow: StatusDto[] = useMemo(
    () =>
      statusesQuery.data
        ? [...statusesQuery.data].sort((a, b) => a.order - b.order)
        : [],
    [statusesQuery.data],
  );

  if (projectQuery.isLoading) {
    return (
      <Shell projectId={projectId} projectName={undefined}>
        <LoadingState label="Loading settings…" />
      </Shell>
    );
  }
  if (projectQuery.isError || !project) {
    return (
      <Shell projectId={projectId} projectName={undefined}>
        <ErrorState
          error={projectQuery.error ?? new Error('Project not found')}
          onRetry={() => projectQuery.refetch()}
        />
      </Shell>
    );
  }

  const context: ProjectSettingsContext = {
    projectId,
    project,
    myRole,
    editable,
    isAdmin,
    statuses: statusesForWorkflow,
    workspaceUsers,
  };

  return (
    <Shell projectId={projectId} projectName={project.name}>
      <SettingsLayout
        groups={PROJECT_SETTINGS_GROUPS}
        basePath={`/projects/${projectId}/settings`}
        title="Settings"
        description="Configure this project."
      >
        {!editable && (
          <span
            data-testid="readonly-hint"
            className="inline-flex w-fit shrink-0 items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500"
            title="You have view-only access to this workspace."
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            View only
          </span>
        )}
        <Outlet context={context satisfies ProjectSettingsContext} />
      </SettingsLayout>
    </Shell>
  );
}

function Shell({
  children,
  projectId,
  projectName,
}: {
  children: React.ReactNode;
  projectId: string;
  projectName: string | undefined;
}) {
  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader>
        <ProjectBreadcrumb primary={projectName} />
      </AppHeader>
      <ProjectNav projectId={projectId} />
      <main className="flex flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}

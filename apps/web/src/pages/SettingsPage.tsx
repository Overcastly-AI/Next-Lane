import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Role, type StatusDto } from '@next-lane/shared';
import { useProject } from '@/api/projects';
import { useStatuses } from '@/api/meta';
import { useMyRole, useWorkspaceMembers } from '@/api/workspaces';
import { useBoardRealtime } from '@/api/socket';
import { canEdit } from '@/lib/permissions';
import { AppHeader } from '@/components/AppHeader';
import { ProjectBreadcrumb } from '@/components/project/ProjectBreadcrumb';
import { ProjectNav } from '@/components/project/ProjectNav';
import { ProjectDetailsSection } from '@/components/settings/ProjectDetailsSection';
import { ColumnsSection } from '@/components/settings/ColumnsSection';
import { LabelsSection } from '@/components/settings/LabelsSection';
import { ProjectDangerZone } from '@/components/settings/ProjectDangerZone';
import { WebhooksSection } from '@/components/settings/WebhooksSection';
import { GithubSection } from '@/components/settings/GithubSection';
import { GitlabSection } from '@/components/settings/GitlabSection';
import { GiteaSection } from '@/components/settings/GiteaSection';
import { AgentContextSection } from '@/components/settings/AgentContextSection';
import { AgentAccessSection } from '@/components/settings/AgentAccessSection';
import { ShareSection } from '@/components/settings/ShareSection';
import { CustomFieldsSection } from '@/components/settings/CustomFieldsSection';
import { ComponentsSection } from '@/components/settings/ComponentsSection';
import { MembersSection } from '@/components/settings/MembersSection';
import { TemplatesManager } from '@/components/settings/TemplatesManager';
import { PageTemplatesSection } from '@/components/settings/PageTemplatesSection';
import { VersionsSection } from '@/components/settings/VersionsSection';
import { WorkflowSection } from '@/components/settings/WorkflowSection';
import { WorkflowsManager } from '@/components/settings/WorkflowsManager';
import { ErrorState, LoadingState } from '@/components/ui/States';

/**
 * Project settings: the configuration home for a project. Owns column (status)
 * management (moved off the board), the project's label set, project details
 * (name/description, with the immutable key shown read-only), and archiving.
 * The whole page is editable by ADMIN/MEMBER and read-only for VIEWER; the
 * destructive actions (archive, delete column/label) are restricted to ADMIN.
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

  return (
    <Shell projectId={projectId} projectName={project.name}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Settings</h1>
            <p className="text-sm text-slate-500">
              Configure columns, labels, and details for this project.
            </p>
          </div>
          {!editable && (
            <span
              data-testid="readonly-hint"
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500"
              title="You have view-only access to this workspace."
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              View only
            </span>
          )}
        </div>

        <ProjectDetailsSection
          projectId={projectId}
          projectKey={project.key}
          name={project.name}
          description={project.description}
          editable={editable}
        />

        <MembersSection projectId={projectId} />

        <ColumnsSection projectId={projectId} editable={editable} isAdmin={isAdmin} />

        <LabelsSection projectId={projectId} editable={editable} isAdmin={isAdmin} />

        <ComponentsSection
          projectId={projectId}
          editable={editable}
          isAdmin={isAdmin}
          users={workspaceUsers}
        />

        <TemplatesManager
          projectId={projectId}
          isAdmin={isAdmin}
          users={workspaceUsers}
        />

        {/* Doc templates owned by THIS project. Workspace-wide ones are
            managed in workspace settings but still appear in this project's
            page-creation picker. */}
        <PageTemplatesSection
          scope={{ kind: 'project', id: projectId }}
          canManage={isAdmin}
        />

        <VersionsSection
          projectId={projectId}
          isAdmin={isAdmin}
        />

        <CustomFieldsSection projectId={projectId} editable={editable} isAdmin={isAdmin} />

        <WorkflowSection
          projectId={projectId}
          statuses={statusesForWorkflow}
          isAdmin={isAdmin}
        />

        <WorkflowsManager
          projectId={projectId}
          statuses={statusesForWorkflow}
          isAdmin={isAdmin}
        />

        <WebhooksSection projectId={projectId} isAdmin={isAdmin} />

        <GithubSection projectId={projectId} isAdmin={isAdmin} statuses={statusesForWorkflow} />

        <GitlabSection projectId={projectId} isAdmin={isAdmin} statuses={statusesForWorkflow} />

        <GiteaSection projectId={projectId} isAdmin={isAdmin} />

        <AgentContextSection projectId={projectId} myRole={myRole} />

        <AgentAccessSection projectId={projectId} myRole={myRole} />

        {isAdmin && <ShareSection projectId={projectId} />}

        {editable && (
          <ProjectDangerZone
            projectId={projectId}
            projectName={project.name}
            archived={project.archived}
            isAdmin={isAdmin}
          />
        )}
      </div>
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

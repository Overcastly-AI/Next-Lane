import { TemplatesManager } from '@/components/settings/TemplatesManager';
import { PageTemplatesSection } from '@/components/settings/PageTemplatesSection';
import { useProjectSettings } from './projectSettingsContext';

/** Templates group: starting points for new issues and pages. */
export function ProjectSettingsTemplates() {
  const { projectId, isAdmin, workspaceUsers } = useProjectSettings();

  return (
    <div className="flex flex-col gap-6">
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
    </div>
  );
}

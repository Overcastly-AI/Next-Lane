import { ColumnsSection } from '@/components/settings/ColumnsSection';
import { LabelsSection } from '@/components/settings/LabelsSection';
import { ComponentsSection } from '@/components/settings/ComponentsSection';
import { VersionsSection } from '@/components/settings/VersionsSection';
import { CustomFieldsSection } from '@/components/settings/CustomFieldsSection';
import { WorkflowSection } from '@/components/settings/WorkflowSection';
import { WorkflowsManager } from '@/components/settings/WorkflowsManager';
import { useProjectSettings } from './projectSettingsContext';

/**
 * Work structure group: columns, labels, components, versions, custom
 * fields and workflow(s) — everything that shapes how issues move through
 * this project.
 */
export function ProjectSettingsWork() {
  const { projectId, editable, isAdmin, statuses, workspaceUsers } =
    useProjectSettings();

  return (
    <div className="flex flex-col gap-6">
      <ColumnsSection projectId={projectId} editable={editable} isAdmin={isAdmin} />

      <LabelsSection projectId={projectId} editable={editable} isAdmin={isAdmin} />

      <ComponentsSection
        projectId={projectId}
        editable={editable}
        isAdmin={isAdmin}
        users={workspaceUsers}
      />

      <VersionsSection projectId={projectId} isAdmin={isAdmin} />

      <CustomFieldsSection projectId={projectId} editable={editable} isAdmin={isAdmin} />

      <WorkflowSection projectId={projectId} statuses={statuses} isAdmin={isAdmin} />

      <WorkflowsManager projectId={projectId} statuses={statuses} isAdmin={isAdmin} />
    </div>
  );
}

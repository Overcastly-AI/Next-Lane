import { ProjectDetailsSection } from '@/components/settings/ProjectDetailsSection';
import { ShareSection } from '@/components/settings/ShareSection';
import { ProjectDangerZone } from '@/components/settings/ProjectDangerZone';
import { useProjectSettings } from './projectSettingsContext';

/** General group: name/description, sharing (admin) and archiving. */
export function ProjectSettingsGeneral() {
  const { projectId, project, editable, isAdmin } = useProjectSettings();

  return (
    <div className="flex flex-col gap-6">
      <ProjectDetailsSection
        projectId={projectId}
        projectKey={project.key}
        name={project.name}
        description={project.description}
        editable={editable}
      />

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
  );
}

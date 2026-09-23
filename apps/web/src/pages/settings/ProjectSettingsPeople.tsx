import { MembersSection } from '@/components/settings/MembersSection';
import { useProjectSettings } from './projectSettingsContext';

/** People group: who can see and change this project. */
export function ProjectSettingsPeople() {
  const { projectId } = useProjectSettings();

  return (
    <div className="flex flex-col gap-6">
      <MembersSection projectId={projectId} />
    </div>
  );
}

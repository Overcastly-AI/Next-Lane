import { AgentContextSection } from '@/components/settings/AgentContextSection';
import { AgentAccessSection } from '@/components/settings/AgentAccessSection';
import { useProjectSettings } from './projectSettingsContext';

/**
 * Agents group: what AI agents can read and change here.
 *
 * Scaffolding — PR #103 promotes Agent context and Agent access to a
 * top-level project tab, at which point this group and its route go with
 * them. See `docs/superpowers/specs/2026-09-23-settings-ia-redesign-design.md`
 * ("Dependency on PR #103").
 */
export function ProjectSettingsAgents() {
  const { projectId, myRole } = useProjectSettings();

  return (
    <div className="flex flex-col gap-6">
      <AgentContextSection projectId={projectId} myRole={myRole} />

      <AgentAccessSection projectId={projectId} myRole={myRole} />
    </div>
  );
}

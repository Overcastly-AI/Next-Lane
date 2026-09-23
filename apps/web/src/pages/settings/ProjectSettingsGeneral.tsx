import { Link } from 'react-router-dom';
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

      {/*
       * Agent access and agent context are NOT a settings group — they live
       * on the project's Agents tab, because a structural differentiator
       * buried under the Gitea form is, to a new user, invisible.
       *
       * The pointer sits on General specifically: `/projects/:id/settings`
       * redirects here, so anyone who still reaches for Settings out of
       * habit lands on the one group that tells them where the pair went.
       */}
      <Link
        to={`/projects/${projectId}/agents`}
        data-testid="settings-agents-pointer"
        className="flex items-center justify-between gap-3 rounded-xl border border-ink-200 bg-surface px-4 py-3 text-sm shadow-card transition-colors duration-[120ms] hover:border-signal-300 hover:bg-signal-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-300 focus-visible:ring-offset-1"
      >
        <span className="font-medium text-ink-800">
          Looking for agent access or agent context? They live in{' '}
          <span className="font-semibold text-signal-700">Agents</span> now.
        </span>
        <span aria-hidden="true" className="text-signal-600">→</span>
      </Link>

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

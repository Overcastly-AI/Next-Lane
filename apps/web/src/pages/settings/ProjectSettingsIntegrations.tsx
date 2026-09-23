import { GithubSection } from '@/components/settings/GithubSection';
import { GitlabSection } from '@/components/settings/GitlabSection';
import { GiteaSection } from '@/components/settings/GiteaSection';
import { WebhooksSection } from '@/components/settings/WebhooksSection';
import { useProjectSettings } from './projectSettingsContext';

/** Integrations group: GitHub, GitLab, Gitea and outgoing webhooks. */
export function ProjectSettingsIntegrations() {
  const { projectId, isAdmin, statuses } = useProjectSettings();

  return (
    <div className="flex flex-col gap-6">
      <GithubSection projectId={projectId} isAdmin={isAdmin} statuses={statuses} />

      <GitlabSection projectId={projectId} isAdmin={isAdmin} statuses={statuses} />

      <GiteaSection projectId={projectId} isAdmin={isAdmin} />

      <WebhooksSection projectId={projectId} isAdmin={isAdmin} />
    </div>
  );
}

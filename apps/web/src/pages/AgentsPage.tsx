/**
 * AgentsPage — the project's agent-native surface, as a top-level destination.
 *
 * Product-audit finding (docs/AUDIT-PRODUCT.md, Pass 14): Next Lane is
 * genuinely agent-native — a first-party MCP server that reads AND writes, a
 * real memory protocol (this project's handoff note), and `agentReadOnly`, a
 * governance control an agent cannot use to unlock itself — and every trace
 * of it lived at the bottom of Settings, below the GitHub/GitLab/Gitea forms.
 * A structural differentiator that only shows up after scrolling past ten
 * other sections is, for a new user, invisible.
 *
 * This is now a primary tab (`projectViews.ts`) — the same tier as Board and
 * Docs — because the founder's framing is that this isn't a configuration
 * afterthought, it's the reason someone adopts Next Lane over the
 * incumbent. `AgentContextSection` and `AgentAccessSection` are unchanged
 * (they own their own data/permissions); this page only gives them a home a
 * person would find without being told, plus the one thing neither section
 * offered on its own: a direct path to actually connecting an agent.
 */
import { useParams } from 'react-router-dom';
import { useProject } from '@/api/projects';
import { useMyRole } from '@/api/workspaces';
import { useBoardRealtime } from '@/api/socket';
import { AppHeader } from '@/components/AppHeader';
import { ProjectBreadcrumb } from '@/components/project/ProjectBreadcrumb';
import { ProjectNav } from '@/components/project/ProjectNav';
import { AgentContextSection } from '@/components/settings/AgentContextSection';
import { AgentAccessSection } from '@/components/settings/AgentAccessSection';
import { ConnectAgentCallout } from '@/components/developers/ConnectAgentCallout';
import { ErrorState, LoadingState } from '@/components/ui/States';

export function AgentsPage() {
  const { projectId = '' } = useParams();
  const projectQuery = useProject(projectId);
  const project = projectQuery.data;
  const myRole = useMyRole(project?.workspaceId);

  // Same realtime wiring Settings used: keeps the agent-context doc and its
  // staleness pill live for a page a person might leave open while an agent
  // works in the background.
  useBoardRealtime(projectId);

  if (projectQuery.isLoading) {
    return (
      <Shell projectId={projectId} projectName={undefined}>
        <LoadingState label="Loading…" />
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
        <div>
          <h1 className="text-lg font-semibold text-ink-900">Agents</h1>
          <p className="text-sm text-ink-500">
            What AI agents can do in this project, and the memory they leave
            for the next one.
          </p>
        </div>

        <ConnectAgentCallout />

        <AgentContextSection projectId={projectId} myRole={myRole} />

        <AgentAccessSection projectId={projectId} myRole={myRole} />
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

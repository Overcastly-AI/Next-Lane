/**
 * PagesPage — the project-scoped route wrapper around `PagesSurface`
 * (tree + Document/Graph views for a single project's page tree).
 *
 * Routes (see App.tsx):
 *   /projects/:projectId/pages             — Document view, no page selected
 *                                             (auto-opens the first page, if any)
 *   /projects/:projectId/pages/graph       — Graph view
 *   /projects/:projectId/pages/:pageId     — Document view, that page open
 *
 * Owns route-level chrome (project breadcrumb + nav) and realtime
 * subscription; all tree/editor/graph orchestration lives in the
 * scope-parameterized `PagesSurface`, shared verbatim with
 * `WorkspaceDocsPage` (the org-wide docs space).
 */
import { useParams } from 'react-router-dom';
import { useProject } from '@/api/projects';
import { useMyRole } from '@/api/workspaces';
import { useBoardRealtime } from '@/api/socket';
import { canEdit } from '@/lib/permissions';
import { AppHeader } from '@/components/AppHeader';
import { ProjectBreadcrumb } from '@/components/project/ProjectBreadcrumb';
import { ProjectNav } from '@/components/project/ProjectNav';
import { PagesSurface } from '@/components/pages/PagesSurface';

export function PagesPage() {
  const { projectId = '' } = useParams<{ projectId: string }>();

  const projectQuery = useProject(projectId);
  const myRole = useMyRole(projectQuery.data?.workspaceId);
  const editable = canEdit(myRole);

  useBoardRealtime(projectId);

  const projectName = projectQuery.data?.name;

  return (
    <Shell projectId={projectId} projectName={projectName}>
      <PagesSurface
        scope={{ kind: 'project', id: projectId }}
        basePath={`/projects/${projectId}/pages`}
        editable={editable}
        showLinkedIssues
        emptyTitle="No pages yet"
        emptyDescription="Create your project's first page to start building a knowledge base."
      />
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function Shell({
  children,
  projectId,
  projectName,
}: {
  children: React.ReactNode;
  projectId: string;
  projectName?: string;
}) {
  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader>
        <ProjectBreadcrumb primary={projectName} secondary={[{ label: 'Docs' }]} />
      </AppHeader>
      <ProjectNav projectId={projectId} />
      <main className="min-h-0 flex-1 overflow-hidden bg-surface">{children}</main>
    </div>
  );
}

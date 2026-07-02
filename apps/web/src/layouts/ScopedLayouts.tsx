/**
 * Route-derived scoped layouts.
 *
 * Structural fix for the workspace-chip sync bug class: rather than every
 * workspace/project-scoped page remembering to call `useSyncActiveWorkspace`
 * itself (which was added piecemeal across bug-fix rounds and easy to
 * forget on a new page), the sync now lives on the ROUTE. Any route nested
 * under `WorkspaceScopedLayout` or `ProjectScopedLayout` gets the header
 * chip synced to the route's workspace for free — correct by construction.
 */
import { Outlet, useParams } from 'react-router-dom';
import { useProject } from '@/api/projects';
import { useSyncActiveWorkspace } from '@/contexts/WorkspaceContext';

/** Wraps every `/workspaces/:workspaceId/*` route. */
export function WorkspaceScopedLayout() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  useSyncActiveWorkspace(workspaceId);
  return <Outlet />;
}

/**
 * Wraps every `/projects/:projectId/*` route. Resolves the project's
 * workspace via the lightweight single-project query (cheap/cacheable — the
 * page itself typically re-fetches richer data, e.g. the board, separately)
 * and syncs the active workspace to it.
 */
export function ProjectScopedLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const projectQuery = useProject(projectId);
  useSyncActiveWorkspace(projectQuery.data?.workspaceId);
  return <Outlet />;
}

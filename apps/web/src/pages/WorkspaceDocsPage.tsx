/**
 * WorkspaceDocsPage — the workspace-level docs space: an org-wide page tree
 * not tied to any single project (company handbook, runbooks, ADRs). Reuses
 * the EXACT same tree/editor/backlinks/graph component stack as the
 * per-project Pages surface (`PagesSurface`), parameterized by workspace
 * scope instead of project scope — see `PagesSurface`'s header comment.
 *
 * Route: /workspaces/:workspaceId/docs
 *        /workspaces/:workspaceId/docs/graph
 *        /workspaces/:workspaceId/docs/:pageId
 *
 * Reachable from a single entry point: the persistent sidebar's workspace
 * section (`SidebarNavContent`, "Docs" row) — NOT a workspace *setting* (it
 * used to also live as a tab in `WorkspaceSettingsNav`, which buried a
 * daily-use surface inside "Settings" and read as a second, differently
 * named feature; that tab has been removed) and NOT a project tab (a
 * workspace page has no owning project). VIEWER-readable / MEMBER-writable,
 * resolved via the workspace membership the same way Members/Audit log are —
 * a non-member simply has no `activeWorkspace` entry pointing here (see
 * `SidebarNavContent`) and the underlying `/workspaces/:id/pages/*` API
 * 403s if reached directly, surfacing as the tree's `ErrorState`.
 *
 * A workspace page has no owning project, so it has no "Linked issues"
 * section (the backend doesn't sync issue-key mentions for workspace-scoped
 * pages — `showLinkedIssues={false}`) and no realtime subscription yet (page
 * realtime for the workspace room is a backend follow-up — see
 * `apps/api/src/realtime/realtime.gateway.ts`'s `workspaceRoom` doc comment;
 * this surface's own mutations still invalidate the local cache instantly).
 */
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMyRole, useWorkspaces } from '@/api/workspaces';
import { canEdit } from '@/lib/permissions';
import { AppHeader } from '@/components/AppHeader';
import { PagesSurface } from '@/components/pages/PagesSurface';

export function WorkspaceDocsPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();

  const myRole = useMyRole(workspaceId);
  const editable = canEdit(myRole);

  const workspacesQuery = useWorkspaces();
  const workspaceName = useMemo(
    () => workspacesQuery.data?.find((w) => w.id === workspaceId)?.name,
    [workspacesQuery.data, workspaceId],
  );

  return (
    <Shell workspaceName={workspaceName}>
      <PagesSurface
        scope={{ kind: 'workspace', id: workspaceId }}
        basePath={`/workspaces/${workspaceId}/docs`}
        editable={editable}
        showLinkedIssues={false}
        emptyTitle="No docs yet"
        emptyDescription="Create your workspace's first page — a handbook, a runbook, an ADR — for docs that live above any single project."
      />
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function Shell({
  children,
  workspaceName,
}: {
  children: React.ReactNode;
  workspaceName: string | undefined;
}) {
  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader>
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <Link
            to="/"
            className="shrink-0 text-sm text-ink-400 hover:text-ink-600"
            aria-label="Back to dashboard"
          >
            Dashboard
          </Link>
          <span className="shrink-0 text-ink-300">/</span>
          <span className="min-w-0 truncate text-sm text-ink-500">
            {workspaceName ?? 'Workspace'}
          </span>
          <span className="shrink-0 text-ink-300">/</span>
          <span className="shrink-0 text-sm font-semibold text-ink-900">Docs</span>
        </div>
      </AppHeader>
      <main className="min-h-0 flex-1 overflow-hidden bg-surface">{children}</main>
    </div>
  );
}

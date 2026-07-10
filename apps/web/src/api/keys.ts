/** Centralized TanStack Query keys so invalidation stays consistent. */
export const qk = {
  me: ['me'] as const,
  myWork: ['myWork'] as const,
  notifications: ['notifications'] as const,
  unreadCount: ['unreadCount'] as const,
  workspaces: ['workspaces'] as const,
  workspaceMembers: (workspaceId: string) =>
    ['workspaceMembers', workspaceId] as const,
  users: ['users'] as const,
  projects: (workspaceId: string) => ['projects', workspaceId] as const,
  project: (projectId: string) => ['project', projectId] as const,
  /**
   * Legacy project-board key — used by `useBoardDefault` (the project default
   * board, fetched by projectId). New board-id-driven views use `qk.boardView`.
   */
  board: (projectId: string) => ['board', projectId] as const,
  /**
   * Board view keyed by the specific board id. This is the canonical key for
   * the board view cache once the user has selected (or been defaulted to) a
   * specific board. All optimistic mutations write here.
   */
  boardView: (boardId: string) => ['boardView', boardId] as const,
  /**
   * List of all boards for a project (for the board switcher).
   */
  boards: (projectId: string) => ['boards', projectId] as const,
  projectIssues: (projectId: string) => ['projectIssues', projectId] as const,
  issueSearch: (projectId: string, q: string) =>
    ['issueSearch', projectId, q] as const,
  issue: (issueId: string) => ['issue', issueId] as const,
  comments: (issueId: string) => ['comments', issueId] as const,
  activity: (issueId: string) => ['activity', issueId] as const,
  statuses: (projectId: string) => ['statuses', projectId] as const,
  sprints: (projectId: string) => ['sprints', projectId] as const,
  labels: (projectId: string) => ['labels', projectId] as const,
  attachments: (issueId: string) => ['attachments', issueId] as const,
  customFields: (projectId: string) => ['customFields', projectId] as const,
  components: (projectId: string) => ['components', projectId] as const,
  versions: (projectId: string) => ['versions', projectId] as const,
  pokerSessions: (projectId: string) => ['pokerSessions', projectId] as const,
  pokerSession: (sessionId: string) => ['pokerSession', sessionId] as const,
  issueLinks: (issueId: string) => ['issueLinks', issueId] as const,
  watchers: (issueId: string) => ['watchers', issueId] as const,
  checklist: (issueId: string) => ['checklist', issueId] as const,
  worklogs: (issueId: string) => ['worklogs', issueId] as const,
  /** Named workflows for a project (per-board workflow feature). */
  workflows: (projectId: string) => ['workflows', projectId] as const,
  /** Single named workflow (includes transitions). */
  workflow: (workflowId: string) => ['workflow', workflowId] as const,
  /** Issue templates for a project. */
  issueTemplates: (projectId: string) => ['issueTemplates', projectId] as const,
  /** Personal quick links for the current user. */
  quickLinks: ['quickLinks'] as const,
  /** Public login-surface capability probe (e.g. is SSO/OIDC configured). */
  authProviders: ['authProviders'] as const,
  /** Linked GitHub PRs/commits/branches for an issue (Development section). */
  githubLinks: (issueId: string) => ['githubLinks', issueId] as const,
  /** Linked GitLab MRs/commits/branches for an issue (Development section). */
  gitlabLinks: (issueId: string) => ['gitlabLinks', issueId] as const,
  /** Linked Gitea PRs/commits/branches for an issue (Development section). */
  giteaLinks: (issueId: string) => ['giteaLinks', issueId] as const,
  /** Live GitHub PR/CI status for an issue's linked PRs — polled on drawer open. */
  githubLiveStatus: (issueId: string) => ['githubLiveStatus', issueId] as const,
  /** Live GitLab MR/pipeline status for an issue's linked MRs — polled on drawer open. */
  gitlabLiveStatus: (issueId: string) => ['gitlabLiveStatus', issueId] as const,
  /** Dashboard summaries for a project (the dashboards list/tabs). */
  dashboards: (projectId: string) => ['dashboards', projectId] as const,
  /** A single dashboard's metadata + gadgets. */
  dashboard: (dashboardId: string) => ['dashboard', dashboardId] as const,
  /** A dashboard's evaluated gadget data. */
  dashboardData: (dashboardId: string) => ['dashboardData', dashboardId] as const,
  /** ADMIN-view list of public share tokens minted for a dashboard. */
  dashboardShareTokens: (dashboardId: string) =>
    ['dashboardShareTokens', dashboardId] as const,
  /** Instance-level SSO/OIDC configuration (admin settings screen). */
  oidcConfig: ['oidcConfig'] as const,
  /** SSO/OIDC Phase 2 — the N-simultaneous-providers list (admin settings screen). */
  ssoProviders: ['ssoProviders'] as const,
  /**
   * A project's EFFECTIVE members (workspace role + any per-project role
   * override) — the Members section on the project settings page.
   */
  projectMembers: (projectId: string) => ['projectMembers', projectId] as const,
  /** A project's agent-context handoff document (content + staleness). */
  projectAgentContext: (projectId: string) =>
    ['projectAgentContext', projectId] as const,

  // ── Pages (Confluence x Obsidian knowledge base) ─────────────────────────
  /** A project's page tree (sidebar nav). */
  pageTree: (projectId: string) => ['pageTree', projectId] as const,
  /** A project's whole page<->page wiki-link graph (the graph view). */
  pageGraph: (projectId: string) => ['pageGraph', projectId] as const,
  /**
   * A workspace's org-wide page tree (not tied to any single project — the
   * workspace Docs surface's sidebar nav). Deliberately a DIFFERENT key
   * family from `pageTree` (not just `pageTree(workspaceId)`) — the two are
   * fetched from different REST endpoints (`/workspaces/:id/pages/tree` vs
   * `/projects/:id/pages/tree`) and must never collide or cross-invalidate.
   */
  workspacePageTree: (workspaceId: string) => ['workspacePageTree', workspaceId] as const,
  /** A workspace's org-wide page<->page wiki-link graph (the workspace Docs graph view). */
  workspacePageGraph: (workspaceId: string) => ['workspacePageGraph', workspaceId] as const,
  /** A single page's full detail (title/content/metadata). */
  page: (pageId: string) => ['page', pageId] as const,
  /** A page's version history (cursor-paginated, newest-first). */
  pageVersions: (pageId: string) => ['pageVersions', pageId] as const,
  /** One specific version's full content. */
  pageVersion: (pageId: string, versionNumber: number) =>
    ['pageVersion', pageId, versionNumber] as const,
  /** "What links here" — pages that link TO this page. */
  pageBacklinks: (pageId: string) => ['pageBacklinks', pageId] as const,
  /** Knowledge-base pages that reference a given issue (issue drawer's "Linked pages"). */
  issuePages: (issueId: string) => ['issuePages', issueId] as const,
  /** Issues a given page's body references (the page reading view's "Linked issues" panel). */
  pageIssues: (pageId: string) => ['pageIssues', pageId] as const,
};

/**
 * A page surface's scope — either a project's own page tree or a
 * workspace's org-wide docs space (`Page.projectId: null`). Threaded through
 * the pages hooks/`invalidatePagesFamily` so the SAME by-id mutations
 * (update/delete/move/restore) can invalidate the right tree/graph cache
 * family regardless of which surface (`PagesPage` or `WorkspaceDocsPage`)
 * is mounted — see `apps/web/src/components/pages/PagesSurface.tsx`.
 */
export type PagesScope =
  | { kind: 'project'; id: string }
  | { kind: 'workspace'; id: string };

/** The page-tree query key for a given scope. */
export function pagesTreeKey(scope: PagesScope) {
  return scope.kind === 'project' ? qk.pageTree(scope.id) : qk.workspacePageTree(scope.id);
}

/** The page-graph query key for a given scope. */
export function pagesGraphKey(scope: PagesScope) {
  return scope.kind === 'project' ? qk.pageGraph(scope.id) : qk.workspacePageGraph(scope.id);
}

/**
 * Invalidate every cache entry a `PageUpdated` realtime event (or a local
 * mutation) can affect. Mirrors `invalidateBoardFamily`'s "invalidate the
 * whole family" shape: the tree/graph are scope-wide (project OR workspace),
 * `pageBacklinks` is keyed by the LINKED-TO page (which the mutating page
 * doesn't know), so a broad prefix-match invalidation on `['pageBacklinks']`
 * is the same pragmatic tradeoff already made for
 * `['boardView']`/`['dashboardData']`.
 */
export function invalidatePagesFamily(
  qc: import('@tanstack/react-query').QueryClient,
  scope: PagesScope,
  pageId?: string,
): void {
  void qc.invalidateQueries({ queryKey: pagesTreeKey(scope) });
  void qc.invalidateQueries({ queryKey: pagesGraphKey(scope) });
  if (pageId) {
    void qc.invalidateQueries({ queryKey: qk.page(pageId) });
    void qc.invalidateQueries({ queryKey: qk.pageVersions(pageId) });
    // The saved page's own body may have gained/lost issue-key mentions —
    // refresh its "Linked issues" panel too.
    void qc.invalidateQueries({ queryKey: qk.pageIssues(pageId) });
  }
  void qc.invalidateQueries({ queryKey: ['pageBacklinks'] });
  // An issue mention anywhere in this scope's pages can appear/disappear on
  // any save; broad-invalidate the whole family the same pragmatic way
  // `pageBacklinks` already does above (we don't know which OTHER pages'
  // "Linked issues" panels might be affected by cross-references).
  void qc.invalidateQueries({ queryKey: ['pageIssues'] });
}

/**
 * Invalidate every cache entry that renders board content for a project: the
 * legacy project-default key AND all board-id-keyed board views (prefix match
 * on ['boardView'] — the mutation doesn't know which board the user has open).
 *
 * Mutation hooks that change issues WITHOUT taking a `boardId` param (issue
 * update, bulk edit, sprint lifecycle, custom-field values) must use this:
 * invalidating only `qk.board(projectId)` refreshes a cache nothing renders
 * from, leaving the visible boardView stale until the global staleTime lapses.
 */
export function invalidateBoardFamily(
  qc: import('@tanstack/react-query').QueryClient,
  projectId: string,
): void {
  void qc.invalidateQueries({ queryKey: qk.board(projectId) });
  void qc.invalidateQueries({ queryKey: ['boardView'] });
}

/**
 * Invalidate every open dashboard's evaluated gadget data. Mirrors
 * `invalidateBoardFamily`'s "invalidate the whole family" shape: an issue
 * mutation doesn't know which dashboard(s) are currently open (a dashboard
 * has no `boardId`-style handle to thread through), so a broad prefix-match
 * invalidation on `['dashboardData']` is the same pragmatic tradeoff
 * `invalidateBoardFamily` already made for `['boardView']`.
 */
export function invalidateDashboardDataFamily(
  qc: import('@tanstack/react-query').QueryClient,
): void {
  void qc.invalidateQueries({ queryKey: ['dashboardData'] });
}

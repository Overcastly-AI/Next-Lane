/**
 * Cross-project wiki-links (org-level-docs epic, BACKLOG #12b) — the ONE
 * place that turns a page reference's SCOPE (which project it belongs to, or
 * `null` for a workspace-docs page) into a route, and decides whether that
 * scope differs from whatever page is currently being viewed.
 *
 * Why this needs to be centralized: `syncWikiLinks` now resolves
 * `[[wiki-links]]` workspace-wide (`c1b51b8`), so a backlink, an outgoing
 * link, or a workspace-graph node can legitimately point at a page in a
 * DIFFERENT project (or the workspace-docs space) than the one currently
 * open. Every surface that renders a page reference — `BacklinksPanel`,
 * `OutgoingLinksPanel`, `KnowledgeGraphView` (workspace mode), and the
 * `CommandPalette`'s page results — must route to the TARGET's own scope,
 * not the current one, or a click silently 404s / lands on the wrong page.
 * One helper for all of them means that rule can't drift between call sites.
 */
import type { PagesScope } from '@/api/keys';

/** The minimum a page reference needs to carry to be routed to its own scope. */
export interface PageScopeRef {
  id: string;
  /** Null = a workspace-level page (no owning project). */
  projectId: string | null;
  /** Always present — every page belongs to exactly one workspace. */
  workspaceId: string;
}

/**
 * The route for a page reference, in ITS OWN scope:
 *   - `projectId` set  -> that project's Pages route.
 *   - `projectId` null -> the owning workspace's Docs route.
 * Deliberately ignores whatever scope the caller is currently viewing —
 * that's the whole point (a project-A page linking to a project-B page must
 * open project B's route, not stay under project A's).
 */
export function pageRefPath(ref: PageScopeRef): string {
  return ref.projectId
    ? `/projects/${ref.projectId}/pages/${ref.id}`
    : `/workspaces/${ref.workspaceId}/docs/${ref.id}`;
}

/**
 * True when a page reference's scope differs from the scope currently being
 * viewed — the show/hide rule for the quiet cross-scope badge (BACKLOG #12b:
 * "only when it differs", no clutter on the common same-scope case).
 */
export function isDifferentPageScope(
  current: PagesScope,
  ref: Pick<PageScopeRef, 'projectId' | 'workspaceId'>,
): boolean {
  if (current.kind === 'project') return ref.projectId !== current.id;
  // Viewing a workspace-docs page: same scope only when the target is ALSO
  // a workspace-docs page in this same workspace.
  return ref.projectId !== null || ref.workspaceId !== current.id;
}

/**
 * The badge label for a page reference whose scope differs from the one
 * being viewed: the target project's key (e.g. "NL"), or "Workspace" for a
 * workspace-docs page. Callers gate rendering on `isDifferentPageScope`
 * first — this only computes the label.
 */
export function pageScopeBadgeLabel(ref: { projectId: string | null; projectKey?: string | null }): string {
  return ref.projectId ? (ref.projectKey ?? 'Project') : 'Workspace';
}

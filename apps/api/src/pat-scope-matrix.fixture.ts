/**
 * Canonical PAT-scope rollout matrix — the single source of truth for "which
 * route requires which `@RequireScope`".
 *
 * Extracted from `pat-scope-rollout.integration.spec.ts` (2026-07-06 Hardening
 * Night rollout) so it can be shared with
 * `pat-scope-coverage.integration.spec.ts` without duplication, per the
 * backlog acceptance criteria: "the allowlist/matrix is one exported
 * constant, not duplicated across specs."
 *
 * `pat-scope-rollout.integration.spec.ts` uses this to data-drive real-HTTP
 * DENY/ALLOW assertions against every route. `pat-scope-coverage.integration.
 * spec.ts` uses it as the ground truth every `@RequireScope`-decorated route
 * discovered at runtime must appear in (and vice versa) — so the matrix can
 * never silently drift from what's actually gated in code again.
 *
 * IMPORTANT: when you add a new `@RequireScope`-decorated route, add its row
 * here too. The coverage spec fails the build if you forget.
 */

import type { PATScope } from '@next-lane/shared';

/** One row of the rollout matrix: a route + the single scope it requires. */
export interface MatrixRow {
  controller: string;
  method: string;
  path: string;
  scope: PATScope;
}

// Dummy path-param id — guards fire before the handler ever looks it up, so
// it never needs to resolve to a real row (see pat-scope-rollout spec header).
export const X = 'nonexistent-id';

export const MATRIX: MatrixRow[] = [
  // admin-settings
  { controller: 'admin-settings', method: 'GET', path: '/admin/oidc-config', scope: 'admin:read' },
  { controller: 'admin-settings', method: 'PATCH', path: '/admin/oidc-config', scope: 'admin:write' },
  // admin-settings — SSO/OIDC Phase 2: N-simultaneous-providers list (SAML + additional OIDC rows)
  { controller: 'admin-settings', method: 'GET', path: '/admin/sso-providers', scope: 'admin:read' },
  { controller: 'admin-settings', method: 'POST', path: '/admin/sso-providers', scope: 'admin:write' },
  { controller: 'admin-settings', method: 'PATCH', path: `/admin/sso-providers/${X}`, scope: 'admin:write' },
  { controller: 'admin-settings', method: 'DELETE', path: `/admin/sso-providers/${X}`, scope: 'admin:write' },

  // analytics
  { controller: 'analytics', method: 'GET', path: '/me/analytics', scope: 'issues:read' },
  { controller: 'analytics', method: 'GET', path: `/projects/${X}/analytics`, scope: 'projects:read' },

  // api-tokens
  { controller: 'api-tokens', method: 'GET', path: '/me/tokens', scope: 'tokens:read' },
  { controller: 'api-tokens', method: 'POST', path: '/me/tokens', scope: 'tokens:write' },
  { controller: 'api-tokens', method: 'DELETE', path: `/me/tokens/${X}`, scope: 'tokens:write' },

  // attachments
  { controller: 'attachments', method: 'POST', path: `/issues/${X}/attachments`, scope: 'issues:write' },
  { controller: 'attachments', method: 'GET', path: `/issues/${X}/attachments`, scope: 'issues:read' },
  { controller: 'attachments', method: 'GET', path: `/attachments/${X}`, scope: 'issues:read' },
  { controller: 'attachments', method: 'DELETE', path: `/attachments/${X}`, scope: 'issues:write' },

  // audit
  { controller: 'audit', method: 'GET', path: `/workspaces/${X}/audit-log`, scope: 'workspaces:read' },

  // automations
  { controller: 'automations', method: 'GET', path: `/projects/${X}/automations`, scope: 'projects:read' },
  { controller: 'automations', method: 'POST', path: `/projects/${X}/automations`, scope: 'projects:write' },
  { controller: 'automations', method: 'GET', path: `/projects/${X}/automations/runs`, scope: 'projects:read' },
  { controller: 'automations', method: 'GET', path: `/projects/${X}/automations/${X}`, scope: 'projects:read' },
  { controller: 'automations', method: 'PATCH', path: `/projects/${X}/automations/${X}`, scope: 'projects:write' },
  { controller: 'automations', method: 'DELETE', path: `/projects/${X}/automations/${X}`, scope: 'projects:write' },
  { controller: 'automations', method: 'GET', path: `/projects/${X}/automations/${X}/runs`, scope: 'projects:read' },

  // board
  { controller: 'board', method: 'GET', path: `/projects/${X}/boards`, scope: 'projects:read' },
  { controller: 'board', method: 'POST', path: `/projects/${X}/boards`, scope: 'projects:write' },
  { controller: 'board', method: 'GET', path: `/projects/${X}/board`, scope: 'projects:read' },
  { controller: 'board', method: 'GET', path: `/boards/${X}`, scope: 'projects:read' },
  { controller: 'board', method: 'PATCH', path: `/boards/${X}`, scope: 'projects:write' },
  { controller: 'board', method: 'DELETE', path: `/boards/${X}`, scope: 'projects:write' },

  // checklist
  { controller: 'checklist', method: 'GET', path: `/issues/${X}/checklist`, scope: 'issues:read' },
  { controller: 'checklist', method: 'POST', path: `/issues/${X}/checklist`, scope: 'issues:write' },
  { controller: 'checklist', method: 'PUT', path: `/issues/${X}/checklist/reorder`, scope: 'issues:write' },
  { controller: 'checklist', method: 'PATCH', path: `/checklist/${X}`, scope: 'issues:write' },
  { controller: 'checklist', method: 'DELETE', path: `/checklist/${X}`, scope: 'issues:write' },

  // comments
  { controller: 'comments', method: 'GET', path: `/issues/${X}/comments`, scope: 'comments:read' },
  { controller: 'comments', method: 'POST', path: `/issues/${X}/comments`, scope: 'comments:write' },
  { controller: 'comments', method: 'PATCH', path: `/comments/${X}`, scope: 'comments:write' },
  { controller: 'comments', method: 'DELETE', path: `/comments/${X}`, scope: 'comments:write' },

  // components
  { controller: 'components', method: 'GET', path: `/projects/${X}/components`, scope: 'projects:read' },
  { controller: 'components', method: 'POST', path: `/projects/${X}/components`, scope: 'projects:write' },
  { controller: 'components', method: 'PATCH', path: `/components/${X}`, scope: 'projects:write' },
  { controller: 'components', method: 'DELETE', path: `/components/${X}`, scope: 'projects:write' },

  // gitea
  { controller: 'gitea', method: 'GET', path: `/projects/${X}/gitea`, scope: 'gitea:read' },
  { controller: 'gitea', method: 'PUT', path: `/projects/${X}/gitea`, scope: 'gitea:write' },
  { controller: 'gitea', method: 'DELETE', path: `/projects/${X}/gitea`, scope: 'gitea:write' },
  { controller: 'gitea', method: 'GET', path: `/issues/${X}/gitea-links`, scope: 'gitea:read' },

  // github (added 2026-07-06 by pat-scope-coverage: this controller was scoped
  // in the 4aec12a rollout but never added to this matrix — real drift the
  // new coverage spec caught. Mirrors gitea/gitlab's shape 1:1.)
  { controller: 'github', method: 'GET', path: `/projects/${X}/github`, scope: 'github:read' },
  { controller: 'github', method: 'PUT', path: `/projects/${X}/github`, scope: 'github:write' },
  { controller: 'github', method: 'DELETE', path: `/projects/${X}/github`, scope: 'github:write' },
  { controller: 'github', method: 'PATCH', path: `/projects/${X}/github/automation`, scope: 'github:write' },
  { controller: 'github', method: 'GET', path: `/issues/${X}/github-links`, scope: 'github:read' },
  { controller: 'github', method: 'GET', path: `/issues/${X}/github-links/live`, scope: 'github:read' },

  // gitlab (added 2026-07-06, same drift fix as github above)
  { controller: 'gitlab', method: 'GET', path: `/projects/${X}/gitlab`, scope: 'gitlab:read' },
  { controller: 'gitlab', method: 'PUT', path: `/projects/${X}/gitlab`, scope: 'gitlab:write' },
  { controller: 'gitlab', method: 'DELETE', path: `/projects/${X}/gitlab`, scope: 'gitlab:write' },
  { controller: 'gitlab', method: 'PATCH', path: `/projects/${X}/gitlab/automation`, scope: 'gitlab:write' },
  { controller: 'gitlab', method: 'GET', path: `/issues/${X}/gitlab-links`, scope: 'gitlab:read' },
  { controller: 'gitlab', method: 'GET', path: `/issues/${X}/gitlab-links/live`, scope: 'gitlab:read' },

  // custom-fields
  { controller: 'custom-fields', method: 'GET', path: `/projects/${X}/custom-fields`, scope: 'projects:read' },
  { controller: 'custom-fields', method: 'POST', path: `/projects/${X}/custom-fields`, scope: 'projects:write' },
  { controller: 'custom-fields', method: 'PATCH', path: `/custom-fields/${X}`, scope: 'projects:write' },
  { controller: 'custom-fields', method: 'DELETE', path: `/custom-fields/${X}`, scope: 'projects:write' },

  // dashboard-share-tokens (public GET /public/dashboard/:token is @Public — excluded, see below)
  { controller: 'dashboard-share-tokens', method: 'POST', path: `/dashboards/${X}/share-tokens`, scope: 'projects:write' },
  { controller: 'dashboard-share-tokens', method: 'GET', path: `/dashboards/${X}/share-tokens`, scope: 'projects:read' },
  { controller: 'dashboard-share-tokens', method: 'DELETE', path: `/dashboards/${X}/share-tokens/${X}`, scope: 'projects:write' },

  // dashboards
  { controller: 'dashboards', method: 'GET', path: `/projects/${X}/dashboards`, scope: 'projects:read' },
  { controller: 'dashboards', method: 'POST', path: `/projects/${X}/dashboards`, scope: 'projects:write' },
  { controller: 'dashboards', method: 'GET', path: `/dashboards/${X}`, scope: 'projects:read' },
  { controller: 'dashboards', method: 'GET', path: `/dashboards/${X}/data`, scope: 'projects:read' },
  { controller: 'dashboards', method: 'PATCH', path: `/dashboards/${X}`, scope: 'projects:write' },
  { controller: 'dashboards', method: 'DELETE', path: `/dashboards/${X}`, scope: 'projects:write' },
  { controller: 'dashboards', method: 'POST', path: `/dashboards/${X}/gadgets`, scope: 'projects:write' },
  { controller: 'dashboards', method: 'PATCH', path: `/gadgets/${X}`, scope: 'projects:write' },
  { controller: 'dashboards', method: 'DELETE', path: `/gadgets/${X}`, scope: 'projects:write' },

  // issue-templates
  { controller: 'issue-templates', method: 'GET', path: `/projects/${X}/issue-templates`, scope: 'projects:read' },
  { controller: 'issue-templates', method: 'POST', path: `/projects/${X}/issue-templates`, scope: 'projects:write' },
  { controller: 'issue-templates', method: 'PATCH', path: `/issue-templates/${X}`, scope: 'projects:write' },
  { controller: 'issue-templates', method: 'DELETE', path: `/issue-templates/${X}`, scope: 'projects:write' },
  { controller: 'issue-templates', method: 'POST', path: `/issue-templates/${X}/create-issue`, scope: 'issues:write' },

  // issue-links
  { controller: 'issue-links', method: 'POST', path: `/issues/${X}/links`, scope: 'issues:write' },
  { controller: 'issue-links', method: 'GET', path: `/issues/${X}/links`, scope: 'issues:read' },
  { controller: 'issue-links', method: 'DELETE', path: `/issue-links/${X}`, scope: 'issues:write' },

  // issues (main + csv + import — three controllers, one domain)
  { controller: 'issues', method: 'POST', path: '/issues', scope: 'issues:write' },
  { controller: 'issues', method: 'POST', path: '/issues/bulk', scope: 'issues:write' },
  { controller: 'issues', method: 'GET', path: '/issues', scope: 'issues:read' },
  { controller: 'issues', method: 'GET', path: `/issues/${X}`, scope: 'issues:read' },
  { controller: 'issues', method: 'GET', path: `/issues/${X}/activity`, scope: 'issues:read' },
  { controller: 'issues', method: 'PATCH', path: `/issues/${X}`, scope: 'issues:write' },
  { controller: 'issues', method: 'POST', path: `/issues/${X}/move`, scope: 'issues:write' },
  { controller: 'issues', method: 'DELETE', path: `/issues/${X}`, scope: 'issues:write' },
  { controller: 'issues', method: 'POST', path: `/issues/${X}/watch`, scope: 'issues:write' },
  { controller: 'issues', method: 'DELETE', path: `/issues/${X}/watch`, scope: 'issues:write' },
  { controller: 'issues', method: 'GET', path: `/issues/${X}/watchers`, scope: 'issues:read' },
  { controller: 'issues-csv', method: 'GET', path: `/projects/${X}/issues.csv`, scope: 'issues:read' },
  { controller: 'issues-import', method: 'POST', path: `/projects/${X}/issues/import`, scope: 'issues:write' },

  // labels
  { controller: 'labels', method: 'GET', path: `/projects/${X}/labels`, scope: 'projects:read' },
  { controller: 'labels', method: 'POST', path: `/projects/${X}/labels`, scope: 'projects:write' },
  { controller: 'labels', method: 'PATCH', path: `/labels/${X}`, scope: 'projects:write' },
  { controller: 'labels', method: 'DELETE', path: `/labels/${X}`, scope: 'projects:write' },
  { controller: 'labels', method: 'POST', path: `/issues/${X}/labels`, scope: 'issues:write' },
  { controller: 'labels', method: 'DELETE', path: `/issues/${X}/labels/${X}`, scope: 'issues:write' },

  // notifications
  { controller: 'notifications', method: 'GET', path: '/notifications', scope: 'issues:read' },
  { controller: 'notifications', method: 'GET', path: '/notifications/unread-count', scope: 'issues:read' },
  { controller: 'notifications', method: 'POST', path: `/notifications/${X}/read`, scope: 'issues:write' },
  { controller: 'notifications', method: 'POST', path: '/notifications/read-all', scope: 'issues:write' },

  // personal-boards (only the issue-creating route is gated)
  { controller: 'personal-boards', method: 'POST', path: `/me/personal-cards/${X}/promote`, scope: 'issues:write' },

  // poker
  { controller: 'poker', method: 'POST', path: `/projects/${X}/poker-sessions`, scope: 'projects:write' },
  { controller: 'poker', method: 'GET', path: `/projects/${X}/poker-sessions`, scope: 'projects:read' },
  { controller: 'poker', method: 'GET', path: `/poker-sessions/${X}`, scope: 'projects:read' },
  { controller: 'poker', method: 'PATCH', path: `/poker-sessions/${X}`, scope: 'projects:write' },
  { controller: 'poker', method: 'POST', path: `/poker-sessions/${X}/items`, scope: 'projects:write' },
  { controller: 'poker', method: 'DELETE', path: `/poker-items/${X}`, scope: 'projects:write' },
  { controller: 'poker', method: 'POST', path: `/poker-items/${X}/vote`, scope: 'projects:write' },
  { controller: 'poker', method: 'POST', path: `/poker-items/${X}/reveal`, scope: 'projects:write' },
  { controller: 'poker', method: 'POST', path: `/poker-items/${X}/commit`, scope: 'projects:write' },

  // pages (Confluence x Obsidian-hybrid knowledge base)
  { controller: 'pages', method: 'POST', path: `/projects/${X}/pages`, scope: 'pages:write' },
  { controller: 'pages', method: 'GET', path: `/projects/${X}/pages/tree`, scope: 'pages:read' },
  { controller: 'pages', method: 'GET', path: `/projects/${X}/pages/graph`, scope: 'pages:read' },
  { controller: 'pages', method: 'GET', path: `/pages/${X}`, scope: 'pages:read' },
  { controller: 'pages', method: 'PATCH', path: `/pages/${X}`, scope: 'pages:write' },
  { controller: 'pages', method: 'DELETE', path: `/pages/${X}`, scope: 'pages:write' },
  { controller: 'pages', method: 'POST', path: `/pages/${X}/move`, scope: 'pages:write' },
  { controller: 'pages', method: 'GET', path: `/pages/${X}/versions`, scope: 'pages:read' },
  { controller: 'pages', method: 'GET', path: `/pages/${X}/versions/${X}`, scope: 'pages:read' },
  { controller: 'pages', method: 'POST', path: `/pages/${X}/versions/${X}/restore`, scope: 'pages:write' },
  { controller: 'pages', method: 'GET', path: `/pages/${X}/backlinks`, scope: 'pages:read' },
  { controller: 'pages', method: 'GET', path: `/pages/${X}/links`, scope: 'pages:read' },
  { controller: 'pages', method: 'GET', path: `/pages/${X}/issues`, scope: 'pages:read' },
  { controller: 'pages', method: 'GET', path: `/issues/${X}/pages`, scope: 'pages:read' },
  // pages — workspace-level docs (org-level-docs epic, Slice 2): a Page with
  // projectId: null. The by-id routes above already cover both kinds.
  { controller: 'pages', method: 'POST', path: `/workspaces/${X}/pages`, scope: 'pages:write' },
  { controller: 'pages', method: 'GET', path: `/workspaces/${X}/pages/tree`, scope: 'pages:read' },
  { controller: 'pages', method: 'GET', path: `/workspaces/${X}/pages/graph`, scope: 'pages:read' },

  // page-templates (doc templates) — reusable markdown skeletons for pages.
  // Gated by `pages:*`, NOT `projects:*`: a template only ever reads and
  // writes page content, so a wiki-scoped agent can use them without also
  // being granted project administration. (IssueTemplate uses `projects:*`
  // because its payload spans assignees/components/labels.)
  { controller: 'page-templates', method: 'GET', path: `/workspaces/${X}/page-templates`, scope: 'pages:read' },
  { controller: 'page-templates', method: 'GET', path: `/projects/${X}/page-templates`, scope: 'pages:read' },
  { controller: 'page-templates', method: 'GET', path: `/page-templates/${X}`, scope: 'pages:read' },
  { controller: 'page-templates', method: 'POST', path: `/workspaces/${X}/page-templates`, scope: 'pages:write' },
  { controller: 'page-templates', method: 'POST', path: `/projects/${X}/page-templates`, scope: 'pages:write' },
  { controller: 'page-templates', method: 'PATCH', path: `/page-templates/${X}`, scope: 'pages:write' },
  { controller: 'page-templates', method: 'DELETE', path: `/page-templates/${X}`, scope: 'pages:write' },
  // Writes a Page, so `pages:write` — the destination's MEMBER check is
  // enforced by PagesService, same as a direct create.
  { controller: 'page-templates', method: 'POST', path: `/page-templates/${X}/create-page`, scope: 'pages:write' },

  // project-memberships
  { controller: 'project-memberships', method: 'GET', path: `/projects/${X}/members`, scope: 'projects:read' },
  { controller: 'project-memberships', method: 'PUT', path: `/projects/${X}/members/${X}/role`, scope: 'projects:write' },
  { controller: 'project-memberships', method: 'DELETE', path: `/projects/${X}/members/${X}/role`, scope: 'projects:write' },

  // projects
  { controller: 'projects', method: 'GET', path: '/projects?workspaceId=x', scope: 'projects:read' },
  { controller: 'projects', method: 'POST', path: '/projects', scope: 'projects:write' },
  { controller: 'projects', method: 'GET', path: `/projects/${X}`, scope: 'projects:read' },
  { controller: 'projects', method: 'GET', path: `/projects/${X}/activity`, scope: 'projects:read' },
  { controller: 'projects', method: 'PATCH', path: `/projects/${X}`, scope: 'projects:write' },
  { controller: 'projects', method: 'DELETE', path: `/projects/${X}`, scope: 'projects:write' },

  // reports
  { controller: 'reports', method: 'GET', path: `/projects/${X}/reports/velocity`, scope: 'projects:read' },
  { controller: 'reports', method: 'GET', path: `/projects/${X}/reports/velocity-trend`, scope: 'projects:read' },
  { controller: 'reports', method: 'GET', path: `/projects/${X}/sprints/${X}/burndown`, scope: 'projects:read' },
  { controller: 'reports', method: 'GET', path: `/projects/${X}/reports/cfd`, scope: 'projects:read' },

  // roadmap
  { controller: 'roadmap', method: 'GET', path: `/projects/${X}/roadmap`, scope: 'projects:read' },

  // saved-filters
  { controller: 'saved-filters', method: 'GET', path: `/projects/${X}/saved-filters`, scope: 'projects:read' },
  { controller: 'saved-filters', method: 'POST', path: `/projects/${X}/saved-filters`, scope: 'projects:write' },
  { controller: 'saved-filters', method: 'PATCH', path: `/saved-filters/${X}`, scope: 'projects:write' },
  { controller: 'saved-filters', method: 'DELETE', path: `/saved-filters/${X}`, scope: 'projects:write' },

  // search
  { controller: 'search', method: 'GET', path: '/search?q=x', scope: 'issues:read' },
  { controller: 'search', method: 'GET', path: `/projects/${X}/search?q=x`, scope: 'issues:read' },
  // Pages-only FTS, gated by pages:read (NOT issues:read) so a wiki-scoped token
  // can search pages; the combined /search stays issues:read but now suppresses
  // the pages group unless the caller also holds pages:read.
  { controller: 'search', method: 'GET', path: '/search/pages?q=x', scope: 'pages:read' },

  // share-tokens
  { controller: 'share-tokens', method: 'POST', path: `/projects/${X}/share-tokens`, scope: 'projects:write' },
  { controller: 'share-tokens', method: 'GET', path: `/projects/${X}/share-tokens`, scope: 'projects:read' },
  { controller: 'share-tokens', method: 'DELETE', path: `/projects/${X}/share-tokens/${X}`, scope: 'projects:write' },

  // sprints
  { controller: 'sprints', method: 'GET', path: `/projects/${X}/sprints`, scope: 'projects:read' },
  { controller: 'sprints', method: 'POST', path: `/projects/${X}/sprints`, scope: 'projects:write' },
  { controller: 'sprints', method: 'PATCH', path: `/sprints/${X}`, scope: 'projects:write' },
  { controller: 'sprints', method: 'DELETE', path: `/sprints/${X}`, scope: 'projects:write' },

  // standups
  { controller: 'standups', method: 'GET', path: `/projects/${X}/standups`, scope: 'projects:read' },
  { controller: 'standups', method: 'GET', path: `/projects/${X}/standups/me`, scope: 'projects:read' },
  { controller: 'standups', method: 'GET', path: `/projects/${X}/standups/prefill`, scope: 'projects:read' },
  { controller: 'standups', method: 'POST', path: `/projects/${X}/standups`, scope: 'projects:write' },

  // statuses
  { controller: 'statuses', method: 'GET', path: `/projects/${X}/statuses`, scope: 'projects:read' },
  { controller: 'statuses', method: 'POST', path: `/projects/${X}/statuses`, scope: 'projects:write' },
  { controller: 'statuses', method: 'PATCH', path: `/statuses/${X}`, scope: 'projects:write' },
  { controller: 'statuses', method: 'DELETE', path: `/statuses/${X}`, scope: 'projects:write' },

  // users
  { controller: 'users', method: 'GET', path: '/users', scope: 'workspaces:read' },
  { controller: 'users', method: 'GET', path: `/users/${X}`, scope: 'workspaces:read' },

  // versions
  { controller: 'versions', method: 'GET', path: `/projects/${X}/versions`, scope: 'projects:read' },
  { controller: 'versions', method: 'POST', path: `/projects/${X}/versions`, scope: 'projects:write' },
  { controller: 'versions', method: 'PATCH', path: `/versions/${X}`, scope: 'projects:write' },
  { controller: 'versions', method: 'DELETE', path: `/versions/${X}`, scope: 'projects:write' },
  { controller: 'versions', method: 'PUT', path: `/issues/${X}/versions`, scope: 'issues:write' },

  // webhooks
  { controller: 'webhooks', method: 'GET', path: `/projects/${X}/webhooks`, scope: 'webhooks:read' },
  { controller: 'webhooks', method: 'POST', path: `/projects/${X}/webhooks`, scope: 'webhooks:write' },
  { controller: 'webhooks', method: 'PATCH', path: `/projects/${X}/webhooks/${X}`, scope: 'webhooks:write' },
  { controller: 'webhooks', method: 'DELETE', path: `/projects/${X}/webhooks/${X}`, scope: 'webhooks:write' },
  { controller: 'webhooks', method: 'GET', path: `/projects/${X}/webhooks/${X}/deliveries`, scope: 'webhooks:read' },
  { controller: 'webhooks', method: 'POST', path: `/projects/${X}/webhooks/${X}/test`, scope: 'webhooks:write' },

  // work-logs
  { controller: 'work-logs', method: 'GET', path: `/issues/${X}/worklogs`, scope: 'issues:read' },
  { controller: 'work-logs', method: 'POST', path: `/issues/${X}/worklogs`, scope: 'issues:write' },
  { controller: 'work-logs', method: 'PATCH', path: `/worklogs/${X}`, scope: 'issues:write' },
  { controller: 'work-logs', method: 'DELETE', path: `/worklogs/${X}`, scope: 'issues:write' },

  // agent-context
  { controller: 'agent-context', method: 'GET', path: `/projects/${X}/agent-context`, scope: 'projects:read' },
  { controller: 'agent-context', method: 'PUT', path: `/projects/${X}/agent-context`, scope: 'projects:write' },

  // workflow
  { controller: 'workflow', method: 'GET', path: `/projects/${X}/workflow`, scope: 'projects:read' },
  { controller: 'workflow', method: 'PATCH', path: `/projects/${X}/workflow`, scope: 'projects:write' },
  { controller: 'workflow', method: 'POST', path: `/projects/${X}/workflow/transitions`, scope: 'projects:write' },
  { controller: 'workflow', method: 'PATCH', path: `/workflow/transitions/${X}`, scope: 'projects:write' },
  { controller: 'workflow', method: 'DELETE', path: `/workflow/transitions/${X}`, scope: 'projects:write' },
  { controller: 'workflow', method: 'GET', path: `/projects/${X}/workflows`, scope: 'projects:read' },
  { controller: 'workflow', method: 'POST', path: `/projects/${X}/workflows`, scope: 'projects:write' },
  { controller: 'workflow', method: 'POST', path: `/projects/${X}/workflows/from-template`, scope: 'projects:write' },
  { controller: 'workflow', method: 'GET', path: `/workflows/${X}`, scope: 'projects:read' },
  { controller: 'workflow', method: 'PATCH', path: `/workflows/${X}`, scope: 'projects:write' },
  { controller: 'workflow', method: 'DELETE', path: `/workflows/${X}`, scope: 'projects:write' },
  { controller: 'workflow', method: 'POST', path: `/workflows/${X}/transitions`, scope: 'projects:write' },
  { controller: 'workflow', method: 'PATCH', path: `/workflow-transitions/${X}`, scope: 'projects:write' },
  { controller: 'workflow', method: 'DELETE', path: `/workflow-transitions/${X}`, scope: 'projects:write' },

  // workspaces
  { controller: 'workspaces', method: 'GET', path: '/workspaces', scope: 'workspaces:read' },
  { controller: 'workspaces', method: 'POST', path: '/workspaces', scope: 'workspaces:write' },
  { controller: 'workspaces', method: 'GET', path: `/workspaces/${X}`, scope: 'workspaces:read' },
  { controller: 'workspaces', method: 'PATCH', path: `/workspaces/${X}`, scope: 'workspaces:write' },
  { controller: 'workspaces', method: 'DELETE', path: `/workspaces/${X}`, scope: 'workspaces:write' },
  { controller: 'workspaces', method: 'GET', path: `/workspaces/${X}/members`, scope: 'workspaces:read' },
  { controller: 'workspaces', method: 'POST', path: `/workspaces/${X}/members`, scope: 'workspaces:write' },
  { controller: 'workspaces', method: 'PATCH', path: `/workspaces/${X}/members/${X}`, scope: 'workspaces:write' },
  { controller: 'workspaces', method: 'DELETE', path: `/workspaces/${X}/members/${X}`, scope: 'workspaces:write' },
  { controller: 'workspaces', method: 'POST', path: `/workspaces/${X}/logo`, scope: 'workspaces:write' },
  { controller: 'workspaces', method: 'DELETE', path: `/workspaces/${X}/logo`, scope: 'workspaces:write' },
];

/**
 * Normalize a route path for structural comparison between the matrix
 * (which uses the literal dummy id `X` / a `?query=x` suffix) and a route
 * pattern reconstructed from Nest decorator metadata (which uses `:param`
 * placeholders and never has a query string). Strips query strings and
 * collapses any dynamic segment — `:id`-style or the literal dummy id — to
 * `*`, so `/projects/:projectId/github` and `/projects/nonexistent-id/github`
 * normalize to the same value.
 */
export function normalizeRoutePattern(path: string): string {
  const withoutQuery = path.split('?')[0];
  const segments = withoutQuery
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => (segment.startsWith(':') || segment === X ? '*' : segment));
  return '/' + segments.join('/');
}

/**
 * The canonical list of a project's settings groups — ONE list, consumed by
 * the rail, the routes and the e2e suite.
 *
 * It exists for the same reason `components/project/projectViews.ts` does: the
 * app used to disagree with itself about what it contained. Project settings
 * was nineteen sections in one unnavigable scroll with no list anywhere, so
 * "which settings does a project have" had no answer you could read — only a
 * 909-line file you could scroll. Adding a settings section now means adding
 * it to one group here.
 *
 * There is deliberately no Agents group. Agent access and agent context
 * are a daily surface, not configuration, and live on the project's own
 * Agents tab (`/projects/:id/agents`). They were promoted out of the
 * settings basement precisely because a structural differentiator buried
 * under the Gitea form is, to a new user, invisible. General carries a
 * pointer for anyone who still scrolls here out of habit.
 */
export interface SettingsGroup {
  /** Route segment under `/projects/:id/settings/`. */
  to: string;
  /** Rail label. */
  label: string;
  /** One line under the label, explaining what lives in the group. */
  description: string;
}

export const PROJECT_SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    to: 'general',
    label: 'General',
    description: 'Name, description, sharing and archiving.',
  },
  {
    to: 'people',
    label: 'People',
    description: 'Who can see and change this project.',
  },
  {
    to: 'work',
    label: 'Work structure',
    description: 'Columns, labels, components, versions, fields and workflow.',
  },
  {
    to: 'templates',
    label: 'Templates',
    description: 'Starting points for new issues and pages.',
  },
  {
    to: 'integrations',
    label: 'Integrations',
    description: 'GitHub, GitLab, Gitea and outgoing webhooks.',
  },
];

/**
 * Where a bare `/projects/:id/settings` lands. That URL is in the docs site,
 * the README, MCP output and every existing deep link, so it redirects here
 * rather than 404ing.
 */
export const DEFAULT_PROJECT_SETTINGS_GROUP = 'general';

/**
 * Tool registry for the Next Lane MCP server.
 *
 * Each tool pairs a zod input schema with a thin handler that calls the REST
 * client and returns the JSON result as text content. Tools are grouped into
 * read (safe, idempotent) and write (mutating SDLC + core entities).
 *
 * Route paths are taken verbatim from the Next Lane API controllers (the client
 * prepends the `/api` global prefix), so they must not be guessed here.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NextLaneClient } from '../client.js';

/**
 * Minimal structural view of McpServer.registerTool we rely on. Using this
 * avoids TS2589 ("type instantiation is excessively deep") that arises when the
 * SDK tries to infer a precise output type from each tool's raw zod shape — we
 * register tools in a loop with heterogeneous shapes, so the precise inference
 * is both unnecessary and pathological.
 */
interface ToolRegistrar {
  registerTool(
    name: string,
    config: { description: string; inputSchema: z.ZodRawShape },
    handler: (args: Record<string, unknown>) => Promise<ToolResult>,
  ): unknown;
}

/** MCP text-content tool result shape. */
interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/** Wrap any value as a pretty-printed JSON text result. */
function jsonResult(value: unknown): ToolResult {
  const text =
    value === null || value === undefined
      ? 'OK (no content)'
      : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

/**
 * Definition of one MCP tool. Kept framework-light so the same list can be
 * registered on a real McpServer and asserted in unit tests.
 */
export interface ToolDef {
  name: string;
  group: 'read' | 'write';
  description: string;
  /** Raw zod shape (object of zod schemas) used as the input schema. */
  inputSchema: z.ZodRawShape;
  /** Handler receives validated args and the API client. */
  handler: (args: Record<string, unknown>, client: NextLaneClient) => Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

const issueTypeEnum = z
  .enum(['TASK', 'BUG', 'STORY', 'EPIC', 'SUBTASK'])
  .describe('Issue type the rule/issue applies to.');

const priorityEnum = z.enum(['LOWEST', 'LOW', 'MEDIUM', 'HIGH', 'HIGHEST']);

const linkTypeEnum = z
  .enum([
    'BLOCKS',
    'BLOCKED_BY',
    'RELATES_TO',
    'DUPLICATES',
    'DUPLICATED_BY',
    'CLONES',
  ])
  .describe(
    'Relationship from the SOURCE issue to the TARGET, e.g. BLOCKS means the ' +
      'source blocks the target; BLOCKED_BY means the source is blocked by the ' +
      'target. The reverse link is maintained automatically.',
  );

const statusCategoryEnum = z
  .enum(['TODO', 'IN_PROGRESS', 'DONE'])
  .describe('Lifecycle category a status belongs to.');

const boardTypeEnum = z.enum(['KANBAN', 'SCRUM']).describe('Board type.');

const sprintStateEnum = z
  .enum(['PLANNED', 'ACTIVE', 'COMPLETED'])
  .describe('Sprint lifecycle state.');

const customFieldTypeEnum = z
  .enum(['TEXT', 'NUMBER', 'SELECT', 'MULTI_SELECT', 'DATE', 'CHECKBOX', 'URL'])
  .describe('Custom field data type (immutable once created).');

const automationTriggerEnum = z
  .enum(['ISSUE_CREATED', 'ISSUE_UPDATED', 'ISSUE_TRANSITIONED', 'ISSUE_COMMENTED'])
  .describe('Event that fires an automation rule.');

const automationActionSchema = z
  .object({
    type: z
      .enum(['ASSIGN', 'SET_PRIORITY', 'TRANSITION', 'ADD_LABEL', 'ADD_COMMENT', 'SET_CUSTOM_FIELD'])
      .describe('Action to perform when the rule matches.'),
    params: z
      .record(z.unknown())
      .describe(
        'Action parameters, shape depends on type — e.g. ASSIGN {assigneeId}, ' +
          'SET_PRIORITY {priority}, TRANSITION {statusId}, ADD_LABEL {labelId}, ' +
          'ADD_COMMENT {body}, SET_CUSTOM_FIELD {fieldId, value}.',
      ),
  })
  .describe('A single automation action.');

const templateEnum = z
  .enum(['simple', 'kanban', 'scrum', 'bug-triage'])
  .describe(
    "Workflow template: 'simple' (linear TODO→IN_PROGRESS→DONE), 'kanban' " +
      "(any→any), 'scrum' (linear + back-transitions), 'bug-triage' (linear + " +
      'reopen path).',
  );

const dashboardVisualizationEnum = z
  .enum(['STAT', 'TABLE', 'BREAKDOWN', 'BURNDOWN'])
  .describe(
    'STAT = single count; TABLE = compact issue list; BREAKDOWN = counts ' +
      "grouped by config.field; BURNDOWN = sprint burndown scoped to the " +
      'single sprint the query resolves to.',
  );

const dashboardGadgetConfigSchema = z
  .object({
    position: z.number().int().min(0).optional().describe('Grid order, lower renders earlier.'),
    size: z.number().int().min(1).max(2).optional().describe('Grid column span (1 or 2).'),
    field: z
      .string()
      .optional()
      .describe(
        'BREAKDOWN only (required): status/assignee/priority/type/label/component, ' +
          'or a custom SELECT field key.',
      ),
    columns: z
      .array(z.string())
      .optional()
      .describe('TABLE only: subset of key/title/status/assignee/points (default all).'),
    limit: z.number().int().min(1).max(50).optional().describe('TABLE only: max rows.'),
  })
  .describe('Visualization + grid-layout settings for a gadget.');

const gateSchema = z
  .object({
    type: z
      .enum(['REQUIRE_FIELD', 'REQUIRE_ASSIGNEE', 'REQUIRE_LINK'])
      .describe('Gate kind enforced before the transition is allowed.'),
    field: z
      .string()
      .optional()
      .describe('Field name — required when type is REQUIRE_FIELD.'),
    linkType: z
      .string()
      .optional()
      .describe('Link type — required when type is REQUIRE_LINK.'),
  })
  .describe('A single transition gate rule.');

const roleEnum = z
  .enum(['ADMIN', 'MEMBER', 'VIEWER'])
  .describe('ADMIN > MEMBER > VIEWER (workspace or per-project role).');

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

const readTools: ToolDef[] = [
  {
    name: 'list_projects',
    group: 'read',
    description:
      'List projects in a workspace. Provide workspaceId to scope the list. ' +
      'Use this first to discover projectId values for other tools.',
    inputSchema: {
      workspaceId: z
        .string()
        .describe('Workspace id to list projects for.'),
    },
    handler: (args, client) =>
      client
        .get('/projects', { workspaceId: args.workspaceId as string })
        .then(jsonResult),
  },
  {
    name: 'list_workspaces',
    group: 'read',
    description:
      'List all workspaces the authenticated token can access. Use to find a ' +
      'workspaceId for list_projects.',
    inputSchema: {},
    handler: (_args, client) => client.get('/workspaces').then(jsonResult),
  },
  {
    name: 'list_boards',
    group: 'read',
    description: 'List all boards for a project (kanban/scrum boards).',
    inputSchema: {
      projectId: z.string().describe('Project id to list boards for.'),
    },
    handler: (args, client) =>
      client.get(`/projects/${args.projectId}/boards`).then(jsonResult),
  },
  {
    name: 'list_statuses',
    group: 'read',
    description:
      'List the workflow statuses (columns) defined for a project. Status ids ' +
      'are needed to build workflow transitions and move issues.',
    inputSchema: {
      projectId: z.string().describe('Project id to list statuses for.'),
    },
    handler: (args, client) =>
      client.get(`/projects/${args.projectId}/statuses`).then(jsonResult),
  },
  {
    name: 'list_workflows',
    group: 'read',
    description:
      'List named workflows for a project, each with its transition and board ' +
      'counts. A workflow defines the allowed status transitions (the SDLC).',
    inputSchema: {
      projectId: z.string().describe('Project id to list workflows for.'),
    },
    handler: (args, client) =>
      client.get(`/projects/${args.projectId}/workflows`).then(jsonResult),
  },
  {
    name: 'get_workflow',
    group: 'read',
    description:
      'Get a single named workflow by id, including its full list of ' +
      'transitions (from/to status, issue type, gates).',
    inputSchema: {
      workflowId: z.string().describe('Workflow id.'),
    },
    handler: (args, client) =>
      client.get(`/workflows/${args.workflowId}`).then(jsonResult),
  },
  {
    name: 'list_issues',
    group: 'read',
    description:
      'List issues, optionally filtered by project, sprint, assignee, type, ' +
      'status, or a free-text query (q). Supports cursor pagination via ' +
      'cursor + limit.',
    inputSchema: {
      projectId: z.string().optional().describe('Filter by project id.'),
      sprintId: z.string().optional().describe('Filter by sprint id.'),
      assigneeId: z.string().optional().describe('Filter by assignee user id.'),
      type: z.string().optional().describe('Filter by issue type.'),
      statusId: z.string().optional().describe('Filter by status id.'),
      q: z.string().optional().describe('Free-text / NLQL search query.'),
      cursor: z.string().optional().describe('Pagination cursor from a prior page.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('Page size (1-200).'),
    },
    handler: (args, client) =>
      client
        .get('/issues', {
          projectId: args.projectId as string | undefined,
          sprintId: args.sprintId as string | undefined,
          assigneeId: args.assigneeId as string | undefined,
          type: args.type as string | undefined,
          statusId: args.statusId as string | undefined,
          q: args.q as string | undefined,
          cursor: args.cursor as string | undefined,
          limit: args.limit as number | undefined,
        })
        .then(jsonResult),
  },
  {
    name: 'get_issue',
    group: 'read',
    description: 'Get a single issue by id with its full detail.',
    inputSchema: {
      issueId: z.string().describe('Issue id.'),
    },
    handler: (args, client) =>
      client.get(`/issues/${args.issueId}`).then(jsonResult),
  },
  {
    name: 'list_issue_links',
    group: 'read',
    description:
      'List the typed links (dependencies / relations) for an issue, resolved ' +
      "from that issue's perspective — e.g. an issue it blocks, or is blocked " +
      'by. Each entry includes the link id (needed for unlink_issues).',
    inputSchema: {
      issueId: z.string().describe('Issue id to list links for.'),
    },
    handler: (args, client) =>
      client.get(`/issues/${args.issueId}/links`).then(jsonResult),
  },
  {
    name: 'list_labels',
    group: 'read',
    description:
      'List the labels defined in a project, with their ids and colors. Use ' +
      'this to find a labelId for add_issue_label / remove_issue_label.',
    inputSchema: {
      projectId: z.string().describe('Project id to list labels for.'),
    },
    handler: (args, client) =>
      client.get(`/projects/${args.projectId}/labels`).then(jsonResult),
  },
  {
    name: 'list_users',
    group: 'read',
    description:
      'List users the caller can see (workspace members). Use to find an ' +
      'assigneeId / default-assignee id for create_issue, update_issue, etc.',
    inputSchema: {},
    handler: (_args, client) => client.get('/users').then(jsonResult),
  },
  {
    name: 'search_issues',
    group: 'read',
    description:
      'Full-text search issues by title/key/description. Scope to one project ' +
      'with projectId, or omit it to search everything the caller can access.',
    inputSchema: {
      q: z.string().describe('Search text.'),
      projectId: z.string().optional().describe('Restrict to this project.'),
    },
    handler: (args, client) =>
      client
        .get('/search', { q: args.q as string, projectId: args.projectId as string | undefined })
        .then(jsonResult),
  },
  {
    name: 'list_sprints',
    group: 'read',
    description: 'List a project’s sprints (with state, dates, goal).',
    inputSchema: { projectId: z.string().describe('Project id.') },
    handler: (args, client) =>
      client.get(`/projects/${args.projectId}/sprints`).then(jsonResult),
  },
  {
    name: 'list_components',
    group: 'read',
    description: 'List a project’s components with their ids.',
    inputSchema: { projectId: z.string().describe('Project id.') },
    handler: (args, client) =>
      client.get(`/projects/${args.projectId}/components`).then(jsonResult),
  },
  {
    name: 'list_versions',
    group: 'read',
    description: 'List a project’s versions/releases with their ids and state.',
    inputSchema: { projectId: z.string().describe('Project id.') },
    handler: (args, client) =>
      client.get(`/projects/${args.projectId}/versions`).then(jsonResult),
  },
  {
    name: 'list_custom_fields',
    group: 'read',
    description:
      'List a project’s custom field definitions (key, name, type, options). ' +
      'Needed to set customFields on issues.',
    inputSchema: { projectId: z.string().describe('Project id.') },
    handler: (args, client) =>
      client.get(`/projects/${args.projectId}/custom-fields`).then(jsonResult),
  },
  {
    name: 'list_comments',
    group: 'read',
    description: 'List the comments on an issue (newest-relevant order).',
    inputSchema: { issueId: z.string().describe('Issue id.') },
    handler: (args, client) =>
      client.get(`/issues/${args.issueId}/comments`).then(jsonResult),
  },
  {
    name: 'list_worklogs',
    group: 'read',
    description: 'List the time-tracking work logs on an issue.',
    inputSchema: { issueId: z.string().describe('Issue id.') },
    handler: (args, client) =>
      client.get(`/issues/${args.issueId}/worklogs`).then(jsonResult),
  },
  {
    name: 'list_checklist',
    group: 'read',
    description: 'List an issue’s checklist items (with done state + ids).',
    inputSchema: { issueId: z.string().describe('Issue id.') },
    handler: (args, client) =>
      client.get(`/issues/${args.issueId}/checklist`).then(jsonResult),
  },
  {
    name: 'list_saved_filters',
    group: 'read',
    description: 'List a project’s saved NLQL filters (own + shared).',
    inputSchema: { projectId: z.string().describe('Project id.') },
    handler: (args, client) =>
      client.get(`/projects/${args.projectId}/saved-filters`).then(jsonResult),
  },
  {
    name: 'list_automations',
    group: 'read',
    description: 'List a project’s automation rules (trigger, condition, actions).',
    inputSchema: { projectId: z.string().describe('Project id.') },
    handler: (args, client) =>
      client.get(`/projects/${args.projectId}/automations`).then(jsonResult),
  },
  {
    name: 'list_issue_github_links',
    group: 'read',
    description:
      'List an issue’s linked GitHub pull requests / commits (populated by the ' +
      'push/PR webhook integration, if configured). Requires the `github:read` ' +
      'PAT scope when the token is scoped. Does not include the project’s ' +
      'webhook secret — configuring the integration itself is not exposed over ' +
      'MCP (admin-only, secret-bearing).',
    inputSchema: { issueId: z.string().describe('Issue id.') },
    handler: (args, client) =>
      client.get(`/issues/${args.issueId}/github-links`).then(jsonResult),
  },
  {
    name: 'list_quick_links',
    group: 'read',
    description: 'List the caller’s personal shortcut links (sidebar quick links), ordered.',
    inputSchema: {},
    handler: (_args, client) => client.get('/me/quick-links').then(jsonResult),
  },
  {
    name: 'get_personal_board',
    group: 'read',
    description:
      'Get the caller’s personal (non-project) board: columns in order, each ' +
      'with its cards in rank order. Three default columns ("To Do", "Doing", ' +
      '"Done") are created automatically on first access. Use this to find ' +
      'columnId/card ids for create_personal_card / update_personal_card.',
    inputSchema: {},
    handler: (_args, client) => client.get('/me/personal-board').then(jsonResult),
  },
  {
    name: 'list_issue_templates',
    group: 'read',
    description:
      'List a project’s issue templates (name, target issue type, default ' +
      'title/description/priority/assignee/component/labels). Use with ' +
      'create_issue_from_template.',
    inputSchema: { projectId: z.string().describe('Project id.') },
    handler: (args, client) =>
      client.get(`/projects/${args.projectId}/issue-templates`).then(jsonResult),
  },
  {
    name: 'get_project_analytics',
    group: 'read',
    description:
      'Team analytics for a project over a rolling day window (throughput, ' +
      'cycle time, workload by assignee). Defaults to 30 days.',
    inputSchema: {
      projectId: z.string().describe('Project id.'),
      days: z
        .number()
        .int()
        .min(1)
        .max(366)
        .optional()
        .describe('Rolling window size in days (default 30).'),
    },
    handler: (args, client) =>
      client
        .get(`/projects/${args.projectId}/analytics`, { days: args.days as number | undefined })
        .then(jsonResult),
  },
  {
    name: 'get_my_analytics',
    group: 'read',
    description:
      'Personal analytics for the caller (their own throughput/cycle time) ' +
      'over a rolling day window. Defaults to 30 days.',
    inputSchema: {
      days: z
        .number()
        .int()
        .min(1)
        .max(366)
        .optional()
        .describe('Rolling window size in days (default 30).'),
    },
    handler: (args, client) =>
      client.get('/me/analytics', { days: args.days as number | undefined }).then(jsonResult),
  },
  {
    name: 'get_velocity_report',
    group: 'read',
    description: 'Velocity report: committed vs completed story points per completed/active sprint.',
    inputSchema: { projectId: z.string().describe('Project id.') },
    handler: (args, client) =>
      client.get(`/projects/${args.projectId}/reports/velocity`).then(jsonResult),
  },
  {
    name: 'get_burndown_report',
    group: 'read',
    description: 'Burndown report: daily ideal vs remaining story points for one sprint.',
    inputSchema: {
      projectId: z.string().describe('Project id.'),
      sprintId: z.string().describe('Sprint id.'),
    },
    handler: (args, client) =>
      client
        .get(`/projects/${args.projectId}/sprints/${args.sprintId}/burndown`)
        .then(jsonResult),
  },
  {
    name: 'get_cfd_report',
    group: 'read',
    description:
      'Cumulative Flow Diagram: per-day count of issues in each status category ' +
      '(TODO / IN_PROGRESS / DONE) over a window. Defaults to 30 days.',
    inputSchema: {
      projectId: z.string().describe('Project id.'),
      days: z.number().int().optional().describe('Window size in days (default 30).'),
    },
    handler: (args, client) =>
      client
        .get(`/projects/${args.projectId}/reports/cfd`, { days: args.days as number | undefined })
        .then(jsonResult),
  },
  {
    name: 'list_notifications',
    group: 'read',
    description: 'List the caller’s notifications, newest first.',
    inputSchema: {},
    handler: (_args, client) => client.get('/notifications').then(jsonResult),
  },
  {
    name: 'get_unread_notification_count',
    group: 'read',
    description: 'Get the caller’s unread notification count.',
    inputSchema: {},
    handler: (_args, client) => client.get('/notifications/unread-count').then(jsonResult),
  },
  {
    name: 'get_project_csv',
    group: 'read',
    description:
      'Export a project’s issues as CSV text (same data as the web app’s ' +
      '"Export CSV" button). Optional NLQL `q` filter narrows the rows. The ' +
      'result is returned as raw CSV text, not JSON. Very large exports may be ' +
      'truncated by the API.',
    inputSchema: {
      projectId: z.string().describe('Project id to export.'),
      q: z.string().optional().describe('Optional NLQL filter query.'),
    },
    handler: async (args, client) => {
      const csv = await client.get<string>(`/projects/${args.projectId}/issues.csv`, {
        q: args.q as string | undefined,
      });
      return { content: [{ type: 'text' as const, text: String(csv) }] };
    },
  },
  {
    name: 'list_dashboards',
    group: 'read',
    description:
      'List a project’s configurable dashboards (id, name, order, gadget count).',
    inputSchema: {
      projectId: z.string().describe('Project id to list dashboards for.'),
    },
    handler: (args, client) =>
      client.get(`/projects/${args.projectId}/dashboards`).then(jsonResult),
  },
  {
    name: 'get_dashboard',
    group: 'read',
    description:
      'Get a dashboard with all of its gadgets (id, title, NLQL query, ' +
      'visualization, config), ordered by grid position.',
    inputSchema: { dashboardId: z.string().describe('Dashboard id.') },
    handler: (args, client) =>
      client.get(`/dashboards/${args.dashboardId}`).then(jsonResult),
  },
  {
    name: 'get_dashboard_data',
    group: 'read',
    description:
      'Evaluate every gadget on a dashboard server-side (filters the ' +
      'project’s issues through each gadget’s NLQL query, then shapes the ' +
      'result per visualization). A gadget with an invalid query or ' +
      'unresolvable config gets a per-gadget `error` field instead of data.',
    inputSchema: { dashboardId: z.string().describe('Dashboard id.') },
    handler: (args, client) =>
      client.get(`/dashboards/${args.dashboardId}/data`).then(jsonResult),
  },
  {
    name: 'list_project_role_overrides',
    group: 'read',
    description:
      'List a project’s EFFECTIVE members: every workspace member, each with ' +
      'their workspace role, their effective role on this project, and ' +
      'whether that role comes from a per-project override (`isOverride`). ' +
      'Use to find a userId for set_project_role_override / ' +
      'remove_project_role_override.',
    inputSchema: {
      projectId: z.string().describe('Project id to list effective members for.'),
    },
    handler: (args, client) =>
      client.get(`/projects/${args.projectId}/members`).then(jsonResult),
  },
];

// ---------------------------------------------------------------------------
// Write tools (SDLC focus)
// ---------------------------------------------------------------------------

const writeTools: ToolDef[] = [
  {
    name: 'create_workflow',
    group: 'write',
    description:
      'Create a new (empty) named workflow in a project. Add transitions ' +
      'afterwards with add_workflow_transition. Requires project ADMIN.',
    inputSchema: {
      projectId: z.string().describe('Project the workflow belongs to.'),
      name: z.string().min(1).max(120).describe('Workflow name.'),
      description: z.string().max(500).optional().describe('Optional description.'),
      enforced: z
        .boolean()
        .optional()
        .describe('When true, only defined transitions are allowed.'),
    },
    handler: (args, client) =>
      client
        .post(`/projects/${args.projectId}/workflows`, {
          name: args.name,
          description: args.description,
          enforced: args.enforced,
        })
        .then(jsonResult),
  },
  {
    name: 'create_workflow_from_template',
    group: 'write',
    description:
      'Create a named workflow pre-populated with transitions from a template ' +
      "('simple' | 'kanban' | 'scrum' | 'bug-triage'). Fastest way to stand " +
      'up an SDLC. Requires project ADMIN.',
    inputSchema: {
      projectId: z.string().describe('Project the workflow belongs to.'),
      template: templateEnum,
      name: z.string().min(1).max(120).optional().describe('Optional workflow name.'),
    },
    handler: (args, client) =>
      client
        .post(`/projects/${args.projectId}/workflows/from-template`, {
          template: args.template,
          name: args.name,
        })
        .then(jsonResult),
  },
  {
    name: 'update_workflow',
    group: 'write',
    description:
      'Update a named workflow’s name, description, and/or enforced flag. ' +
      'Requires project ADMIN.',
    inputSchema: {
      id: z.string().describe('Workflow id.'),
      name: z.string().min(1).max(120).optional(),
      description: z.string().max(500).optional(),
      enforced: z.boolean().optional(),
    },
    handler: (args, client) =>
      client
        .patch(`/workflows/${args.id}`, {
          name: args.name,
          description: args.description,
          enforced: args.enforced,
        })
        .then(jsonResult),
  },
  {
    name: 'delete_workflow',
    group: 'write',
    description:
      'Delete a named workflow. Its transitions cascade and any boards using ' +
      'it have their workflow cleared. Requires project ADMIN.',
    inputSchema: {
      id: z.string().describe('Workflow id.'),
    },
    handler: (args, client) =>
      client.delete(`/workflows/${args.id}`).then(jsonResult),
  },
  {
    name: 'add_workflow_transition',
    group: 'write',
    description:
      'Add a transition to a named workflow. fromStatusId null means “from any ' +
      'status” (wildcard). Optionally scope to an issueType and attach gates. ' +
      'Requires project ADMIN.',
    inputSchema: {
      workflowId: z.string().describe('Workflow to add the transition to.'),
      fromStatusId: z
        .string()
        .nullable()
        .optional()
        .describe('Source status id, or null/omit for “from any status”.'),
      toStatusId: z.string().describe('Destination status id.'),
      issueType: issueTypeEnum
        .nullable()
        .optional()
        .describe('Restrict to this issue type, or null for all types.'),
      name: z.string().optional().describe('Optional transition label (e.g. “Start Work”).'),
      gates: z.array(gateSchema).optional().describe('Ordered gate rules.'),
    },
    handler: (args, client) =>
      client
        .post(`/workflows/${args.workflowId}/transitions`, {
          fromStatusId: args.fromStatusId,
          toStatusId: args.toStatusId,
          issueType: args.issueType,
          name: args.name,
          gates: args.gates,
        })
        .then(jsonResult),
  },
  {
    name: 'update_workflow_transition',
    group: 'write',
    description:
      'Update a workflow-scoped transition (from/to status, issue type, name, ' +
      'gates). Requires project ADMIN.',
    inputSchema: {
      id: z.string().describe('Transition id.'),
      fromStatusId: z.string().nullable().optional(),
      toStatusId: z.string().optional(),
      issueType: issueTypeEnum.nullable().optional(),
      name: z.string().optional(),
      gates: z.array(gateSchema).optional(),
    },
    handler: (args, client) =>
      client
        .patch(`/workflow-transitions/${args.id}`, {
          fromStatusId: args.fromStatusId,
          toStatusId: args.toStatusId,
          issueType: args.issueType,
          name: args.name,
          gates: args.gates,
        })
        .then(jsonResult),
  },
  {
    name: 'delete_workflow_transition',
    group: 'write',
    description: 'Delete a workflow-scoped transition. Requires project ADMIN.',
    inputSchema: {
      id: z.string().describe('Transition id.'),
    },
    handler: (args, client) =>
      client.delete(`/workflow-transitions/${args.id}`).then(jsonResult),
  },
  {
    name: 'assign_board_workflow',
    group: 'write',
    description:
      'Assign a named workflow to a board (or pass workflowId null to detach). ' +
      'When the board’s workflow is enforced, issue moves on that board respect ' +
      'its transitions. Requires board ADMIN/MEMBER.',
    inputSchema: {
      boardId: z.string().describe('Board id.'),
      workflowId: z
        .string()
        .nullable()
        .describe('Workflow id to assign, or null to clear.'),
    },
    handler: (args, client) =>
      client
        .patch(`/boards/${args.boardId}`, { workflowId: args.workflowId })
        .then(jsonResult),
  },
  {
    name: 'create_issue',
    group: 'write',
    description:
      'Create an issue in a project. Only projectId and title are required; ' +
      'the rest are optional.',
    inputSchema: {
      projectId: z.string().describe('Project to create the issue in.'),
      title: z.string().min(1).max(300).describe('Issue title.'),
      type: issueTypeEnum.optional().describe('Issue type (default TASK).'),
      description: z.string().max(50000).optional(),
      statusId: z.string().optional().describe('Initial status id.'),
      assigneeId: z.string().optional(),
      priority: priorityEnum.optional(),
      parentId: z.string().optional().describe('Parent issue id (for subtasks).'),
      sprintId: z.string().optional(),
      storyPoints: z.number().int().min(0).max(999).optional(),
      dueDate: z.string().optional().describe('ISO-8601 date string.'),
      componentId: z.string().optional(),
      originalEstimateMinutes: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Original time-tracking estimate, in minutes.'),
      customFields: z
        .record(z.unknown())
        .optional()
        .describe('Custom field values keyed by field id (from list_custom_fields).'),
    },
    handler: (args, client) =>
      client
        .post('/issues', {
          projectId: args.projectId,
          title: args.title,
          type: args.type,
          description: args.description,
          statusId: args.statusId,
          assigneeId: args.assigneeId,
          priority: args.priority,
          parentId: args.parentId,
          sprintId: args.sprintId,
          storyPoints: args.storyPoints,
          dueDate: args.dueDate,
          componentId: args.componentId,
          originalEstimateMinutes: args.originalEstimateMinutes,
          customFields: args.customFields,
        })
        .then(jsonResult),
  },
  {
    name: 'update_issue',
    group: 'write',
    description:
      'Update fields on an existing issue. Only the fields you pass are changed ' +
      '(partial update). Use parentId to re-parent an issue (e.g. attach a ' +
      'subtask to an epic/story) or pass parentId:null to unparent it; the same ' +
      'null-to-clear rule applies to assigneeId, sprintId, componentId, ' +
      'storyPoints, dueDate, and originalEstimateMinutes. To change status use ' +
      'move_issue (it can apply workflow rules); to link issues use link_issues.',
    inputSchema: {
      issueId: z.string().describe('Issue id to update.'),
      parentId: z
        .string()
        .nullable()
        .optional()
        .describe(
          'New parent issue id, or null to detach from the current parent. Omit to leave unchanged.',
        ),
      title: z.string().min(1).max(300).optional(),
      type: issueTypeEnum.optional(),
      description: z.string().max(50000).optional(),
      priority: priorityEnum.optional(),
      assigneeId: z
        .string()
        .nullable()
        .optional()
        .describe('Assignee user id, or null to unassign.'),
      sprintId: z
        .string()
        .nullable()
        .optional()
        .describe('Sprint id, or null to remove from sprint.'),
      componentId: z
        .string()
        .nullable()
        .optional()
        .describe('Component id, or null to clear.'),
      storyPoints: z
        .number()
        .int()
        .min(0)
        .max(999)
        .nullable()
        .optional()
        .describe('Story points, or null to clear.'),
      dueDate: z
        .string()
        .nullable()
        .optional()
        .describe('ISO-8601 date string, or null to clear.'),
      customFields: z
        .record(z.unknown())
        .optional()
        .describe(
          'Partial custom-field update keyed by field id (from ' +
            'list_custom_fields): only the keys present are changed; set a key to ' +
            'null to clear that field.',
        ),
      originalEstimateMinutes: z
        .number()
        .int()
        .min(0)
        .nullable()
        .optional()
        .describe('Original time-tracking estimate in minutes, or null to clear it.'),
    },
    handler: (args, client) =>
      client
        .patch(`/issues/${args.issueId}`, {
          parentId: args.parentId,
          title: args.title,
          type: args.type,
          description: args.description,
          priority: args.priority,
          assigneeId: args.assigneeId,
          sprintId: args.sprintId,
          componentId: args.componentId,
          storyPoints: args.storyPoints,
          dueDate: args.dueDate,
          customFields: args.customFields,
          originalEstimateMinutes: args.originalEstimateMinutes,
        })
        .then(jsonResult),
  },
  {
    name: 'set_issue_parent',
    group: 'write',
    description:
      'Set or clear an issue’s parent — a focused shortcut for the most common ' +
      're-parenting case (e.g. nest a subtask under a story, or a story under ' +
      'an epic). Pass parentId to attach, or parentId:null to detach. Both ' +
      'issues must be in the same project. (update_issue can do this too, ' +
      'alongside other fields.)',
    inputSchema: {
      issueId: z.string().describe('The child issue id to re-parent.'),
      parentId: z
        .string()
        .nullable()
        .describe('The new parent issue id, or null to remove the parent.'),
    },
    handler: (args, client) =>
      client
        .patch(`/issues/${args.issueId}`, { parentId: args.parentId })
        .then(jsonResult),
  },
  {
    name: 'move_issue',
    group: 'write',
    description:
      'Move an issue to a different status. Pass boardId to apply that board’s ' +
      'enforced workflow rules; omit it for a plain status change.',
    inputSchema: {
      issueId: z.string().describe('Issue id to move.'),
      statusId: z.string().describe('Destination status id.'),
      boardId: z
        .string()
        .optional()
        .describe('Board context for workflow-enforced moves.'),
    },
    handler: (args, client) =>
      client
        .post(`/issues/${args.issueId}/move`, {
          statusId: args.statusId,
          boardId: args.boardId,
        })
        .then(jsonResult),
  },
  {
    name: 'link_issues',
    group: 'write',
    description:
      'Create a typed dependency/relation from a source issue to a target ' +
      "issue — e.g. type BLOCKS to mark that the source blocks the target, or " +
      'BLOCKED_BY for the reverse. The target may be an issue key (e.g. "NL-5") ' +
      'or an id; both issues must be in the same project. Requires MEMBER+.',
    inputSchema: {
      issueId: z.string().describe('Source issue id (the link is from this issue).'),
      target: z
        .string()
        .describe('Target issue: a key like "NL-5" or an issue id.'),
      type: linkTypeEnum,
    },
    handler: (args, client) =>
      client
        .post(`/issues/${args.issueId}/links`, {
          target: args.target,
          type: args.type,
        })
        .then(jsonResult),
  },
  {
    name: 'unlink_issues',
    group: 'write',
    description:
      'Delete an issue link by its link id (get it from list_issue_links). The ' +
      'reverse link is removed automatically. Requires MEMBER+.',
    inputSchema: {
      linkId: z.string().describe('Issue-link id to delete.'),
    },
    handler: (args, client) =>
      client.delete(`/issue-links/${args.linkId}`).then(jsonResult),
  },
  {
    name: 'create_label',
    group: 'write',
    description:
      'Create a label in a project (name + optional hex color). Returns the new ' +
      'label including its id, which add_issue_label needs. Requires MEMBER+.',
    inputSchema: {
      projectId: z.string().describe('Project the label belongs to.'),
      name: z.string().min(1).max(50).describe('Label name.'),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional()
        .describe('Optional 6-digit hex color, e.g. #ef4444.'),
    },
    handler: (args, client) =>
      client
        .post(`/projects/${args.projectId}/labels`, {
          name: args.name,
          color: args.color,
        })
        .then(jsonResult),
  },
  {
    name: 'add_issue_label',
    group: 'write',
    description:
      'Attach an existing label to an issue. Find the labelId with list_labels ' +
      '(or create_label first). Requires MEMBER+.',
    inputSchema: {
      issueId: z.string().describe('Issue to label.'),
      labelId: z.string().describe('Label id to attach.'),
    },
    handler: (args, client) =>
      client
        .post(`/issues/${args.issueId}/labels`, { labelId: args.labelId })
        .then(jsonResult),
  },
  {
    name: 'remove_issue_label',
    group: 'write',
    description:
      'Remove a label from an issue (issueId + labelId). Requires MEMBER+.',
    inputSchema: {
      issueId: z.string().describe('Issue to unlabel.'),
      labelId: z.string().describe('Label id to remove.'),
    },
    handler: (args, client) =>
      client
        .delete(`/issues/${args.issueId}/labels/${args.labelId}`)
        .then(jsonResult),
  },
  {
    name: 'add_comment',
    group: 'write',
    description:
      'Add a comment to an issue (markdown supported). Requires MEMBER+.',
    inputSchema: {
      issueId: z.string().describe('Issue to comment on.'),
      body: z.string().min(1).max(10000).describe('Comment body (markdown).'),
    },
    handler: (args, client) =>
      client
        .post(`/issues/${args.issueId}/comments`, { body: args.body })
        .then(jsonResult),
  },
  {
    name: 'delete_issue',
    group: 'write',
    description: 'Delete an issue permanently. Requires MEMBER+. Irreversible.',
    inputSchema: { issueId: z.string().describe('Issue id to delete.') },
    handler: (args, client) =>
      client.delete(`/issues/${args.issueId}`).then(jsonResult),
  },
  {
    name: 'create_sprint',
    group: 'write',
    description: 'Create a sprint in a project. Requires MEMBER+.',
    inputSchema: {
      projectId: z.string().describe('Project the sprint belongs to.'),
      name: z.string().min(1).max(120).describe('Sprint name.'),
      goal: z.string().max(500).optional(),
      startDate: z.string().optional().describe('ISO-8601 date.'),
      endDate: z.string().optional().describe('ISO-8601 date.'),
    },
    handler: (args, client) =>
      client
        .post(`/projects/${args.projectId}/sprints`, {
          name: args.name,
          goal: args.goal,
          startDate: args.startDate,
          endDate: args.endDate,
        })
        .then(jsonResult),
  },
  {
    name: 'update_sprint',
    group: 'write',
    description:
      'Update a sprint — rename, change dates/goal, or set state (PLANNED → ' +
      'ACTIVE to start, ACTIVE → COMPLETED to close). Requires MEMBER+.',
    inputSchema: {
      sprintId: z.string().describe('Sprint id.'),
      name: z.string().min(1).max(120).optional(),
      goal: z.string().max(500).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      state: sprintStateEnum.optional(),
    },
    handler: (args, client) =>
      client
        .patch(`/sprints/${args.sprintId}`, {
          name: args.name,
          goal: args.goal,
          startDate: args.startDate,
          endDate: args.endDate,
          state: args.state,
        })
        .then(jsonResult),
  },
  {
    name: 'create_component',
    group: 'write',
    description: 'Create a project component. Requires MEMBER+.',
    inputSchema: {
      projectId: z.string().describe('Project id.'),
      name: z.string().min(1).max(100).describe('Component name.'),
      description: z.string().optional(),
      defaultAssigneeId: z
        .string()
        .nullable()
        .optional()
        .describe('Default assignee user id, or null.'),
    },
    handler: (args, client) =>
      client
        .post(`/projects/${args.projectId}/components`, {
          name: args.name,
          description: args.description,
          defaultAssigneeId: args.defaultAssigneeId,
        })
        .then(jsonResult),
  },
  {
    name: 'create_version',
    group: 'write',
    description: 'Create a project version/release. Requires MEMBER+.',
    inputSchema: {
      projectId: z.string().describe('Project id.'),
      name: z.string().min(1).describe('Version name, e.g. v1.2.0.'),
      description: z.string().nullable().optional(),
      releaseDate: z.string().nullable().optional().describe('ISO-8601 date.'),
    },
    handler: (args, client) =>
      client
        .post(`/projects/${args.projectId}/versions`, {
          name: args.name,
          description: args.description,
          releaseDate: args.releaseDate,
        })
        .then(jsonResult),
  },
  {
    name: 'set_issue_versions',
    group: 'write',
    description:
      "Set the full list of versions (fix-versions) on an issue, replacing any " +
      'existing. Pass an empty array to clear. Requires MEMBER+.',
    inputSchema: {
      issueId: z.string().describe('Issue id.'),
      versionIds: z.array(z.string()).describe('Version ids to set (replaces all).'),
    },
    handler: (args, client) =>
      client
        .put(`/issues/${args.issueId}/versions`, { versionIds: args.versionIds })
        .then(jsonResult),
  },
  {
    name: 'add_worklog',
    group: 'write',
    description: 'Log time spent on an issue. Requires MEMBER+.',
    inputSchema: {
      issueId: z.string().describe('Issue id.'),
      minutes: z.number().int().min(1).describe('Minutes spent.'),
      note: z.string().max(2000).optional(),
      workedAt: z.string().optional().describe('ISO-8601 datetime; defaults to now.'),
    },
    handler: (args, client) =>
      client
        .post(`/issues/${args.issueId}/worklogs`, {
          minutes: args.minutes,
          note: args.note,
          workedAt: args.workedAt,
        })
        .then(jsonResult),
  },
  {
    name: 'add_checklist_item',
    group: 'write',
    description: 'Add a checklist item to an issue. Requires MEMBER+.',
    inputSchema: {
      issueId: z.string().describe('Issue id.'),
      text: z.string().min(1).max(2000).describe('Checklist item text.'),
    },
    handler: (args, client) =>
      client
        .post(`/issues/${args.issueId}/checklist`, { text: args.text })
        .then(jsonResult),
  },
  {
    name: 'update_checklist_item',
    group: 'write',
    description:
      'Update a checklist item — rename and/or toggle done. Requires MEMBER+.',
    inputSchema: {
      itemId: z.string().describe('Checklist item id (from list_checklist).'),
      text: z.string().min(1).max(2000).optional(),
      done: z.boolean().optional().describe('Mark complete/incomplete.'),
    },
    handler: (args, client) =>
      client
        .patch(`/checklist/${args.itemId}`, { text: args.text, done: args.done })
        .then(jsonResult),
  },
  {
    name: 'create_status',
    group: 'write',
    description:
      'Create a workflow status (column) in a project. Requires project ADMIN.',
    inputSchema: {
      projectId: z.string().describe('Project id.'),
      name: z.string().min(1).max(60).describe('Status name.'),
      category: statusCategoryEnum,
      order: z.number().int().optional(),
      wipLimit: z.number().int().min(1).nullable().optional(),
    },
    handler: (args, client) =>
      client
        .post(`/projects/${args.projectId}/statuses`, {
          name: args.name,
          category: args.category,
          order: args.order,
          wipLimit: args.wipLimit,
        })
        .then(jsonResult),
  },
  {
    name: 'update_status',
    group: 'write',
    description:
      'Update a status — name, category, order, or WIP limit (null clears). ' +
      'Requires project ADMIN.',
    inputSchema: {
      statusId: z.string().describe('Status id.'),
      name: z.string().min(1).max(60).optional(),
      category: statusCategoryEnum.optional(),
      order: z.number().int().optional(),
      wipLimit: z.number().int().min(1).nullable().optional(),
    },
    handler: (args, client) =>
      client
        .patch(`/statuses/${args.statusId}`, {
          name: args.name,
          category: args.category,
          order: args.order,
          wipLimit: args.wipLimit,
        })
        .then(jsonResult),
  },
  {
    name: 'create_board',
    group: 'write',
    description: 'Create a board in a project. Requires MEMBER+.',
    inputSchema: {
      projectId: z.string().describe('Project id.'),
      name: z.string().min(1).max(80).describe('Board name.'),
      type: boardTypeEnum,
    },
    handler: (args, client) =>
      client
        .post(`/projects/${args.projectId}/boards`, { name: args.name, type: args.type })
        .then(jsonResult),
  },
  {
    name: 'update_board',
    group: 'write',
    description:
      'Update a board — rename, change type, set its default NLQL filter ' +
      '(filterQuery; null clears so the board shows everything), or set its ' +
      'default swimlane grouping (defaultGroupBy; applied when a link to the ' +
      "board doesn't include its own ?group= override — one of " +
      '"assignee" | "priority" | "type" | "epic" | "component" | "sprint" | ' +
      '"label", or "cf:<customFieldId>" for a project SELECT custom field; ' +
      'null clears it). Requires MEMBER+. (Use assign_board_workflow for the workflow.)',
    inputSchema: {
      boardId: z.string().describe('Board id.'),
      name: z.string().min(1).max(80).optional(),
      type: boardTypeEnum.optional(),
      filterQuery: z
        .string()
        .nullable()
        .optional()
        .describe('Default board-scope NLQL, or null to clear.'),
      defaultGroupBy: z
        .string()
        .nullable()
        .optional()
        .describe(
          'Default swimlane group-by dimension (core key or "cf:<id>"), or null to clear.',
        ),
    },
    handler: (args, client) =>
      client
        .patch(`/boards/${args.boardId}`, {
          name: args.name,
          type: args.type,
          filterQuery: args.filterQuery,
          defaultGroupBy: args.defaultGroupBy,
        })
        .then(jsonResult),
  },
  {
    name: 'create_saved_filter',
    group: 'write',
    description:
      'Save a reusable NLQL filter on a project (optionally shared with the ' +
      'team). Requires MEMBER+.',
    inputSchema: {
      projectId: z.string().describe('Project id.'),
      name: z.string().min(1).max(80).describe('Filter name.'),
      query: z.string().describe('NLQL query string.'),
      shared: z.boolean().optional().describe('Share with the whole project.'),
    },
    handler: (args, client) =>
      client
        .post(`/projects/${args.projectId}/saved-filters`, {
          name: args.name,
          query: args.query,
          shared: args.shared,
        })
        .then(jsonResult),
  },
  {
    name: 'create_custom_field',
    group: 'write',
    description:
      'Create a project custom field definition. type is immutable. SELECT / ' +
      'MULTI_SELECT need options. Requires project ADMIN.',
    inputSchema: {
      projectId: z.string().describe('Project id.'),
      name: z.string().min(1).max(60).describe('Field name.'),
      type: customFieldTypeEnum,
      options: z
        .array(z.string())
        .optional()
        .describe('Allowed values for SELECT / MULTI_SELECT.'),
      appliesToTypes: z
        .array(issueTypeEnum)
        .optional()
        .describe('Restrict to these issue types (omit = all).'),
      required: z.boolean().optional(),
    },
    handler: (args, client) =>
      client
        .post(`/projects/${args.projectId}/custom-fields`, {
          name: args.name,
          type: args.type,
          options: args.options,
          appliesToTypes: args.appliesToTypes,
          required: args.required,
        })
        .then(jsonResult),
  },
  {
    name: 'create_automation',
    group: 'write',
    description:
      'Create an automation rule (trigger → optional NLQL condition → actions). ' +
      'Requires project ADMIN.',
    inputSchema: {
      projectId: z.string().describe('Project id.'),
      name: z.string().min(1).describe('Rule name.'),
      trigger: automationTriggerEnum,
      actions: z.array(automationActionSchema).describe('Ordered actions to run.'),
      description: z.string().optional(),
      condition: z
        .string()
        .nullable()
        .optional()
        .describe('NLQL condition the issue must match (omit = always).'),
      enabled: z.boolean().optional().describe('Default true.'),
      order: z.number().int().optional(),
    },
    handler: (args, client) =>
      client
        .post(`/projects/${args.projectId}/automations`, {
          name: args.name,
          trigger: args.trigger,
          actions: args.actions,
          description: args.description,
          condition: args.condition,
          enabled: args.enabled,
          order: args.order,
        })
        .then(jsonResult),
  },
  {
    name: 'create_quick_link',
    group: 'write',
    description: 'Add a personal shortcut link (shown in the caller’s sidebar quick-links menu).',
    inputSchema: {
      label: z.string().min(1).max(60).describe('Shortcut label.'),
      url: z.string().max(2048).describe('Target http(s) URL.'),
      color: z
        .string()
        .nullable()
        .optional()
        .describe('Hex accent color (#rrggbb), or null/omit for none.'),
      group: z
        .string()
        .max(40)
        .nullable()
        .optional()
        .describe('Free-text group name, or null/omit for ungrouped.'),
    },
    handler: (args, client) =>
      client
        .post('/me/quick-links', {
          label: args.label,
          url: args.url,
          color: args.color,
          group: args.group,
        })
        .then(jsonResult),
  },
  {
    name: 'update_quick_link',
    group: 'write',
    description: 'Rename, re-point, recolor, regroup, or reorder a personal quick link.',
    inputSchema: {
      id: z.string().describe('Quick link id.'),
      label: z.string().min(1).max(60).optional(),
      url: z.string().max(2048).optional(),
      color: z.string().nullable().optional().describe('Hex accent color, or null to clear.'),
      group: z.string().max(40).nullable().optional().describe('Group name, or null to clear.'),
      order: z.number().int().min(0).optional().describe('Sort position among the caller’s quick links.'),
    },
    handler: (args, client) =>
      client
        .patch(`/me/quick-links/${args.id}`, {
          label: args.label,
          url: args.url,
          color: args.color,
          group: args.group,
          order: args.order,
        })
        .then(jsonResult),
  },
  {
    name: 'delete_quick_link',
    group: 'write',
    description: 'Remove a personal quick link.',
    inputSchema: { id: z.string().describe('Quick link id.') },
    handler: (args, client) => client.delete(`/me/quick-links/${args.id}`).then(jsonResult),
  },
  {
    name: 'create_personal_card',
    group: 'write',
    description:
      'Add a card to a column on the caller’s personal (non-project) board. ' +
      'Use get_personal_board to find a columnId.',
    inputSchema: {
      columnId: z.string().describe('Destination column id.'),
      title: z.string().min(1).max(300),
      notes: z.string().max(50000).optional(),
      color: z.string().nullable().optional().describe('Hex accent color, or null/omit for none.'),
      dueDate: z.string().nullable().optional().describe('ISO-8601 date string, or null/omit for none.'),
    },
    handler: (args, client) =>
      client
        .post('/me/personal-cards', {
          columnId: args.columnId,
          title: args.title,
          notes: args.notes,
          color: args.color,
          dueDate: args.dueDate,
        })
        .then(jsonResult),
  },
  {
    name: 'update_personal_card',
    group: 'write',
    description:
      'Edit and/or move a personal board card. To move it, pass columnId (the ' +
      'destination column) plus beforeId/afterId — the neighbor cards in that ' +
      'column used to compute the card’s new rank (omit both to place it at the ' +
      'end). Other fields (title, notes, color, dueDate) are a partial update.',
    inputSchema: {
      id: z.string().describe('Card id.'),
      title: z.string().min(1).max(300).optional(),
      notes: z.string().max(50000).nullable().optional().describe('Card notes, or null to clear.'),
      color: z.string().nullable().optional().describe('Hex accent color, or null to clear.'),
      dueDate: z.string().nullable().optional().describe('ISO-8601 date string, or null to clear.'),
      columnId: z.string().optional().describe('Move the card to this column.'),
      beforeId: z
        .string()
        .optional()
        .describe('Neighbor card that should come immediately before this one after the move.'),
      afterId: z
        .string()
        .optional()
        .describe('Neighbor card that should come immediately after this one after the move.'),
    },
    handler: (args, client) =>
      client
        .patch(`/me/personal-cards/${args.id}`, {
          title: args.title,
          notes: args.notes,
          color: args.color,
          dueDate: args.dueDate,
          columnId: args.columnId,
          beforeId: args.beforeId,
          afterId: args.afterId,
        })
        .then(jsonResult),
  },
  {
    name: 'create_issue_from_template',
    group: 'write',
    description:
      'Create an issue from an issue template (list_issue_templates for the ' +
      'id). Any field passed here overrides that template’s default; the ' +
      'resolved title must end up non-empty (from the override or the ' +
      'template’s titleTemplate) or the API rejects the request.',
    inputSchema: {
      templateId: z.string().describe('Issue template id.'),
      title: z.string().min(1).max(300).optional(),
      description: z.string().max(50000).optional(),
      assigneeId: z.string().nullable().optional().describe('Overrides the template default, or null to force unassigned.'),
      componentId: z.string().nullable().optional().describe('Overrides the template default, or null to force none.'),
      priority: priorityEnum.optional(),
      statusId: z.string().optional().describe('Initial status id (defaults to the project default).'),
      sprintId: z.string().optional(),
      labelIds: z.array(z.string()).optional().describe('Overrides the template’s default labels.'),
    },
    handler: (args, client) =>
      client
        .post(`/issue-templates/${args.templateId}/create-issue`, {
          title: args.title,
          description: args.description,
          assigneeId: args.assigneeId,
          componentId: args.componentId,
          priority: args.priority,
          statusId: args.statusId,
          sprintId: args.sprintId,
          labelIds: args.labelIds,
        })
        .then(jsonResult),
  },
  {
    name: 'bulk_update_issues',
    group: 'write',
    description:
      'Apply the same change to up to 100 issues at once: status, assignee, ' +
      'priority, sprint, type, and/or attach a label. Returns ' +
      '{ updated, failed } where failed lists any ids that could not be ' +
      'changed and why (not found, insufficient permissions, etc). At least ' +
      'one change field must be set.',
    inputSchema: {
      ids: z.array(z.string()).min(1).max(100).describe('Issue ids to update (1-100).'),
      statusId: z.string().optional(),
      assigneeId: z.string().nullable().optional().describe('null clears the assignee.'),
      priority: priorityEnum.optional(),
      sprintId: z.string().nullable().optional().describe('null removes the issue from its sprint.'),
      type: issueTypeEnum.optional(),
      addLabelIds: z
        .array(z.string())
        .optional()
        .describe('Label ids to attach to every matching issue (idempotent).'),
    },
    handler: (args, client) =>
      client
        .post('/issues/bulk', {
          ids: args.ids,
          changes: {
            statusId: args.statusId,
            assigneeId: args.assigneeId,
            priority: args.priority,
            sprintId: args.sprintId,
            type: args.type,
            addLabelIds: args.addLabelIds,
          },
        })
        .then(jsonResult),
  },
  {
    name: 'mark_notification_read',
    group: 'write',
    description: 'Mark one of the caller’s notifications as read.',
    inputSchema: { id: z.string().describe('Notification id.') },
    handler: (args, client) => client.post(`/notifications/${args.id}/read`).then(jsonResult),
  },
  {
    name: 'mark_all_notifications_read',
    group: 'write',
    description: 'Mark all of the caller’s notifications as read.',
    inputSchema: {},
    handler: (_args, client) => client.post('/notifications/read-all').then(jsonResult),
  },
  {
    name: 'create_dashboard',
    group: 'write',
    description:
      'Create a dashboard in a project (a per-project view holding NLQL-native ' +
      'gadgets). Requires project MEMBER+.',
    inputSchema: {
      projectId: z.string().describe('Project the dashboard belongs to.'),
      name: z.string().min(1).max(80).describe('Dashboard name.'),
    },
    handler: (args, client) =>
      client
        .post(`/projects/${args.projectId}/dashboards`, { name: args.name })
        .then(jsonResult),
  },
  {
    name: 'update_dashboard',
    group: 'write',
    description: 'Rename a dashboard and/or change its display order. Requires project MEMBER+.',
    inputSchema: {
      id: z.string().describe('Dashboard id.'),
      name: z.string().min(1).max(80).optional(),
      order: z.number().int().min(0).optional(),
    },
    handler: (args, client) =>
      client
        .patch(`/dashboards/${args.id}`, { name: args.name, order: args.order })
        .then(jsonResult),
  },
  {
    name: 'delete_dashboard',
    group: 'write',
    description: 'Delete a dashboard. Its gadgets cascade. Requires project MEMBER+.',
    inputSchema: { id: z.string().describe('Dashboard id.') },
    handler: (args, client) => client.delete(`/dashboards/${args.id}`).then(jsonResult),
  },
  {
    name: 'create_dashboard_gadget',
    group: 'write',
    description:
      'Add a gadget to a dashboard: an NLQL `query` (empty string matches ' +
      'every issue in the project) rendered as `visualization`. BREAKDOWN ' +
      'gadgets require `config.field`. Requires project MEMBER+.',
    inputSchema: {
      dashboardId: z.string().describe('Dashboard to add the gadget to.'),
      title: z.string().min(1).max(120).describe('Gadget title.'),
      query: z.string().max(2000).describe('NLQL query; empty string = all issues.'),
      visualization: dashboardVisualizationEnum,
      config: dashboardGadgetConfigSchema.optional(),
    },
    handler: (args, client) =>
      client
        .post(`/dashboards/${args.dashboardId}/gadgets`, {
          title: args.title,
          query: args.query,
          visualization: args.visualization,
          config: args.config,
        })
        .then(jsonResult),
  },
  {
    name: 'update_dashboard_gadget',
    group: 'write',
    description:
      'Update a gadget’s title, NLQL query, visualization, and/or config ' +
      '(config is merged with the existing value, not replaced). Requires ' +
      'project MEMBER+.',
    inputSchema: {
      id: z.string().describe('Gadget id.'),
      title: z.string().min(1).max(120).optional(),
      query: z.string().max(2000).optional(),
      visualization: dashboardVisualizationEnum.optional(),
      config: dashboardGadgetConfigSchema.optional(),
    },
    handler: (args, client) =>
      client
        .patch(`/gadgets/${args.id}`, {
          title: args.title,
          query: args.query,
          visualization: args.visualization,
          config: args.config,
        })
        .then(jsonResult),
  },
  {
    name: 'delete_dashboard_gadget',
    group: 'write',
    description: 'Delete a gadget from a dashboard. Requires project MEMBER+.',
    inputSchema: { id: z.string().describe('Gadget id.') },
    handler: (args, client) => client.delete(`/gadgets/${args.id}`).then(jsonResult),
  },
  {
    name: 'set_project_role_override',
    group: 'write',
    description:
      'Set (create or replace) a per-project role override for a workspace ' +
      'member — e.g. elevate a MEMBER to project ADMIN, or restrict them to ' +
      'project VIEWER, scoped to this project only. Requires EFFECTIVE ' +
      'project ADMIN (a project override can itself grant this, not just ' +
      'workspace ADMIN). Refuses to override a workspace ADMIN (they always ' +
      'have full access).',
    inputSchema: {
      projectId: z.string().describe('Project id.'),
      userId: z.string().describe('Target user id (must be a member of the project’s workspace).'),
      role: roleEnum,
    },
    handler: (args, client) =>
      client
        .put(`/projects/${args.projectId}/members/${args.userId}/role`, {
          role: args.role,
        })
        .then(jsonResult),
  },
  {
    name: 'remove_project_role_override',
    group: 'write',
    description:
      'Clear a project role override, reverting the user back to inheriting ' +
      'their workspace role on this project. Requires EFFECTIVE project ADMIN.',
    inputSchema: {
      projectId: z.string().describe('Project id.'),
      userId: z.string().describe('Target user id.'),
    },
    handler: (args, client) =>
      client
        .delete(`/projects/${args.projectId}/members/${args.userId}/role`)
        .then(jsonResult),
  },
];

/** All tools, read first then write. */
export const allTools: ToolDef[] = [...readTools, ...writeTools];

/**
 * Register every tool on an McpServer instance, wiring each handler to the
 * shared client. Strips undefined values are handled by the client (it skips
 * undefined query params; JSON.stringify drops undefined body props).
 */
export function registerTools(server: McpServer, client: NextLaneClient): void {
  const registrar = server as unknown as ToolRegistrar;
  for (const tool of allTools) {
    registrar.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args: Record<string, unknown>) => {
        try {
          return await tool.handler(args ?? {}, client);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      },
    );
  }
}

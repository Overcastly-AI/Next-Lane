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

const templateEnum = z
  .enum(['simple', 'kanban', 'scrum', 'bug-triage'])
  .describe(
    "Workflow template: 'simple' (linear TODO→IN_PROGRESS→DONE), 'kanban' " +
      "(any→any), 'scrum' (linear + back-transitions), 'bug-triage' (linear + " +
      'reopen path).',
  );

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
      'storyPoints, and dueDate. To change status use move_issue (it can apply ' +
      'workflow rules); to link issues use link_issues.',
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

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

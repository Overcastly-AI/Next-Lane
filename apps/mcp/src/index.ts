#!/usr/bin/env node
/**
 * Next Lane MCP server entrypoint.
 *
 * Exposes Next Lane's workflow/SDLC and core-entity REST API as MCP tools over
 * stdio so external agents (Claude Desktop, Claude Code, etc.) can read and
 * write a project's workflows and issues.
 *
 * Configuration is via environment variables — see ./config.ts:
 *   NEXT_LANE_API_URL  (default http://localhost:4000)
 *   NEXT_LANE_TOKEN    (required Personal Access Token)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigError, loadConfig } from './config.js';
import { NextLaneClient } from './client.js';
import { registerTools } from './tools/index.js';

/**
 * Server-level "instructions" — sent to every connecting MCP client as part
 * of the initialize handshake, so this guidance reaches an agent even if it
 * never reads `apps/mcp/README.md` or the `next-lane-project-context` skill.
 * This is the protocol-layer half of the founder directive ("we should
 * prompt it to do so"); the skill (`skills/project-context/SKILL.md`) is the
 * distributable, model-triggered half.
 */
const SERVER_INSTRUCTIONS =
  'Next Lane is a self-hosted issue/project tracker. Every project has a ' +
  "single shared agent-context document — the project's persistent memory " +
  "across separate agent runs. Call get_project_context FIRST when you " +
  'start work on a project: treat its content as the handoff from whoever ' +
  '(agent or human) worked on it last, and check the `staleness` field — a ' +
  'non-zero `changesSinceUpdate` means real activity has happened since it ' +
  'was written, so verify against current state before trusting it ' +
  'blindly. Keep it updated as you work: after significant milestones or ' +
  'direction changes, and ALWAYS before ending your session, call ' +
  'update_project_context with a concise handoff for the next run — ' +
  'current goal/state, decisions made, in-flight work, next steps, and ' +
  'gotchas. It is a full-content replace, not a log: replace stale content ' +
  'rather than appending forever, and stay well under the 64 KB cap. ' +
  'ALWAYS pass `expectedProjectKey` on every create_issue call — a field ' +
  'report confirmed an agent without this habit filed into the wrong ' +
  'project with no way to detect it after the fact; it is a MUST, not an ' +
  'optional nicety, and this server may enforce it as a hard error via ' +
  'NEXT_LANE_MCP_STRICT_PROJECT_KEY. Pass `idempotencyKey` on create_issue/ ' +
  'add_comment whenever you are RETRYING after a network error/timeout, so ' +
  'the retry replays the original result instead of creating a duplicate.';

/** Build a fully-wired server (no transport connected). Exported for tests. */
export function createServer(): McpServer {
  const config = loadConfig();
  const client = new NextLaneClient(config);
  const server = new McpServer(
    {
      name: 'next-lane',
      version: '0.1.0',
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );
  registerTools(server, client);
  return server;
}

async function main(): Promise<void> {
  let server: McpServer;
  try {
    server = createServer();
  } catch (err) {
    if (err instanceof ConfigError) {
      // Fail fast with a clear, single-line message on stderr (stdout is the
      // MCP transport and must stay clean).
      process.stderr.write(`[next-lane-mcp] ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[next-lane-mcp] server ready (stdio)\n');
}

// Only run when executed directly (not when imported by tests).
if (require.main === module) {
  main().catch((err) => {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(`[next-lane-mcp] fatal: ${message}\n`);
    process.exit(1);
  });
}

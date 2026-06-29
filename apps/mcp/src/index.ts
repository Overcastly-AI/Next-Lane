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

/** Build a fully-wired server (no transport connected). Exported for tests. */
export function createServer(): McpServer {
  const config = loadConfig();
  const client = new NextLaneClient(config);
  const server = new McpServer({
    name: 'next-lane',
    version: '0.1.0',
  });
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

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
 *
 * Framing (rewritten 2026-07-30, `docs/RESEARCH-AGENT-MEMORY.md` §4.2/R2):
 * the PAGES GRAPH is the memory and is named first; the agent-context doc is
 * described as what it actually is — one short, full-replace handoff note per
 * project that POINTS at the pages. The previous wording called the context
 * blob "the project's persistent memory" and mentioned the graph second,
 * which is why agents reached for a 64 KB flat document instead of the
 * traversable knowledge base. Two factual corrections rode along: wiki-links
 * resolve WORKSPACE-wide (since `syncWikiLinks`, 2026-07-17), not within a
 * project, and the workspace docs space is now reachable over MCP
 * (`list_workspace_pages`, `get_workspace_page_graph`,
 * `create_workspace_page`).
 */
export const SERVER_INSTRUCTIONS =
  'Next Lane is a self-hosted issue/project tracker whose knowledge base ' +
  'doubles as durable, queryable memory across separate agent runs. ' +
  'MEMORY LIVES IN PAGES. Pages are a wiki that is also a link graph: each ' +
  'page is a node, each [[Page Title]] reference a directed edge, and every ' +
  'save snapshots a version. The graph — not any single document — is the ' +
  'memory. It has two scopes: each PROJECT has its own pages, and each ' +
  'WORKSPACE has an org-level docs space for knowledge that outlives one ' +
  'project (handbook, runbooks, ADRs, conventions, postmortems). ' +
  'RECALL BEFORE YOU START. Cheapest entry points: search_pages (full-text ' +
  'over titles and bodies; returns refs — follow the best hit with ' +
  'get_page), get_issue_pages (the docs behind a specific issue), ' +
  "get_page_graph (one project's whole structure in one call) or " +
  'get_workspace_page_graph (every project PLUS the workspace docs space in ' +
  'one call — the only view that shows cross-project links), and ' +
  'list_workspace_pages (the org docs space as a tree). From any page, ' +
  'get_page_backlinks walks incoming links and get_page_links outgoing ' +
  'ones; both are workspace-wide. Graph nodes carry `updatedAt`, so you can ' +
  'tell a live doc from a stale one without opening it, and hub pages (many ' +
  'edges) are the load-bearing ones. ' +
  'RECORD WHAT YOU LEARN AS YOU WORK, not at the end. create_page/ ' +
  'update_page for project docs; create_workspace_page for anything not ' +
  'owned by a single project. Connect what you write to what already exists ' +
  'with [[Page Title]] references — that is what makes it findable later. ' +
  'Links resolve WORKSPACE-WIDE (same scope first, then any other project ' +
  'or the workspace docs space in the same workspace; never another ' +
  'workspace), so cross-project memory links do work. Linking a title that ' +
  'does not exist yet is fine — create it later and save this page again. ' +
  'Mention issue keys (e.g. NL-123) in a PROJECT page to auto-link it to ' +
  'those issues (workspace pages have no project, so no key linking). Page ' +
  'titles must not contain [ ] or | (reserved for the link grammar). ' +
  'restore_page_version is non-destructive. ' +
  'get_project_context/update_project_context are a SMALLER, different ' +
  'thing: one short handoff note per project — current goal and state, ' +
  'decisions made, in-flight work, next steps, gotchas, and [[Page Title]] ' +
  'or issue-key pointers to the pages holding the detail. It is a ' +
  'full-content replace with a 64 KB cap, no merge and no history, so two ' +
  'agents can silently overwrite each other: it is the sticky note on the ' +
  'door, not the memory behind it. Read it when you start (check ' +
  '`staleness.changesSinceUpdate` — non-zero means real activity has ' +
  'happened since it was written, so verify against current state before ' +
  'trusting it) and rewrite it before you end your session. Anything worth ' +
  'keeping longer than the next handoff belongs in a page. ' +
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

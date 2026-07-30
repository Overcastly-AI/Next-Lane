import { describe, expect, it } from 'vitest';
import { SERVER_INSTRUCTIONS } from './index.js';

/**
 * The server instructions are the single highest-leverage string in the
 * product for agent behaviour — every connecting client receives them in the
 * initialize handshake. These assertions pin the *framing* decided in
 * `docs/RESEARCH-AGENT-MEMORY.md` (§4.2 / R2, 2026-07-30) so a future edit
 * can't quietly re-demote the pages graph or resurrect a stale fact.
 */
describe('server instructions', () => {
  it('names the PAGES graph as the memory, before the agent-context doc', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/MEMORY LIVES IN PAGES/);
    const pagesAt = SERVER_INSTRUCTIONS.indexOf('MEMORY LIVES IN PAGES');
    const contextAt = SERVER_INSTRUCTIONS.indexOf('get_project_context');
    expect(pagesAt).toBeGreaterThanOrEqual(0);
    expect(contextAt).toBeGreaterThan(pagesAt);
  });

  it('describes the agent-context doc as a short handoff note, not "the memory"', () => {
    // The pre-2026-07-30 wording that sent agents to a 64 KB flat blob.
    expect(SERVER_INSTRUCTIONS).not.toMatch(/persistent memory/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/short handoff note per project/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/full-content replace with a 64 KB cap/);
    // Still teaches the staleness check and the end-of-session rewrite.
    expect(SERVER_INSTRUCTIONS).toMatch(/staleness\.changesSinceUpdate/);
    expect(SERVER_INSTRUCTIONS).toMatch(/rewrite it before you end your session/i);
  });

  it('states the CURRENT wiki-link resolution scope (workspace-wide)', () => {
    // syncWikiLinks went workspace-wide on 2026-07-17; the old text said
    // "links resolve within the project", which is false.
    expect(SERVER_INSTRUCTIONS).not.toMatch(/links resolve within the project/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/Links resolve WORKSPACE-WIDE/);
    expect(SERVER_INSTRUCTIONS).toMatch(/never another workspace/i);
  });

  it('points agents at the workspace-level docs space and its tools', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/get_workspace_page_graph/);
    expect(SERVER_INSTRUCTIONS).toMatch(/list_workspace_pages/);
    expect(SERVER_INSTRUCTIONS).toMatch(/create_workspace_page/);
  });

  it('keeps the load-bearing write-safety rules', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/expectedProjectKey/);
    expect(SERVER_INSTRUCTIONS).toMatch(/NEXT_LANE_MCP_STRICT_PROJECT_KEY/);
    expect(SERVER_INSTRUCTIONS).toMatch(/idempotencyKey/);
  });
});

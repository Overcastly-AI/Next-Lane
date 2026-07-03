# AI Agents & MCP

Next Lane is **agent-native**: AI agents are first-class users of the tracker,
not an afterthought. The official MCP server — **`@next-lane/mcp`** — exposes
**92 tools** over the [Model Context Protocol](https://modelcontextprotocol.io)
so Claude Code, Claude Desktop, and any other MCP host can read *and write*
your Next Lane instance end-to-end: file bugs, move cards, design workflows,
run NLQL queries, log time, build dashboards, and hand off context between
sessions.

Everything runs against your own self-hosted instance through the same REST
API the web app uses. No data leaves your infrastructure, and MCP exposure is
part of the definition-of-done for every new feature — the agent surface grows
in lockstep with the product.

---

## What "agent-native" means here

- **Full read/write coverage** — 92 tools spanning the whole product surface
  (issues, boards, sprints, workflows, dashboards, automations, analytics,
  notifications, and more), not a read-only wrapper.
- **Token-efficient by design** — compact responses, pagination everywhere,
  and server-side NLQL evaluation so an agent never has to pull a whole
  project into context to answer a question.
- **Persistent memory** — every project carries an agent-context handoff
  document with a staleness signal, so the next agent session starts where the
  last one left off.
- **Guard rails** — a wrong-project guard on issue creation, admin-only
  secret-bearing operations deliberately kept off the MCP surface, and PAT
  scopes to restrict what a token can touch.

---

## Connecting

### 1. Create a Personal Access Token (PAT)

1. Log in to your Next Lane instance.
2. Go to **Profile Settings** (`/me/settings`) → **API Tokens**.
3. Create a token and **copy the `nlp_...` value immediately** — it is shown
   only once.

The token inherits your account's permissions. You can optionally restrict it
to specific scopes when creating it:

```
issues:read    issues:write
projects:read  projects:write
comments:read  comments:write
webhooks:read  webhooks:write
github:read    github:write
gitlab:read    gitlab:write
```

An empty scopes list means unrestricted (same as your browser session). If you
scope a token, note that `list_issue_github_links` requires `github:read` and
`list_issue_gitlab_links` requires `gitlab:read`.

### 2. Build the server

From a clone of the repo:

```bash
pnpm install
pnpm --filter @next-lane/mcp build
```

This produces `apps/mcp/dist/index.js` (bin name: `next-lane-mcp`).

### 3. Register it with your MCP host

**Claude Code:**

```bash
claude mcp add next-lane \
  -e NEXT_LANE_API_URL=http://localhost:4000 \
  -e NEXT_LANE_TOKEN=nlp_your_token_here \
  -- node /absolute/path/to/Next-Lane/apps/mcp/dist/index.js
```

Confirm with `claude mcp list`.

**Claude Desktop** — add to `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "next-lane": {
      "command": "node",
      "args": ["/absolute/path/to/Next-Lane/apps/mcp/dist/index.js"],
      "env": {
        "NEXT_LANE_API_URL": "http://localhost:4000",
        "NEXT_LANE_TOKEN": "nlp_your_token_here"
      }
    }
  }
}
```

Two environment variables configure the server:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_LANE_TOKEN` | **Yes** | — | A Next Lane PAT (`nlp_...`). The server fails fast if unset. |
| `NEXT_LANE_API_URL` | No | `http://localhost:4000` | API host root. Do **not** include `/api` — it is added automatically. |

---

## The 92-tool surface at a glance

Grouped by area (see the
[full tool table in `apps/mcp/README.md`](https://github.com/Overcastly-AI/Next-Lane/blob/main/apps/mcp/README.md)
for every tool and parameter):

| Area | What agents can do |
|------|--------------------|
| **Issues** | Create (with wrong-project guard), update, move, delete, link/unlink, re-parent, bulk-update up to 100 at once, create from templates, comment, label |
| **Issue detail** | Checklists (add/toggle items), time tracking (estimates + worklogs), fix-versions, custom field values, start/due dates |
| **Search & query** | `list_issues` with server-side NLQL, full-text `search_issues`, `get_project_csv` export |
| **Workflows / SDLC** | Create workflows (blank or from `simple`/`kanban`/`scrum`/`bug-triage` templates), add/edit/delete transitions and gates, attach a workflow to a board |
| **Boards & planning** | Boards, statuses (incl. WIP limits), sprints (create/start/complete), components, versions/releases, saved NLQL filters, automation rules |
| **Dashboards** | Full dashboard + gadget CRUD, plus `get_dashboard_data` for server-side evaluation of every gadget in one call |
| **Reports & analytics** | Velocity, burndown, CFD, project and personal analytics |
| **Epic rollups** | `get_epic_overview` — one call returns the epic, compact children, a per-status breakdown, and `progress: {done, total, fraction}` |
| **People & access** | List workspace members, per-project role overrides (set/remove) |
| **Personal** | Personal board cards, quick links, notifications (list / mark read) |
| **SCM links** | Read an issue's linked GitHub PRs/commits and GitLab MRs/commits/branches |
| **Agent memory** | `get_project_context` / `update_project_context` — the persistent per-project handoff document |

**Deliberately not exposed:** configuring the GitHub/GitLab integrations and
instance SSO settings (admin-only and secret-bearing), and workspace/project
deletion (irreversible). Manage those from the web app.

---

## NLQL over MCP

`list_issues` accepts a `query` parameter — a full
[NLQL](./features#nlql-query-language) expression, evaluated **server-side**:

```
status != Done AND priority IN (HIGH, HIGHEST) ORDER BY due ASC
```

The agent gets back only the matching issues, already sorted, instead of
paging through the whole project and filtering in-context. Invalid queries
fail with the parser's own message (e.g.
`Invalid NLQL query: unexpected token "AND" at position 7`), so an agent can
self-correct. The same language powers the board query bar, saved filters,
dashboards, and automation conditions.

---

## Token efficiency

Agent context windows are a scarce resource, so the server is compact by
default:

- **Compact field sets** — every `list_*` / `search_issues` tool returns a
  hand-picked minimal shape (e.g. `list_issues` →
  `{key, title, status, assignee, priority, type, startDate}`) wrapped in a
  uniform envelope: `{items, total?, limit, offset?, hasMore}`.
- **`verbose: true`** — opt into the full API object per item only when you
  need it.
- **Pagination everywhere** — `limit`/`offset` default to 50 items per page
  (max 200), so no call can silently return an unbounded response.

A real agent field report measured **150 KB for a single `list_issues` call on
44 tickets** before this design; the same call is now a few KB by default.

---

## Per-project agent context memory

Every project keeps **one persistent agent-context document** — a Markdown
handoff shared by all agents (and humans: it is visible and editable under
**Project Settings → Agent context** in the web app). It survives between
sessions and across different agents, closing the "every session starts from
zero" gap.

- **`get_project_context`** — returns the document plus a **staleness signal**:
  `changesSinceUpdate` (project activity newer than the handoff) and
  `lastProjectActivityAt`, so an agent knows whether to trust the handoff or
  re-verify it. Never 404s — it returns an empty string before the first
  write. *Call this first when starting work on a project.*
- **`update_project_context`** — full-content replace (64 KB cap, requires
  project MEMBER+). *Call before ending every work session* so the next run
  starts with your context.

The server's MCP `instructions` teach every connecting client this
read-first / hand-off-last discipline automatically at the protocol layer.

### The `project-context` skill

For agents that support Agent Skills, the distributable
[`skills/project-context`](https://github.com/Overcastly-AI/Next-Lane/blob/main/skills/project-context/SKILL.md)
skill bakes in the full discipline — read context on start, update at
milestones, always write a structured handoff before finishing — with a worked
example. Install into Claude Code with one command from the repo root:

```bash
cp -r skills/project-context ~/.claude/skills/
```

---

## Guard rails

- **Wrong-project guard** — `create_issue` accepts an optional
  `expectedProjectKey`. If the resolved project's key doesn't match, the
  create is rejected *before* anything is written — protecting against the
  classic agent failure of filing issues into the wrong project from a stale
  ID. Every create response also echoes the resolved
  `project: {id, key, name}` for verification.
- **Scoped PATs** — restrict a token to read-only or to specific resource
  families; non-empty scope lists are enforced on every call.
- **Permission inheritance** — the token can never do more than the user who
  minted it. Workflow-editing tools require project ADMIN; reads require
  VIEWER+.

---

## See also

- [`apps/mcp/README.md`](https://github.com/Overcastly-AI/Next-Lane/blob/main/apps/mcp/README.md) — full tool table and development docs
- [Features](./features) — the product surface these tools operate on
- [Configuration](./configuration) — instance environment variables
